import { createHash } from "node:crypto";
import { validateRefundPlan } from "./invariants";
import type { ProviderSnapshotVerification, RoutePaymentProvider, VerifyRefundCapacityRequest } from "./provider";
import type { ISODateTime, Order, Policy, RefundPlan } from "./types";

export type SagaState =
  | "approved"
  | "reversing_transfers"
  | "reversal_result_unknown"
  | "refunding_payment"
  | "refund_result_unknown"
  | "failed"
  | "completed";

export type SagaStepStatus =
  | "ready"
  | "submitted"
  | "succeeded"
  | "retryable_failure"
  | "terminal_failure"
  | "unknown";

export interface SagaStep {
  id: string;
  kind: "transfer_reversal" | "payment_refund";
  status: SagaStepStatus;
  amountPaise: number;
  receipt: string;
  idempotencyKey: string;
  attempts: number;
  providerId?: string;
  providerStatus?: string;
  errorCode?: string;
  errorMessage?: string;
  updatedAt: ISODateTime;
}

export interface ReversalSagaStep extends SagaStep {
  kind: "transfer_reversal";
  transferId: string;
  providerTransferId: string;
  sellerId: string;
}

export interface RefundSagaStep extends SagaStep {
  kind: "payment_refund";
  paymentId: string;
}

export interface ApprovalRecord {
  actorId: string;
  actorName: string;
  approvedAt: ISODateTime;
  requestId: string;
  isOverride: boolean;
  overrideReason?: string;
}

export interface SagaAuditRecord {
  id: string;
  at: ISODateTime;
  actor: string;
  action: string;
  requestId: string;
  detail: Readonly<Record<string, string | number | boolean>>;
}

export interface ExecutionSaga {
  id: string;
  claimId: string;
  orderId: string;
  state: SagaState;
  version: number;
  providerMode: RoutePaymentProvider["mode"];
  planFingerprint: string;
  planSnapshot: RefundPlan;
  approval: ApprovalRecord;
  lastRequestId: string;
  reversals: ReversalSagaStep[];
  refund: RefundSagaStep;
  audit: SagaAuditRecord[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  completedAt?: ISODateTime;
}

export interface SagaStore {
  findByClaimId(claimId: string): Promise<ExecutionSaga | undefined>;
  insert(saga: ExecutionSaga): Promise<ExecutionSaga>;
  save(saga: ExecutionSaga, expectedVersion: number): Promise<ExecutionSaga>;
}

function cloneSaga(saga: ExecutionSaga): ExecutionSaga {
  return JSON.parse(JSON.stringify(saga)) as ExecutionSaga;
}

const allowedSagaTransitions: Readonly<Record<SagaState, ReadonlySet<SagaState>>> = {
  approved: new Set(["approved", "reversing_transfers", "refunding_payment"]),
  reversing_transfers: new Set(["reversing_transfers", "reversal_result_unknown", "refunding_payment", "failed"]),
  reversal_result_unknown: new Set(["reversal_result_unknown", "reversing_transfers", "refunding_payment", "failed"]),
  refunding_payment: new Set(["refunding_payment", "refund_result_unknown", "failed", "completed"]),
  refund_result_unknown: new Set(["refund_result_unknown", "failed", "completed"]),
  failed: new Set(["failed", "reversing_transfers", "refunding_payment"]),
  completed: new Set(["completed"]),
};

const allowedStepTransitions: Readonly<Record<SagaStepStatus, ReadonlySet<SagaStepStatus>>> = {
  ready: new Set(["ready", "submitted"]),
  submitted: new Set(["submitted", "succeeded", "retryable_failure", "terminal_failure", "unknown"]),
  succeeded: new Set(["succeeded"]),
  retryable_failure: new Set(["retryable_failure", "submitted"]),
  terminal_failure: new Set(["terminal_failure"]),
  unknown: new Set(["unknown", "succeeded", "retryable_failure", "terminal_failure"]),
};

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertStepUpdate(current: SagaStep, next: SagaStep, label: string): void {
  const immutableKeys: readonly (keyof SagaStep)[] = [
    "id",
    "kind",
    "amountPaise",
    "receipt",
    "idempotencyKey",
  ];
  if (immutableKeys.some((key) => current[key] !== next[key])) {
    throw new Error(`${label} identity is immutable`);
  }
  if (!allowedStepTransitions[current.status].has(next.status)) {
    throw new Error(`${label} cannot move from ${current.status} to ${next.status}`);
  }
  if (next.attempts < current.attempts || next.attempts > current.attempts + 1) {
    throw new Error(`${label} attempt count cannot move backward or skip attempts`);
  }
  if (next.attempts === current.attempts + 1 && next.status !== "submitted") {
    throw new Error(`${label} attempts can increase only when submitting the operation`);
  }
  if (current.providerId && next.providerId !== current.providerId) {
    throw new Error(`${label} provider result is immutable once recorded`);
  }
  if (next.status === "succeeded" && !next.providerId) {
    throw new Error(`${label} cannot succeed without a provider identifier`);
  }
}

function assertSagaUpdate(current: ExecutionSaga, next: ExecutionSaga, expectedVersion: number): void {
  if (next.version !== expectedVersion) {
    throw new Error(`Saga version cannot be rewritten for claim ${next.claimId}`);
  }
  if (!allowedSagaTransitions[current.state].has(next.state)) {
    throw new Error(`Saga state cannot move from ${current.state} to ${next.state}`);
  }
  if (
    next.providerMode !== current.providerMode ||
    next.createdAt !== current.createdAt ||
    !sameJson(next.approval, current.approval)
  ) {
    throw new Error(`Saga approval and provider identity are immutable for claim ${next.claimId}`);
  }
  if (next.reversals.length !== current.reversals.length) {
    throw new Error(`Saga reversal steps are immutable for claim ${next.claimId}`);
  }
  current.reversals.forEach((step, index) => {
    const nextStep = next.reversals[index];
    assertStepUpdate(step, nextStep, `Reversal step ${step.id}`);
    if (
      nextStep.transferId !== step.transferId ||
      nextStep.providerTransferId !== step.providerTransferId ||
      nextStep.sellerId !== step.sellerId
    ) {
      throw new Error(`Reversal step ${step.id} routing is immutable`);
    }
  });
  assertStepUpdate(current.refund, next.refund, `Refund step ${current.refund.id}`);
  if (next.refund.paymentId !== current.refund.paymentId) {
    throw new Error(`Refund step ${current.refund.id} payment is immutable`);
  }
  if (next.audit.length < current.audit.length) {
    throw new Error(`Saga audit history cannot be truncated for claim ${next.claimId}`);
  }
  current.audit.forEach((record, index) => {
    if (!sameJson(record, next.audit[index])) {
      throw new Error(`Saga audit history cannot be rewritten for claim ${next.claimId}`);
    }
  });
  if (new Set(next.audit.map((record) => record.id)).size !== next.audit.length) {
    throw new Error(`Saga audit record IDs must be unique for claim ${next.claimId}`);
  }
  if (current.completedAt && next.completedAt !== current.completedAt) {
    throw new Error(`Saga completion time is immutable for claim ${next.claimId}`);
  }
  if (next.completedAt && next.state !== "completed") {
    throw new Error(`Only a completed saga can have a completion time for claim ${next.claimId}`);
  }
  if (
    next.state === "completed" &&
    (next.refund.status !== "succeeded" || next.reversals.some((step) => step.status !== "succeeded") || !next.completedAt)
  ) {
    throw new Error(`A completed saga requires confirmed provider operations for claim ${next.claimId}`);
  }
  if (next.updatedAt < current.updatedAt) {
    throw new Error(`Saga update time cannot move backward for claim ${next.claimId}`);
  }
}

export class InMemorySagaStore implements SagaStore {
  private readonly byClaimId = new Map<string, ExecutionSaga>();
  private readonly returnedQuantityByOrderLine = new Map<string, {
    orderedQuantity: number;
    byClaim: Map<string, number>;
  }>();

  async findByClaimId(claimId: string): Promise<ExecutionSaga | undefined> {
    const saga = this.byClaimId.get(claimId);
    return saga ? cloneSaga(saga) : undefined;
  }

  async insert(saga: ExecutionSaga): Promise<ExecutionSaga> {
    if (this.byClaimId.has(saga.claimId)) throw new Error(`A saga already exists for claim ${saga.claimId}`);
    if (
      saga.claimId !== saga.planSnapshot.claimId ||
      saga.orderId !== saga.planSnapshot.orderId ||
      stablePlanFingerprint(saga.planSnapshot) !== saga.planFingerprint
    ) {
      throw new Error(`Saga identity or fingerprint does not match its refund plan for claim ${saga.claimId}`);
    }

    const requestedByLine = new Map<string, { orderLineId: string; orderedQuantity: number; quantity: number }>();
    for (const item of saga.planSnapshot.decisionBasis.returnedItems) {
      if (
        !item.orderLineId ||
        !Number.isSafeInteger(item.orderLineQuantity) ||
        item.orderLineQuantity <= 0 ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity <= 0
      ) {
        throw new Error(`Invalid returned-quantity reservation for claim ${saga.claimId}`);
      }
      const key = `${saga.orderId}\u0000${item.orderLineId}`;
      const pending = requestedByLine.get(key);
      if (pending && pending.orderedQuantity !== item.orderLineQuantity) {
        throw new Error(`Conflicting ordered quantities for order line ${item.orderLineId}`);
      }
      const requestedQuantity = (pending?.quantity ?? 0) + item.quantity;
      if (!Number.isSafeInteger(requestedQuantity)) {
        throw new Error(`Returned quantity reservation overflow for order line ${item.orderLineId}`);
      }
      requestedByLine.set(key, {
        orderLineId: item.orderLineId,
        orderedQuantity: item.orderLineQuantity,
        quantity: requestedQuantity,
      });
    }

    // Validate the complete reservation set before mutating either map. This is
    // atomic within this single-process demo store; a production implementation
    // must enforce the same check in one database transaction.
    for (const [key, requested] of requestedByLine) {
      const current = this.returnedQuantityByOrderLine.get(key);
      if (current && current.orderedQuantity !== requested.orderedQuantity) {
        throw new Error(`Ordered quantity changed for order line ${requested.orderLineId}; recalculate the refund plan`);
      }
      const alreadyReserved = current
        ? [...current.byClaim.values()].reduce((sum, quantity) => sum + BigInt(quantity), BigInt(0))
        : BigInt(0);
      if (alreadyReserved + BigInt(requested.quantity) > BigInt(requested.orderedQuantity)) {
        throw new Error(
          `Returned quantity reservation conflict for order line ${requested.orderLineId}: ` +
          `${alreadyReserved.toString()} already reserved and ${requested.quantity} requested, but only ${requested.orderedQuantity} ordered`,
        );
      }
    }

    const stored = cloneSaga(saga);
    this.byClaimId.set(saga.claimId, stored);
    for (const [key, requested] of requestedByLine) {
      const current = this.returnedQuantityByOrderLine.get(key) ?? {
        orderedQuantity: requested.orderedQuantity,
        byClaim: new Map<string, number>(),
      };
      current.byClaim.set(saga.claimId, requested.quantity);
      this.returnedQuantityByOrderLine.set(key, current);
    }
    return cloneSaga(stored);
  }

  async save(saga: ExecutionSaga, expectedVersion: number): Promise<ExecutionSaga> {
    const current = this.byClaimId.get(saga.claimId);
    if (!current) throw new Error(`Saga ${saga.id} does not exist`);
    if (current.version !== expectedVersion) throw new Error(`Concurrent saga update detected for ${saga.claimId}`);
    if (
      saga.id !== current.id ||
      saga.orderId !== current.orderId ||
      saga.planFingerprint !== current.planFingerprint ||
      stablePlanFingerprint(saga.planSnapshot) !== current.planFingerprint
    ) {
      throw new Error(`Approved refund plan is immutable for claim ${saga.claimId}`);
    }
    assertSagaUpdate(current, saga, expectedVersion);
    const stored = cloneSaga({ ...saga, version: expectedVersion + 1 });
    this.byClaimId.set(saga.claimId, stored);
    return cloneSaga(stored);
  }
}

export interface ExecuteRefundInput {
  plan: RefundPlan;
  order: Order;
  policy: Policy;
  provider: RoutePaymentProvider;
  store: SagaStore;
  approval: {
    actorId: string;
    actorName: string;
    requestId: string;
    approvedAt?: ISODateTime;
    isOverride?: boolean;
    overrideReason?: string;
  };
  now?: () => Date;
}

function stablePlanFingerprint(plan: RefundPlan): string {
  const lines = [...plan.lineAllocations]
    .sort((a, b) => a.orderLineId < b.orderLineId ? -1 : a.orderLineId > b.orderLineId ? 1 : 0)
    .map((line) => ({
      orderLineId: line.orderLineId,
      title: line.title,
      sellerId: line.sellerId,
      transferId: line.transferId,
      quantity: line.quantity,
      grossPaise: line.grossPaise,
      discountAllocationPaise: line.discountAllocationPaise,
      customerRefundPaise: line.customerRefundPaise,
    }));
  const reversals = [...plan.sellerReversals]
    .sort((a, b) => a.transferId < b.transferId ? -1 : a.transferId > b.transferId ? 1 : 0)
    .map((entry) => ({
      sellerId: entry.sellerId,
      sellerName: entry.sellerName,
      transferId: entry.transferId,
      providerTransferId: entry.providerTransferId,
      amountPaise: entry.amountPaise,
      remainingReversiblePaise: entry.remainingReversiblePaise,
      reason: entry.reason,
    }));
  const returnedItems = [...plan.decisionBasis.returnedItems]
    .sort((a, b) => a.orderLineId.localeCompare(b.orderLineId))
    .map((item) => ({
      orderLineId: item.orderLineId,
      orderLineQuantity: item.orderLineQuantity,
      quantity: item.quantity,
      evidenceHash: item.evidenceHash,
    }));
  const policyRules = {
    marketplaceCommissionBps: plan.policySnapshot.rules.marketplaceCommissionBps,
    sellerLiableReasons: [...plan.policySnapshot.rules.sellerLiableReasons].sort(),
    refundOutboundShippingOnPartialReturn: plan.policySnapshot.rules.refundOutboundShippingOnPartialReturn,
    refundOutboundShippingOnFullReturn: plan.policySnapshot.rules.refundOutboundShippingOnFullReturn,
    customerRemorseRefundable: plan.policySnapshot.rules.customerRemorseRefundable,
  };
  const canonicalPlan = JSON.stringify({
    calculationVersion: plan.calculationVersion,
    claimId: plan.claimId,
    orderId: plan.orderId,
    paymentId: plan.paymentId,
    currency: plan.currency,
    reason: plan.decisionBasis.reason,
    liability: plan.decisionBasis.liability,
    returnedItems,
    policyId: plan.policySnapshot.id,
    policyVersion: plan.policySnapshot.version,
    policyCitation: plan.policySnapshot.citation,
    policyEffectiveFrom: plan.policySnapshot.effectiveFrom,
    policyEffectiveTo: plan.policySnapshot.effectiveTo ?? null,
    policyRules,
    providerSnapshot: plan.providerSnapshot,
    lines,
    reversals,
    shippingRefundPaise: plan.shippingRefundPaise,
    customerRefundPaise: plan.customerRefundPaise,
    sellerFundedPaise: plan.sellerFundedPaise,
    marketplaceFundedPaise: plan.marketplaceFundedPaise,
  });
  return createHash("sha256").update(canonicalPlan, "utf8").digest("hex");
}

export function refundPlanFingerprint(plan: RefundPlan): string {
  return stablePlanFingerprint(plan);
}

function validateApproval(input: ExecuteRefundInput): void {
  if (!input.approval.actorId.trim() || !input.approval.actorName.trim()) {
    throw new Error("A named human approver is required before money movement");
  }
  if (!input.approval.requestId.trim()) throw new Error("An approval request ID is required for the audit trail");
  if (input.approval.isOverride && !input.approval.overrideReason?.trim()) {
    throw new Error("A reason is required for every manual override");
  }
}

function validateInitialPlan(input: ExecuteRefundInput): void {
  const issues = validateRefundPlan(input.plan, input.order, input.policy);
  if (issues.length > 0) throw new Error(`Unsafe refund plan: ${issues.map((entry) => entry.message).join("; ")}`);
}

export async function verifyRefundPlanProviderSnapshot(
  plan: RefundPlan,
  order: Order,
  provider: RoutePaymentProvider,
): Promise<ProviderSnapshotVerification> {
  const expectedTransfers: Array<VerifyRefundCapacityRequest["transfers"][number]> = [];
  for (const reversal of plan.sellerReversals) {
    const transfer = order.transfers.find((entry) => entry.id === reversal.transferId);
    if (!transfer) {
      return { outcome: "mismatch", message: "A seller transfer in the plan is not present on the order." };
    }
    expectedTransfers.push({
      providerTransferId: reversal.providerTransferId,
      expectedSourcePaymentId: plan.paymentId,
      expectedLinkedAccountId: transfer.linkedAccountId,
      expectedOriginalAmountPaise: transfer.originalAmountPaise,
      expectedReversedAmountPaise: transfer.reversedAmountPaise,
      expectedRemainingReversiblePaise: reversal.remainingReversiblePaise,
    });
  }
  return provider.verifyRefundCapacity({
    paymentId: plan.paymentId,
    expectedCapturedPaymentPaise: plan.providerSnapshot.capturedPaymentPaise,
    expectedRefundedPaymentPaise: plan.providerSnapshot.previouslyRefundedPaise,
    expectedRemainingRefundablePaise: plan.providerSnapshot.remainingRefundablePaise,
    transfers: expectedTransfers,
  });
}

function createSaga(input: ExecuteRefundInput, at: ISODateTime): ExecutionSaga {
  const fingerprint = stablePlanFingerprint(input.plan);
  const sagaId = `saga_${input.plan.claimId}`;
  const approval: ApprovalRecord = {
    actorId: input.approval.actorId,
    actorName: input.approval.actorName,
    requestId: input.approval.requestId,
    approvedAt: input.approval.approvedAt ?? at,
    isOverride: input.approval.isOverride ?? false,
    ...(input.approval.overrideReason ? { overrideReason: input.approval.overrideReason } : {}),
  };
  const reversals: ReversalSagaStep[] = input.plan.sellerReversals.map((entry, index) => ({
    id: `${sagaId}_reversal_${index + 1}`,
    kind: "transfer_reversal",
    transferId: entry.transferId,
    providerTransferId: entry.providerTransferId,
    sellerId: entry.sellerId,
    amountPaise: entry.amountPaise,
    receipt: `rs_${input.plan.claimId}_r${index + 1}`,
    idempotencyKey: `${sagaId}:reversal:${entry.transferId}`,
    status: "ready",
    attempts: 0,
    updatedAt: at,
  }));
  const refund: RefundSagaStep = {
    id: `${sagaId}_refund`,
    kind: "payment_refund",
    paymentId: input.plan.paymentId,
    amountPaise: input.plan.customerRefundPaise,
    receipt: `rs_${input.plan.claimId}_refund`,
    idempotencyKey: `${sagaId}:refund`,
    status: "ready",
    attempts: 0,
    updatedAt: at,
  };
  return {
    id: sagaId,
    claimId: input.plan.claimId,
    orderId: input.plan.orderId,
    state: "approved",
    version: 1,
    providerMode: input.provider.mode,
    planFingerprint: fingerprint,
    planSnapshot: input.plan,
    approval,
    lastRequestId: approval.requestId,
    reversals,
    refund,
    audit: [
      {
        id: `${sagaId}_audit_1`,
        at,
        actor: approval.actorName,
        action: "refund_plan_approved",
        requestId: approval.requestId,
        detail: {
          planFingerprint: fingerprint,
          policyVersion: input.plan.policySnapshot.version,
          customerRefundPaise: input.plan.customerRefundPaise,
          sellerFundedPaise: input.plan.sellerFundedPaise,
          marketplaceFundedPaise: input.plan.marketplaceFundedPaise,
          providerMode: input.provider.mode,
          providerSnapshotVerifiedAt: at,
          isOverride: approval.isOverride,
          ...(approval.overrideReason ? { overrideReason: approval.overrideReason } : {}),
        },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
}

function audit(
  saga: ExecutionSaga,
  at: ISODateTime,
  action: string,
  detail: Readonly<Record<string, string | number | boolean>>,
  actor = "ReturnSplit executor",
  requestId = saga.lastRequestId,
): void {
  saga.audit.push({
    id: `${saga.id}_audit_${saga.audit.length + 1}`,
    at,
    actor,
    action,
    requestId,
    detail,
  });
  saga.updatedAt = at;
}

async function persisted(store: SagaStore, saga: ExecutionSaga): Promise<ExecutionSaga> {
  return store.save(saga, saga.version);
}

/**
 * Executes the persisted reversal-then-refund saga. A submitted or unknown step
 * is always looked up by receipt before returning; it is never posted twice.
 */
export async function executeApprovedRefund(input: ExecuteRefundInput): Promise<ExecutionSaga> {
  validateApproval(input);
  const now = input.now ?? (() => new Date());
  let saga = await input.store.findByClaimId(input.plan.claimId);
  const fingerprint = stablePlanFingerprint(input.plan);
  if (saga) {
    if (saga.planFingerprint !== fingerprint) throw new Error("A different refund plan is already bound to this claim");
    if (saga.providerMode !== input.provider.mode) throw new Error("A saga cannot switch payment providers after approval");
    if (saga.state === "completed") return saga;
    if (saga.lastRequestId !== input.approval.requestId) {
      const at = now().toISOString();
      const priorState = saga.state;
      saga.lastRequestId = input.approval.requestId;
      audit(
        saga,
        at,
        "execution_resume_requested",
        { actorId: input.approval.actorId, priorState },
        input.approval.actorName,
        input.approval.requestId,
      );
      saga = await persisted(input.store, saga);
    }
  } else {
    validateInitialPlan(input);
    const providerSnapshot = await verifyRefundPlanProviderSnapshot(input.plan, input.order, input.provider);
    if (providerSnapshot.outcome !== "verified") {
      throw new Error(`Provider preflight failed: ${providerSnapshot.message}`);
    }
    try {
      saga = await input.store.insert(createSaga(input, now().toISOString()));
    } catch (error) {
      // A concurrent duplicate may have inserted the same claim between the
      // initial read and insert. Re-read it; CAS still protects later steps.
      saga = await input.store.findByClaimId(input.plan.claimId);
      if (!saga) throw error;
      if (saga.planFingerprint !== fingerprint) throw new Error("A different refund plan is already bound to this claim");
      if (saga.providerMode !== input.provider.mode) throw new Error("A saga cannot switch payment providers after approval");
    }
  }

  for (let index = 0; index < saga.reversals.length; index += 1) {
    let step = saga.reversals[index];
    if (step.status === "succeeded") continue;
    if (step.status === "terminal_failure") return saga;

    if (step.status === "submitted" || step.status === "unknown") {
      const reconciliation = await input.provider.reconcileTransferReversal({
        providerTransferId: step.providerTransferId,
        amountPaise: step.amountPaise,
        receipt: step.receipt,
      });
      const at = now().toISOString();
      if (reconciliation.outcome === "succeeded") {
        step.status = "succeeded";
        step.providerId = reconciliation.providerId;
        step.providerStatus = reconciliation.providerStatus;
        step.errorCode = undefined;
        step.errorMessage = undefined;
        audit(saga, at, "transfer_reversal_reconciled", { transferId: step.transferId, providerId: reconciliation.providerId });
        saga = await persisted(input.store, saga);
        continue;
      }
      if (reconciliation.outcome === "failed") {
        step.status = reconciliation.retryable ? "retryable_failure" : "terminal_failure";
        step.errorCode = reconciliation.code;
        step.errorMessage = reconciliation.message;
        saga.state = "failed";
        audit(saga, at, "transfer_reversal_failed", { transferId: step.transferId, code: reconciliation.code, retryable: reconciliation.retryable });
        return persisted(input.store, saga);
      }
      step.status = "unknown";
      saga.state = "reversal_result_unknown";
      step.errorMessage = reconciliation.outcome === "not_found"
        ? "The reversal was not found during reconciliation; automatic replay is paused"
        : reconciliation.outcome === "pending"
          ? `Provider status is ${reconciliation.providerStatus}`
          : reconciliation.message;
      audit(saga, at, "transfer_reversal_reconciliation_pending", { transferId: step.transferId, outcome: reconciliation.outcome });
      return persisted(input.store, saga);
    }

    saga.state = "reversing_transfers";
    step.status = "submitted";
    step.attempts += 1;
    step.updatedAt = now().toISOString();
    audit(saga, step.updatedAt, "transfer_reversal_submitted", { transferId: step.transferId, amountPaise: step.amountPaise, attempt: step.attempts });
    saga = await persisted(input.store, saga); // intent is durable before the provider call
    step = saga.reversals[index];

    const result = await input.provider.reverseTransfer({
      providerTransferId: step.providerTransferId,
      amountPaise: step.amountPaise,
      receipt: step.receipt,
      idempotencyKey: step.idempotencyKey,
      notes: { claim_id: saga.claimId, saga_id: saga.id },
    });
    const at = now().toISOString();
    if (result.outcome === "succeeded") {
      step.status = "succeeded";
      step.providerId = result.providerId;
      step.providerStatus = result.providerStatus;
      audit(saga, at, "transfer_reversed", { transferId: step.transferId, providerId: result.providerId, amountPaise: step.amountPaise });
      saga = await persisted(input.store, saga);
      continue;
    }
    if (result.outcome === "failed") {
      step.status = result.retryable ? "retryable_failure" : "terminal_failure";
      step.errorCode = result.code;
      step.errorMessage = result.message;
      saga.state = "failed";
      audit(saga, at, "transfer_reversal_failed", { transferId: step.transferId, code: result.code, retryable: result.retryable });
      return persisted(input.store, saga);
    }
    step.status = "unknown";
    step.errorMessage = result.message;
    saga.state = "reversal_result_unknown";
    audit(saga, at, "transfer_reversal_result_unknown", { transferId: step.transferId });
    return persisted(input.store, saga);
  }

  if (!saga.reversals.every((step) => step.status === "succeeded")) return saga;
  let refund = saga.refund;
  if (refund.status === "terminal_failure") return saga;

  if (refund.status === "submitted" || refund.status === "unknown") {
    const reconciliation = await input.provider.reconcileRefund({ paymentId: refund.paymentId, amountPaise: refund.amountPaise, receipt: refund.receipt });
    const at = now().toISOString();
    if (reconciliation.outcome === "succeeded") {
      refund.status = "succeeded";
      refund.providerId = reconciliation.providerId;
      refund.providerStatus = reconciliation.providerStatus;
      saga.state = "completed";
      saga.completedAt = at;
      audit(saga, at, "refund_reconciled_and_completed", { providerId: reconciliation.providerId, amountPaise: refund.amountPaise });
      return persisted(input.store, saga);
    }
    if (reconciliation.outcome === "failed") {
      refund.status = reconciliation.retryable ? "retryable_failure" : "terminal_failure";
      refund.errorCode = reconciliation.code;
      refund.errorMessage = reconciliation.message;
      saga.state = "failed";
      audit(saga, at, "refund_failed", { code: reconciliation.code, retryable: reconciliation.retryable });
      return persisted(input.store, saga);
    }
    refund.status = "unknown";
    saga.state = "refund_result_unknown";
    refund.errorMessage = reconciliation.outcome === "not_found"
      ? "The refund was not found during reconciliation; automatic replay is paused"
      : reconciliation.outcome === "pending"
        ? `Provider status is ${reconciliation.providerStatus}`
        : reconciliation.message;
    audit(saga, at, "refund_reconciliation_pending", { outcome: reconciliation.outcome });
    return persisted(input.store, saga);
  }

  if (refund.status === "succeeded") {
    saga.state = "completed";
    saga.completedAt ??= now().toISOString();
    return persisted(input.store, saga);
  }

  saga.state = "refunding_payment";
  refund.status = "submitted";
  refund.attempts += 1;
  refund.updatedAt = now().toISOString();
  audit(saga, refund.updatedAt, "refund_submitted", { paymentId: refund.paymentId, amountPaise: refund.amountPaise, attempt: refund.attempts });
  saga = await persisted(input.store, saga); // intent is durable before the provider call
  refund = saga.refund;

  const result = await input.provider.createRefund({
    paymentId: refund.paymentId,
    amountPaise: refund.amountPaise,
    receipt: refund.receipt,
    idempotencyKey: refund.idempotencyKey,
    notes: { claim_id: saga.claimId, saga_id: saga.id },
  });
  const at = now().toISOString();
  if (result.outcome === "succeeded") {
    refund.status = "succeeded";
    refund.providerId = result.providerId;
    refund.providerStatus = result.providerStatus;
    saga.state = "completed";
    saga.completedAt = at;
    audit(saga, at, "refund_created_and_completed", { providerId: result.providerId, amountPaise: refund.amountPaise });
    return persisted(input.store, saga);
  }
  if (result.outcome === "failed") {
    refund.status = result.retryable ? "retryable_failure" : "terminal_failure";
    refund.errorCode = result.code;
    refund.errorMessage = result.message;
    saga.state = "failed";
    audit(saga, at, "refund_failed", { code: result.code, retryable: result.retryable });
    return persisted(input.store, saga);
  }
  refund.status = "unknown";
  refund.errorMessage = result.message;
  saga.state = "refund_result_unknown";
  audit(saga, at, "refund_result_unknown", { paymentId: refund.paymentId });
  return persisted(input.store, saga);
}
