import { createHash } from "node:crypto";
import { claims, getClaimById, getOrderById, getPolicyById, orders, sellers } from "@/lib/data";
import { refundPlanFingerprint, InMemorySagaStore, type ExecutionSaga, type SagaStep } from "@/lib/execution-saga";
import { createRazorpayTestProvider, DemoRouteProvider, type ProviderIdentity, type ProviderSnapshotVerification, type RoutePaymentProvider } from "@/lib/provider";
import { calculateRefundPlan } from "@/lib/refund-engine";
import { InMemoryWebhookInbox } from "@/lib/webhook-inbox";
import type { ActivityEvent, CalculationIssue, Claim, LiabilityParty, ReviewFlag } from "@/lib/types";

type DemoRuntime = {
  version: string;
  provider: RoutePaymentProvider;
  demoProvider?: DemoRouteProvider;
  store: InMemorySagaStore;
  completedClaims: Map<string, DemoCompletion>;
  claimOverrides: Map<string, Claim>;
  escalations: Map<string, DemoEscalation>;
  escalationHistory: Map<string, DemoEscalation[]>;
  preflights: Map<string, DemoPreflightRecord>;
  sessionActivity: ActivityEvent[];
  webhookInbox: InMemoryWebhookInbox;
};

export interface DemoCompletion {
  approvedAt: string;
  completedAt: string;
  requestId: string;
  planFingerprint: string;
  refundId: string;
  reversals: Array<{ transferId: string; providerId: string; amountPaise: number }>;
}

export interface DemoCaseNote {
  recordedAt: string;
  actor: string;
  redactedText: string;
  sha256: string;
}

interface DemoEscalationBase {
  caseId: string;
  claimId: string;
  createdAt: string;
  updatedAt: string;
  requestId: string;
  lastRequestId: string;
  actor: string;
  queue: "payments_reconciliation" | "claims_review" | "recovery_operations";
  owner: string;
  dueAt: string;
  status: "open" | "closed";
  nextAction: string;
  notes: readonly DemoCaseNote[];
  closedAt?: string;
}

export interface DemoReviewEscalation extends DemoEscalationBase {
  kind: "reconciliation" | "evidence_request";
}

export type DemoRecoveryResponsibleParty = "unresolved" | "seller" | "courier" | "marketplace";
export type DemoRecoveryOutcome = "pending" | "partial" | "recovered" | "written_off" | "mixed";

export interface DemoRecoveryCase extends DemoEscalationBase {
  kind: "recovery";
  targetAmountPaise: number;
  recoveredAmountPaise: number;
  writtenOffAmountPaise: number;
  responsibleParty: DemoRecoveryResponsibleParty;
  processedUpdateFingerprints: ReadonlyMap<string, string>;
}

export type DemoEscalation = DemoReviewEscalation | DemoRecoveryCase;

export interface DemoPreflightRecord {
  claimId: string;
  planFingerprint: string;
  checkedAt: string;
  expiresAt: string;
  requestId: string;
  providerMode: RoutePaymentProvider["mode"];
  outcome: ProviderSnapshotVerification["outcome"];
  expectedPaymentRemainingPaise: number;
  expectedTransferRemainingPaise: number;
  plannedRefundPaise: number;
  plannedReversalPaise: number;
}

export interface DemoEscalationInput {
  kind?: "reconciliation" | "evidence_request";
  rationale?: string;
}

export interface DemoRecoveryUpdateInput {
  recoveredAmountPaise: number;
  writtenOffAmountPaise: number;
  responsibleParty: Exclude<DemoRecoveryResponsibleParty, "unresolved">;
  note: string;
  status: "open" | "closed";
}

type DemoEscalationReceiptBase = Pick<DemoEscalationBase,
  | "caseId"
  | "createdAt"
  | "updatedAt"
  | "requestId"
  | "lastRequestId"
  | "actor"
  | "queue"
  | "owner"
  | "dueAt"
  | "status"
  | "nextAction"
  | "closedAt"
> & {
  noteRecorded: boolean;
  notes: readonly DemoCaseNote[];
  ageHours: number;
  overdue: boolean;
};

export type DemoReviewEscalationReceipt = DemoEscalationReceiptBase & {
  kind: DemoReviewEscalation["kind"];
};

export type DemoRecoveryReceipt = DemoEscalationReceiptBase & {
  kind: "recovery";
  targetAmountPaise: number;
  recoveredAmountPaise: number;
  writtenOffAmountPaise: number;
  outstandingAmountPaise: number;
  responsibleParty: DemoRecoveryResponsibleParty;
  recoveryOutcome: DemoRecoveryOutcome;
};

export type DemoEscalationReceipt = DemoReviewEscalationReceipt | DemoRecoveryReceipt;

function recoveryOutcome(recoveryCase: DemoRecoveryCase): DemoRecoveryOutcome {
  if (recoveryCase.status === "open") {
    return recoveryCase.recoveredAmountPaise + recoveryCase.writtenOffAmountPaise === 0 ? "pending" : "partial";
  }
  if (recoveryCase.recoveredAmountPaise === recoveryCase.targetAmountPaise) return "recovered";
  if (recoveryCase.writtenOffAmountPaise === recoveryCase.targetAmountPaise) return "written_off";
  return "mixed";
}

function elapsedWholeHours(start: string, end: Date): number {
  const elapsed = end.getTime() - new Date(start).getTime();
  return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / (60 * 60 * 1_000))) : 0;
}

export function toDemoEscalationReceipt(escalation: DemoEscalation, asOf = new Date()): DemoEscalationReceipt {
  const agingEnd = escalation.closedAt ? new Date(escalation.closedAt) : asOf;
  const base: DemoEscalationReceiptBase = {
    caseId: escalation.caseId,
    createdAt: escalation.createdAt,
    updatedAt: escalation.updatedAt,
    requestId: escalation.requestId,
    lastRequestId: escalation.lastRequestId,
    actor: escalation.actor,
    queue: escalation.queue,
    owner: escalation.owner,
    dueAt: escalation.dueAt,
    status: escalation.status,
    nextAction: escalation.nextAction,
    noteRecorded: escalation.notes.length > 0,
    notes: escalation.notes.map((note) => ({ ...note })),
    ageHours: elapsedWholeHours(escalation.createdAt, agingEnd),
    overdue: escalation.status === "open" && asOf.getTime() > new Date(escalation.dueAt).getTime(),
    ...(escalation.closedAt ? { closedAt: escalation.closedAt } : {}),
  };
  if (escalation.kind !== "recovery") return { ...base, kind: escalation.kind };
  const outstandingAmountPaise = escalation.targetAmountPaise
    - escalation.recoveredAmountPaise
    - escalation.writtenOffAmountPaise;
  return {
    ...base,
    kind: "recovery",
    targetAmountPaise: escalation.targetAmountPaise,
    recoveredAmountPaise: escalation.recoveredAmountPaise,
    writtenOffAmountPaise: escalation.writtenOffAmountPaise,
    outstandingAmountPaise,
    responsibleParty: escalation.responsibleParty,
    recoveryOutcome: recoveryOutcome(escalation),
  };
}

export type DemoReviewDecision =
  | { kind: "item_match"; returnedItemId: string; orderLineId: string }
  | { kind: "liability"; liability: Extract<LiabilityParty, "seller" | "marketplace"> };

export interface DemoReviewResolution {
  claim: Claim;
  planFingerprint?: string;
  event: ActivityEvent;
}

const runtimeGlobal = globalThis as typeof globalThis & { __returnsplitDemoRuntime?: DemoRuntime };
const RUNTIME_VERSION = "returnsplit-v7-recovery-lifecycle";
const PREFLIGHT_VALIDITY_MS = 5 * 60 * 1_000;
const CASE_NOTE_MIN_LENGTH = 12;
const CASE_NOTE_MAX_LENGTH = 500;

function configuredProviderMode(): "demo" | "razorpay_test" {
  const configured = process.env.RETURNSPLIT_PROVIDER_MODE?.trim() || "demo";
  if (configured !== "demo" && configured !== "razorpay_test") {
    throw new Error("RETURNSPLIT_PROVIDER_MODE must be demo or razorpay_test");
  }
  return configured;
}

function runtimeVersion(): string {
  return `${RUNTIME_VERSION}:${configuredProviderMode()}:${process.env.RAZORPAY_KEY_ID ?? "no-key"}:${process.env.RAZORPAY_REQUEST_TIMEOUT_MS ?? "default-timeout"}`;
}

function configuredRazorpayTimeout(): number | undefined {
  const configured = process.env.RAZORPAY_REQUEST_TIMEOUT_MS?.trim();
  if (!configured) return undefined;
  const timeoutMs = Number(configured);
  if (!Number.isInteger(timeoutMs)) {
    throw new Error("RAZORPAY_REQUEST_TIMEOUT_MS must be an integer number of milliseconds");
  }
  return timeoutMs;
}

function createDemoRuntime(): DemoRuntime {
  const transfers = Object.fromEntries(orders.flatMap((order) => order.transfers.map((transfer) => [transfer.providerTransferId, transfer.originalAmountPaise])));
  const payments = Object.fromEntries(orders.map((order) => [order.paymentId, order.capturedPaymentPaise - order.refundedPaymentPaise]));
  const mode = configuredProviderMode();
  const demoProvider = mode === "demo" ? new DemoRouteProvider({ transfers, payments }) : undefined;
  const provider = demoProvider ?? createRazorpayTestProvider({
    keyId: process.env.RAZORPAY_KEY_ID ?? "",
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
    requestTimeoutMs: configuredRazorpayTimeout(),
  });
  return {
    version: runtimeVersion(),
    provider,
    ...(demoProvider ? { demoProvider } : {}),
    store: new InMemorySagaStore(),
    completedClaims: new Map(),
    claimOverrides: new Map(),
    escalations: new Map(),
    escalationHistory: new Map(),
    preflights: new Map(),
    sessionActivity: [],
    webhookInbox: new InMemoryWebhookInbox(),
  };
}

function issueFlag(issue: CalculationIssue): ReviewFlag {
  if (issue.code === "ambiguous_item") {
    return { code: "ambiguous_item", tone: "warning", label: "Item match required", detail: issue.message };
  }
  if (issue.code === "liability_unresolved" || issue.code === "reason_not_refundable") {
    return { code: "liability_unclear", tone: "warning", label: "Funding decision required", detail: issue.message };
  }
  if (issue.code === "reversal_exceeds_remaining") {
    return { code: "insufficient_reversible_balance", tone: "danger", label: "Approval blocked", detail: issue.message };
  }
  return {
    code: "manual_override",
    tone: issue.severity === "blocked" ? "danger" : "warning",
    label: issue.severity === "blocked" ? "Safety check failed" : "Further review required",
    detail: issue.message,
  };
}

function activityId(prefix: string, requestId: string): string {
  return `${prefix}_${requestId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function normalizeCaseNote(note: string): string {
  return note.trim().replace(/\s+/g, " ");
}

function redactCaseNote(note: string): string {
  return normalizeCaseNote(note)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/(?:\+?91[\s.-]?)?[6-9](?:[\s.-]?\d){9}\b/g, "[redacted phone]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted IP address]")
    .replace(/\b\d(?:[\s.-]?\d){9,18}\b/g, "[redacted number]");
}

function recordCaseNote(note: string, recordedAt: string): DemoCaseNote {
  const normalized = normalizeCaseNote(note);
  return {
    recordedAt,
    actor: "Priyanshu",
    redactedText: redactCaseNote(normalized),
    sha256: createHash("sha256").update(normalized, "utf8").digest("hex"),
  };
}

function recoveryUpdateFingerprint(input: DemoRecoveryUpdateInput): string {
  return createHash("sha256").update(JSON.stringify({
    recoveredAmountPaise: input.recoveredAmountPaise,
    writtenOffAmountPaise: input.writtenOffAmountPaise,
    responsibleParty: input.responsibleParty,
    note: normalizeCaseNote(input.note),
    status: input.status,
  }), "utf8").digest("hex");
}

export function getDemoRuntime(): DemoRuntime {
  if (runtimeGlobal.__returnsplitDemoRuntime?.version !== runtimeVersion()) {
    runtimeGlobal.__returnsplitDemoRuntime = createDemoRuntime();
  }
  return runtimeGlobal.__returnsplitDemoRuntime;
}

export function getProviderIdentity(): ProviderIdentity {
  const { provider } = getDemoRuntime();
  return { mode: provider.mode, label: provider.label, isLive: provider.isLive };
}

/** Reset every process-local demo mutation and reconstruct provider balances. */
export function resetDemoRuntime(): void {
  runtimeGlobal.__returnsplitDemoRuntime = createDemoRuntime();
}

/** The mutable workflow claim, before any completed-execution presentation overlay. */
export function getDemoWorkflowClaim(claimId: string): Claim | undefined {
  return getDemoRuntime().claimOverrides.get(claimId) ?? getClaimById(claimId);
}

function executionSummary(saga: ExecutionSaga): NonNullable<Claim["execution"]> {
  const incomplete = [...saga.reversals, saga.refund].find((step) => step.status !== "succeeded");
  return {
    sagaId: saga.id,
    state: saga.state,
    approvedBy: saga.approval.actorName,
    approvedAt: saga.approval.approvedAt,
    ...(saga.completedAt ? { completedAt: saga.completedAt } : {}),
    requestId: saga.lastRequestId,
    completedReversalTransferIds: saga.reversals.filter((step) => step.status === "succeeded").map((step) => step.transferId),
    canResume: Boolean(incomplete && incomplete.status === "retryable_failure"),
    requiresReconciliation: saga.state === "reversal_result_unknown" || saga.state === "refund_result_unknown",
    ...(incomplete?.errorMessage ? { lastError: incomplete.errorMessage } : {}),
    ...(incomplete ? { pendingOperation: incomplete.kind } : {}),
  };
}

function stepName(step: SagaStep | undefined): string {
  if (!step) return "payment operation";
  return step.kind === "payment_refund" ? "customer refund" : "seller reversal";
}

function projectSaga(claim: Claim, saga: ExecutionSaga): Claim {
  const execution = executionSummary(saga);
  if (saga.state === "completed") {
    return {
      ...claim,
      status: "completed",
      statusLabel: "Completed",
      approvedAt: saga.approval.approvedAt,
      completedAt: saga.completedAt,
      review: {
        ...claim.review,
        state: "completed",
        headline: "Refund completed",
        explanation: saga.reversals.length > 0
          ? "Every required seller reversal was confirmed before the customer refund was created."
          : "No seller reversal was required; the marketplace-funded customer refund was confirmed.",
        flags: [],
      },
      execution,
    };
  }

  const incomplete = [...saga.reversals, saga.refund].find((step) => step.status !== "succeeded");
  const priorFlags = claim.review.flags.filter((flag) => flag.code !== "provider_failure" && flag.code !== "provider_result_unknown");
  if (execution.requiresReconciliation) {
    return {
      ...claim,
      status: "processing",
      statusLabel: "Reconciliation required",
      approvedAt: saga.approval.approvedAt,
      review: {
        ...claim.review,
        state: "processing",
        headline: `Reconcile the ${stepName(incomplete)}`,
        explanation: "The provider result is not final. Confirm it before attempting any further money movement.",
        flags: [...priorFlags, { code: "provider_result_unknown", tone: "warning", label: "Provider result unknown", detail: execution.lastError ?? "Automatic execution is paused until the provider result is reconciled." }],
      },
      execution,
    };
  }
  if (saga.state === "failed") {
    const retryable = execution.canResume === true;
    return {
      ...claim,
      status: "processing",
      statusLabel: retryable ? "Retry available" : "Manual intervention",
      approvedAt: saga.approval.approvedAt,
      review: {
        ...claim.review,
        state: "processing",
        headline: retryable ? `Retry the ${stepName(incomplete)}` : `${stepName(incomplete)} needs manual intervention`,
        explanation: retryable
          ? "Confirmed operations will be skipped and only the failed step will run again."
          : "Automatic execution is stopped. Payments operations must resolve this provider rejection.",
        flags: [...priorFlags, { code: "provider_failure", tone: retryable ? "warning" : "danger", label: retryable ? "Safe retry available" : "Automatic execution stopped", detail: execution.lastError ?? "The provider rejected this operation." }],
      },
      execution,
    };
  }
  return {
    ...claim,
    status: "processing",
    statusLabel: "Execution in progress",
    approvedAt: saga.approval.approvedAt,
    review: {
      ...claim.review,
      state: "processing",
      headline: "Execution in progress",
      explanation: "The approved money movement is being confirmed with the payment provider.",
      flags: priorFlags,
    },
    execution,
  };
}

/** The claim as operators should see it, including persisted review and execution state. */
export async function getDemoClaimView(claimId: string): Promise<Claim | undefined> {
  const claim = getDemoWorkflowClaim(claimId);
  if (!claim) return undefined;
  const saga = await getDemoRuntime().store.findByClaimId(claim.id);
  if (saga) return projectSaga(claim, saga);
  const completion = getDemoClaimCompletion(claim.id);
  if (!completion) return claim;
  return {
    ...claim,
    status: "completed",
    statusLabel: "Completed",
    approvedAt: completion.approvedAt,
    completedAt: completion.completedAt,
    review: {
      ...claim.review,
      state: "completed",
      headline: "Refund completed",
      explanation: completion.reversals.length > 0
        ? "Every required seller reversal was confirmed before the customer refund was created."
        : "No seller reversal was required; the marketplace-funded customer refund was confirmed.",
      flags: [],
    },
    execution: {
      sagaId: `saga_${claim.id}`,
      state: "completed",
      approvedBy: "Priyanshu",
      approvedAt: completion.approvedAt,
      completedAt: completion.completedAt,
      requestId: completion.requestId,
      completedReversalTransferIds: completion.reversals.map((reversal) => reversal.transferId),
    },
  };
}

export async function getDemoClaimsView(): Promise<readonly Claim[]> {
  return Promise.all(claims.map(async (claim) => await getDemoClaimView(claim.id) ?? claim));
}

export function getDemoClaimCompletion(claimId: string): DemoCompletion | undefined {
  return getDemoRuntime().completedClaims.get(claimId);
}

export function recordDemoClaimCompletion(claimId: string, completion: DemoCompletion): void {
  getDemoRuntime().completedClaims.set(claimId, completion);
}

export function getDemoEscalation(claimId: string): DemoEscalation | undefined {
  return getDemoRuntime().escalations.get(claimId);
}

export function getDemoEscalationHistory(claimId: string): readonly DemoEscalation[] {
  return getDemoRuntime().escalationHistory.get(claimId) ?? [];
}

function persistDemoEscalation(escalation: DemoEscalation): void {
  const runtime = getDemoRuntime();
  const history = runtime.escalationHistory.get(escalation.claimId) ?? [];
  const existingIndex = history.findIndex((entry) => entry.caseId === escalation.caseId);
  const nextHistory = existingIndex < 0
    ? [...history, escalation]
    : history.map((entry, index) => index === existingIndex ? escalation : entry);
  runtime.escalations.set(escalation.claimId, escalation);
  runtime.escalationHistory.set(escalation.claimId, nextHistory);
}

export function getDemoRecoveryCase(claimId: string): DemoRecoveryCase | undefined {
  const escalation = getDemoEscalation(claimId);
  return escalation?.kind === "recovery" ? escalation : undefined;
}

export function hasOpenDemoRecovery(claimId: string): boolean {
  return getDemoRecoveryCase(claimId)?.status === "open";
}

export function getDemoPreflight(claimId: string): DemoPreflightRecord | undefined {
  return getDemoRuntime().preflights.get(claimId);
}

export function recordDemoClaimPreflight({
  claimId,
  planFingerprint,
  result,
  requestId,
  checkedAt = new Date(),
}: {
  claimId: string;
  planFingerprint: string;
  result: ProviderSnapshotVerification;
  requestId: string;
  checkedAt?: Date;
}): DemoPreflightRecord {
  const runtime = getDemoRuntime();
  const claim = getDemoWorkflowClaim(claimId);
  if (!claim?.decision || refundPlanFingerprint(claim.decision) !== planFingerprint) {
    throw new Error("The preflight result does not match the current claim plan");
  }
  const checkedAtIso = checkedAt.toISOString();
  const record: DemoPreflightRecord = {
    claimId,
    planFingerprint,
    checkedAt: checkedAtIso,
    expiresAt: new Date(checkedAt.getTime() + PREFLIGHT_VALIDITY_MS).toISOString(),
    requestId,
    providerMode: runtime.provider.mode,
    outcome: result.outcome,
    expectedPaymentRemainingPaise: claim.decision.providerSnapshot.remainingRefundablePaise,
    expectedTransferRemainingPaise: claim.decision.sellerReversals.reduce((sum, entry) => sum + entry.remainingReversiblePaise, 0),
    plannedRefundPaise: claim.decision.customerRefundPaise,
    plannedReversalPaise: claim.decision.sellerFundedPaise,
  };
  runtime.preflights.set(claimId, record);
  runtime.sessionActivity.push({
    id: activityId("preflight", requestId),
    type: "provider_snapshot_checked",
    outcome: result.outcome === "verified" ? "success" : result.outcome === "mismatch" ? "danger" : "warning",
    claimId,
    orderId: claim.orderId,
    occurredAt: checkedAtIso,
    actor: "Priyanshu",
    summary: result.outcome === "verified"
      ? "Verified the current provider balances against the reviewed plan"
      : result.outcome === "mismatch"
        ? "Provider balances no longer match the reviewed plan"
        : "Provider balances could not be verified",
    requestId,
    metadata: {
      planFingerprint,
      providerMode: runtime.provider.mode,
      outcome: result.outcome,
      plannedRefundPaise: record.plannedRefundPaise,
      plannedReversalPaise: record.plannedReversalPaise,
      expiresAt: record.expiresAt,
    },
  });
  return record;
}

export function getDemoSessionActivity(): readonly ActivityEvent[] {
  return getDemoRuntime().sessionActivity;
}

function sagaActivityPresentation(action: string): Pick<ActivityEvent, "type" | "outcome" | "summary"> {
  if (action === "refund_plan_approved") return { type: "approval_recorded", outcome: "success", summary: "Approved the reviewed funding plan" };
  if (action === "execution_resume_requested") return { type: "execution_started", outcome: "info", summary: "Requested a safe execution resume" };
  if (action === "transfer_reversal_submitted") return { type: "execution_started", outcome: "info", summary: "Submitted the next seller reversal" };
  if (action === "transfer_reversed") return { type: "transfer_reversed", outcome: "success", summary: "Seller reversal confirmed" };
  if (action === "transfer_reversal_reconciled") return { type: "transfer_reversed", outcome: "success", summary: "Seller reversal confirmed during reconciliation" };
  if (action === "refund_submitted") return { type: "execution_started", outcome: "info", summary: "Submitted the customer refund" };
  if (action === "refund_created_and_completed") return { type: "refund_created", outcome: "success", summary: "Customer refund confirmed" };
  if (action === "refund_reconciled_and_completed") return { type: "refund_created", outcome: "success", summary: "Customer refund confirmed during reconciliation" };
  if (action.includes("pending") || action.includes("unknown")) return { type: "reconciliation_pending", outcome: "warning", summary: "Provider result requires reconciliation" };
  if (action.includes("failed")) return { type: "provider_failure", outcome: "danger", summary: "Provider operation failed safely" };
  return { type: "execution_started", outcome: "info", summary: action.replaceAll("_", " ") };
}

export async function getDemoExecutionActivity(): Promise<readonly ActivityEvent[]> {
  const runtime = getDemoRuntime();
  const sagas = await Promise.all(claims.map((claim) => runtime.store.findByClaimId(claim.id)));
  return sagas.flatMap((saga) => saga?.audit.map((record) => {
    const presentation = sagaActivityPresentation(record.action);
    return {
      id: record.id,
      type: presentation.type,
      outcome: presentation.outcome,
      claimId: saga.claimId,
      orderId: saga.orderId,
      occurredAt: record.at,
      actor: record.actor,
      summary: presentation.summary,
      requestId: record.requestId,
      metadata: record.detail,
    } satisfies ActivityEvent;
  }) ?? []);
}

export function resolveDemoClaimReview(
  claimId: string,
  decision: DemoReviewDecision,
  requestId: string,
  now = new Date(),
): DemoReviewResolution {
  const runtime = getDemoRuntime();
  const claim = getDemoWorkflowClaim(claimId);
  if (!claim) throw new Error("Claim not found");
  if (claim.status !== "needs_review") throw new Error("This claim no longer needs a review decision");
  const order = getOrderById(claim.orderId);
  const policy = order ? getPolicyById(order.policyId) : undefined;
  if (!order || !policy) throw new Error("The claim's frozen order or policy is unavailable");

  let returnedItems = [...claim.returnedItems];
  let liability = claim.review.liability;
  let decisionSummary: string;
  if (decision.kind === "item_match") {
    const returnedIndex = returnedItems.findIndex((item) => item.id === decision.returnedItemId);
    const orderLine = order.lines.find((line) => line.id === decision.orderLineId);
    if (returnedIndex < 0) throw new Error("Returned item is not part of this claim");
    if (!orderLine) throw new Error("Selected order line is not part of this order");
    returnedItems = returnedItems.map((item, index) => index === returnedIndex
      ? { ...item, orderLineId: orderLine.id, matchConfidence: 1 }
      : item);
    decisionSummary = `Matched returned item to ${orderLine.title}${orderLine.variant ? ` · ${orderLine.variant}` : ""}`;
  } else {
    liability = decision.liability;
    decisionSummary = decision.liability === "marketplace"
      ? "Assigned marketplace funding after evidence review"
      : "Assigned seller funding for policy validation";
  }

  const calculatedAt = now.toISOString();
  const calculation = calculateRefundPlan({
    claim: { id: claim.id, reason: claim.reason, returnedItems, review: { liability } },
    order,
    policy,
    sellers,
    calculatedAt,
  });
  const issues = calculation.issues;
  const isReady = calculation.status === "ready";
  const isBlocked = calculation.status === "blocked";
  const nextClaim: Claim = {
    ...claim,
    returnedItems,
    itemSummary: decision.kind === "item_match"
      ? (() => {
          const line = order.lines.find((entry) => entry.id === decision.orderLineId)!;
          return `${line.title}${line.variant ? ` · ${line.variant}` : ""}`;
        })()
      : claim.itemSummary,
    status: isReady ? "ready_for_approval" : isBlocked ? "blocked" : "needs_review",
    statusLabel: isReady ? "Ready for approval" : isBlocked ? "Blocked" : "Needs review",
    amountPaise: calculation.status === "needs_review" ? undefined : calculation.plan?.customerRefundPaise,
    decision: calculation.status === "needs_review" ? undefined : calculation.plan,
    review: {
      ...claim.review,
      state: isReady ? "ready" : isBlocked ? "blocked" : "needs_review",
      liability,
      headline: isReady ? "Human review resolved" : isBlocked ? "Safety check blocked approval" : "Another decision is required",
      explanation: isReady
        ? `${decisionSummary}. ReturnSplit recalculated the money movement from the frozen order and policy.`
        : `${decisionSummary}. ${issues.map((issue) => issue.message).join(" ")}`,
      flags: issues.map(issueFlag),
      evidence: [
        ...claim.review.evidence,
        { source: "claim", label: "Human review decision", quote: `${decisionSummary} by Priyanshu.` },
      ],
    },
  };
  runtime.claimOverrides.set(claim.id, nextClaim);

  const openEvidenceCase = runtime.escalations.get(claim.id);
  if (openEvidenceCase?.kind === "evidence_request" && openEvidenceCase.status === "open") {
    persistDemoEscalation({
      ...openEvidenceCase,
      status: "closed",
      updatedAt: calculatedAt,
      lastRequestId: requestId,
      nextAction: "No further evidence action is required; the review decision has been recorded.",
      closedAt: calculatedAt,
    });
  }

  if (decision.kind === "liability" && decision.liability === "marketplace") {
    const recoveryCase: DemoEscalation = {
      caseId: `recovery_${claim.id.replace(/[^a-zA-Z0-9]/g, "_")}`,
      claimId: claim.id,
      kind: "recovery",
      createdAt: calculatedAt,
      updatedAt: calculatedAt,
      requestId,
      lastRequestId: requestId,
      actor: "Priyanshu",
      queue: "recovery_operations",
      owner: "Recovery Operations",
      dueAt: new Date(now.getTime() + 48 * 60 * 60 * 1_000).toISOString(),
      status: "open",
      nextAction: "Confirm courier or seller responsibility and record the recovered or written-off amount.",
      notes: [],
      targetAmountPaise: nextClaim.decision?.marketplaceFundedPaise ?? 0,
      recoveredAmountPaise: 0,
      writtenOffAmountPaise: 0,
      responsibleParty: "unresolved",
      processedUpdateFingerprints: new Map(),
    };
    persistDemoEscalation(recoveryCase);
    runtime.sessionActivity.push({
      id: activityId("recovery", requestId),
      type: "manual_review_requested",
      outcome: "warning",
      claimId: claim.id,
      orderId: claim.orderId,
      occurredAt: calculatedAt,
      actor: recoveryCase.actor,
      summary: `Opened recovery case ${recoveryCase.caseId} after marketplace funding was selected`,
      requestId,
      metadata: {
        caseId: recoveryCase.caseId,
        queue: recoveryCase.queue,
        dueAt: recoveryCase.dueAt,
        targetAmountPaise: recoveryCase.targetAmountPaise,
      },
    });
  }

  const planFingerprint = nextClaim.decision ? refundPlanFingerprint(nextClaim.decision) : undefined;
  const event: ActivityEvent = {
    id: activityId("review", requestId),
    type: isReady ? "calculation_created" : "manual_review_requested",
    outcome: isReady ? "success" : isBlocked ? "danger" : "warning",
    claimId: claim.id,
    orderId: claim.orderId,
    occurredAt: calculatedAt,
    actor: "Priyanshu",
    summary: `${decisionSummary} · ${isReady ? "new approval plan created" : isBlocked ? "approval blocked" : "review remains open"}`,
    requestId,
    metadata: {
      decisionKind: decision.kind,
      calculationStatus: calculation.status,
      ...(planFingerprint ? { planFingerprint } : {}),
    },
  };
  runtime.sessionActivity.push(event);
  return { claim: nextClaim, ...(planFingerprint ? { planFingerprint } : {}), event };
}

export function updateDemoRecoveryCase(
  claimId: string,
  requestId: string,
  input: DemoRecoveryUpdateInput,
  now = new Date(),
): DemoRecoveryCase {
  const runtime = getDemoRuntime();
  const claim = getDemoWorkflowClaim(claimId);
  if (!claim) throw new Error("Claim not found");
  const existing = runtime.escalations.get(claimId);
  if (!existing || existing.kind !== "recovery") throw new Error("This claim does not have a recovery case");
  if (!runtime.completedClaims.has(claimId)) {
    throw new Error("Recovery accounting can be updated only after the customer refund is complete");
  }

  const fingerprint = recoveryUpdateFingerprint(input);
  const processedFingerprint = existing.processedUpdateFingerprints.get(requestId);
  if (processedFingerprint) {
    if (processedFingerprint === fingerprint) return existing;
    throw new Error("This request ID has already been used for a different recovery update");
  }
  if (existing.requestId === requestId) throw new Error("This request ID was already used to open the recovery case");
  if (existing.status === "closed") throw new Error("This recovery case is already closed");

  const note = normalizeCaseNote(input.note);
  if (note.length < CASE_NOTE_MIN_LENGTH || note.length > CASE_NOTE_MAX_LENGTH) {
    throw new Error(`A recovery note between ${CASE_NOTE_MIN_LENGTH} and ${CASE_NOTE_MAX_LENGTH} characters is required`);
  }
  for (const [label, amount] of [
    ["Recovered amount", input.recoveredAmountPaise],
    ["Written-off amount", input.writtenOffAmountPaise],
  ] as const) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error(`${label} must be a non-negative integer number of paise`);
  }
  const accountedAmountPaise = input.recoveredAmountPaise + input.writtenOffAmountPaise;
  if (!Number.isSafeInteger(accountedAmountPaise) || accountedAmountPaise > existing.targetAmountPaise) {
    throw new Error("Recovered and written-off amounts cannot exceed the recovery target");
  }
  if (
    input.recoveredAmountPaise < existing.recoveredAmountPaise
    || input.writtenOffAmountPaise < existing.writtenOffAmountPaise
  ) {
    throw new Error("Recorded recovery and write-off totals cannot decrease");
  }
  const outstandingAmountPaise = existing.targetAmountPaise - accountedAmountPaise;
  if (input.status === "closed" && outstandingAmountPaise !== 0) {
    throw new Error("A recovery case can close only after the full target is recovered or written off");
  }
  if (input.status === "open" && outstandingAmountPaise === 0) {
    throw new Error("A fully reconciled recovery case must be closed");
  }

  const updatedAt = now.toISOString();
  const updated: DemoRecoveryCase = {
    ...existing,
    updatedAt,
    lastRequestId: requestId,
    status: input.status,
    nextAction: input.status === "closed"
      ? "No further recovery action is required; the marketplace-funded amount is fully reconciled."
      : "Record additional recovery or write-off until the marketplace-funded amount is fully reconciled.",
    notes: [...existing.notes, recordCaseNote(note, updatedAt)],
    recoveredAmountPaise: input.recoveredAmountPaise,
    writtenOffAmountPaise: input.writtenOffAmountPaise,
    responsibleParty: input.responsibleParty,
    processedUpdateFingerprints: new Map(existing.processedUpdateFingerprints).set(requestId, fingerprint),
    ...(input.status === "closed" ? { closedAt: updatedAt } : {}),
  };
  persistDemoEscalation(updated);
  const receipt = toDemoEscalationReceipt(updated, now);
  runtime.sessionActivity.push({
    id: activityId("recovery_update", requestId),
    type: "recovery_updated",
    outcome: updated.status === "closed" ? "success" : receipt.overdue ? "warning" : "info",
    claimId,
    orderId: claim.orderId,
    occurredAt: updatedAt,
    actor: "Priyanshu",
    summary: updated.status === "closed"
      ? `Closed recovery case ${updated.caseId} after fully reconciling the marketplace-funded amount`
      : `Updated recovery case ${updated.caseId}; further recovery work remains open`,
    requestId,
    metadata: {
      caseId: updated.caseId,
      status: updated.status,
      responsibleParty: updated.responsibleParty,
      targetAmountPaise: updated.targetAmountPaise,
      recoveredAmountPaise: updated.recoveredAmountPaise,
      writtenOffAmountPaise: updated.writtenOffAmountPaise,
      outstandingAmountPaise,
    },
  });
  return updated;
}

export async function escalateDemoClaim(
  claimId: string,
  requestId: string,
  input: DemoEscalationInput = {},
  now = new Date(),
): Promise<DemoEscalation> {
  const runtime = getDemoRuntime();
  const existing = runtime.escalations.get(claimId);
  const kind = input.kind ?? "reconciliation";
  if (existing?.status === "open") {
    if (existing.kind !== kind) throw new Error("This claim already has a different open operations case");
    return existing;
  }
  const claim = getDemoWorkflowClaim(claimId);
  if (!claim) throw new Error("Claim not found");
  const saga = await runtime.store.findByClaimId(claim.id);
  const terminalExecutionFailure = saga?.state === "failed" && [...saga.reversals, saga.refund].some((step) => step.status === "terminal_failure");
  const normalizedRationale = input.rationale ? normalizeCaseNote(input.rationale) : "";
  const rationale = normalizedRationale || undefined;
  if (kind === "evidence_request") {
    if (claim.status !== "needs_review") throw new Error("Only a claim awaiting review can request more evidence");
    if (!rationale || rationale.length < CASE_NOTE_MIN_LENGTH || rationale.length > CASE_NOTE_MAX_LENGTH) {
      throw new Error(`A rationale between ${CASE_NOTE_MIN_LENGTH} and ${CASE_NOTE_MAX_LENGTH} characters is required to request evidence`);
    }
  } else if (claim.status !== "blocked" && !terminalExecutionFailure) {
    throw new Error("Only blocked or terminally failed claims can be escalated for reconciliation");
  }
  const createdAt = now.toISOString();
  const evidenceRequest = kind === "evidence_request";
  const caseIdBase = `${evidenceRequest ? "evidence" : "recon"}_${claim.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const priorCaseIds = new Set(getDemoEscalationHistory(claim.id).map((entry) => entry.caseId));
  let caseId = caseIdBase;
  for (let sequence = 2; priorCaseIds.has(caseId); sequence += 1) {
    caseId = `${caseIdBase}_${sequence}`;
  }
  const escalation: DemoEscalation = {
    caseId,
    claimId: claim.id,
    kind,
    createdAt,
    updatedAt: createdAt,
    requestId,
    lastRequestId: requestId,
    actor: "Priyanshu",
    queue: evidenceRequest ? "claims_review" : "payments_reconciliation",
    owner: evidenceRequest ? "Customer Support" : "Payments Operations",
    dueAt: new Date(now.getTime() + (evidenceRequest ? 24 : 4) * 60 * 60 * 1_000).toISOString(),
    status: "open",
    nextAction: evidenceRequest
      ? "Request a clear product-label photo, then return the claim for item matching."
      : "Confirm the provider ledger, correct the balance discrepancy, and recalculate before approval.",
    notes: rationale ? [recordCaseNote(rationale, createdAt)] : [],
  };
  persistDemoEscalation(escalation);
  if (evidenceRequest) {
    runtime.claimOverrides.set(claim.id, {
      ...claim,
      statusLabel: "Evidence requested",
      review: {
        ...claim.review,
        headline: "Waiting for customer evidence",
        explanation: "The available evidence is not sufficient for a safe decision. Customer Support will request a clearer product label or item photo.",
      },
    });
  }
  runtime.sessionActivity.push({
    id: activityId("escalation", requestId),
    type: "manual_review_requested",
    outcome: "warning",
    claimId: claim.id,
    orderId: claim.orderId,
    occurredAt: createdAt,
    actor: escalation.actor,
    summary: evidenceRequest
      ? `Opened evidence request ${escalation.caseId}; no item match was guessed`
      : `Opened payments reconciliation case ${escalation.caseId}; approval remains blocked`,
    requestId,
    metadata: { caseId: escalation.caseId, queue: escalation.queue, owner: escalation.owner, dueAt: escalation.dueAt },
  });
  return escalation;
}
