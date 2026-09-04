"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { claimOperationPresentation } from "@/lib/claim-operation-presentation";
import type {
  ClaimWorkbenchActivity,
  ClaimWorkbenchClaim,
  ClaimWorkbenchOrder,
  ClaimWorkbenchPolicy,
  ClaimWorkbenchReceipt,
} from "@/lib/claim-workbench-view";
import type { LiabilityParty } from "@/lib/types";
import { Avatar } from "./avatar";
import { Icon } from "./icons";
import { Card, Money, StatusPill } from "./ui";

type LocalState = "initial" | "confirm" | "executing" | "completed";
type CaseNote = {
  recordedAt: string;
  actor: string;
  redactedText: string;
  sha256: string;
};
type EscalationReceiptBase = {
  caseId: string;
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
  noteRecorded: boolean;
  notes: readonly CaseNote[];
  ageHours: number;
  overdue: boolean;
  closedAt?: string;
};
type ReviewEscalationReceipt = EscalationReceiptBase & { kind: "reconciliation" | "evidence_request" };
type RecoveryReceipt = EscalationReceiptBase & {
  kind: "recovery";
  targetAmountPaise: number;
  recoveredAmountPaise: number;
  writtenOffAmountPaise: number;
  outstandingAmountPaise: number;
  responsibleParty: "unresolved" | "seller" | "courier" | "marketplace";
  recoveryOutcome: "pending" | "partial" | "recovered" | "written_off" | "mixed";
};
type EscalationReceipt = ReviewEscalationReceipt | RecoveryReceipt;
type ReviewState = "idle" | "saving" | "saved" | "error";
type BalanceCheckState = "not_required" | "required" | "checking" | "verified" | "error";
type RecoveryState = "idle" | "saving" | "saved" | "error";
type RecoveryErrorTarget = "amounts" | "responsible_party" | "note" | "closure" | "form";

export function ClaimWorkbench({
  claim,
  order,
  policy,
  planFingerprint,
  initialReceipt,
  initialEscalation,
  closedEscalations = [],
  initialPreflight,
  reviewEvents = [],
  providerMode,
  providerLabel,
}: {
  claim: ClaimWorkbenchClaim;
  order: ClaimWorkbenchOrder;
  policy: ClaimWorkbenchPolicy;
  planFingerprint?: string;
  initialReceipt?: ClaimWorkbenchReceipt;
  initialEscalation?: EscalationReceipt;
  closedEscalations?: readonly EscalationReceipt[];
  initialPreflight?: { planFingerprint: string; checkedAt: string; expiresAt: string };
  reviewEvents?: readonly ClaimWorkbenchActivity[];
  providerMode: "demo" | "razorpay_test";
  providerLabel: string;
}) {
  const router = useRouter();
  const [localState, setLocalState] = useState<LocalState>("initial");
  const [selectedLine, setSelectedLine] = useState("");
  const [evidenceRationale, setEvidenceRationale] = useState("");
  const [executionError, setExecutionError] = useState("");
  const [reviewState, setReviewState] = useState<ReviewState>("idle");
  const [reviewError, setReviewError] = useState("");
  const hasFreshInitialPreflight = Boolean(initialPreflight && initialPreflight.planFingerprint === planFingerprint);
  const [balanceCheckState, setBalanceCheckState] = useState<BalanceCheckState>(hasFreshInitialPreflight ? "verified" : claim.status === "ready_for_approval" && !claim.approvedAt ? "required" : "not_required");
  const [balanceCheckFingerprint, setBalanceCheckFingerprint] = useState(hasFreshInitialPreflight ? initialPreflight?.planFingerprint ?? "" : planFingerprint ?? "");
  const [balanceCheckedAt, setBalanceCheckedAt] = useState(hasFreshInitialPreflight ? initialPreflight?.checkedAt ?? "" : "");
  const [balanceExpiresAt, setBalanceExpiresAt] = useState(hasFreshInitialPreflight ? initialPreflight?.expiresAt ?? "" : "");
  const [balanceError, setBalanceError] = useState("");
  const [escalation, setEscalation] = useState<EscalationReceipt | undefined>(initialEscalation);
  const [escalating, setEscalating] = useState(false);
  const initialRecovery = initialEscalation?.kind === "recovery" ? initialEscalation : undefined;
  const [recoveryState, setRecoveryState] = useState<RecoveryState>("idle");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryErrorTarget, setRecoveryErrorTarget] = useState<RecoveryErrorTarget>();
  const [recoveryResponsibleParty, setRecoveryResponsibleParty] = useState<"" | "seller" | "courier" | "marketplace">(
    initialRecovery?.responsibleParty === "unresolved" ? "" : initialRecovery?.responsibleParty ?? "",
  );
  const [recoveredRupees, setRecoveredRupees] = useState(initialRecovery ? paiseInput(initialRecovery.recoveredAmountPaise) : "0.00");
  const [writtenOffRupees, setWrittenOffRupees] = useState(initialRecovery ? paiseInput(initialRecovery.writtenOffAmountPaise) : "0.00");
  const [recoveryNote, setRecoveryNote] = useState("");
  const [closeRecovery, setCloseRecovery] = useState(false);
  const [receipt, setReceipt] = useState<ClaimWorkbenchReceipt | undefined>(initialReceipt);
  const [isRefreshing, startStatusRefresh] = useTransition();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const executionStatusRef = useRef<HTMLDivElement>(null);
  const approvalButtonRef = useRef<HTMLButtonElement>(null);
  const escalationStatusRef = useRef<HTMLDivElement>(null);
  const focusApprovalAfterRefreshRef = useRef(false);
  const plan = claim.decision;
  const isRetry = claim.execution?.canResume === true;
  const retryingRefund = isRetry && claim.execution?.pendingOperation === "payment_refund";
  const requiresReconciliation = claim.execution?.requiresReconciliation === true;
  const operation = claimOperationPresentation(claim);
  const needsManualIntervention = operation.kind === "manual_intervention";
  const executionInProgress = operation.kind === "executing" || operation.kind === "executing_reversal" || operation.kind === "executing_refund";
  const isResolvedLocally = localState === "completed";
  const completedReversalIds = new Set(claim.execution?.completedReversalTransferIds ?? []);
  const pendingReversals = plan?.sellerReversals.filter((reversal) => !completedReversalIds.has(reversal.transferId)) ?? [];
  const pendingSellerPaise = pendingReversals.reduce((sum, reversal) => sum + reversal.amountPaise, 0);
  const approvalLabel = retryingRefund ? "Retry customer refund" : isRetry ? "Retry and finish" : "Approve and execute";
  const confirmLabel = retryingRefund ? "Retry refund" : isRetry ? "Retry and refund" : plan?.sellerFundedPaise ? "Reverse and refund" : "Issue refund";

  useEffect(() => {
    if (localState !== "confirm") return;
    priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
    closeRef.current?.focus();
    return () => priorFocusRef.current?.focus();
  }, [localState]);

  useEffect(() => {
    if (localState === "executing" || localState === "completed") {
      window.requestAnimationFrame(() => executionStatusRef.current?.focus());
    } else if (localState === "initial" && executionError) {
      window.requestAnimationFrame(() => approvalButtonRef.current?.focus());
    }
  }, [executionError, localState]);

  useEffect(() => {
    if (!focusApprovalAfterRefreshRef.current || !planFingerprint) return;
    focusApprovalAfterRefreshRef.current = false;
    window.requestAnimationFrame(() => approvalButtonRef.current?.focus());
  }, [claim.status, planFingerprint]);

  useEffect(() => {
    if (balanceCheckState !== "verified" || balanceCheckFingerprint !== planFingerprint) return;
    const expiresAt = Date.parse(balanceExpiresAt);
    const delay = Number.isFinite(expiresAt) ? Math.max(0, expiresAt - Date.now()) : 0;
    const timeout = window.setTimeout(() => {
      setBalanceCheckState("required");
      setBalanceCheckedAt("");
      setBalanceExpiresAt("");
      setLocalState((state) => state === "confirm" ? "initial" : state);
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [balanceCheckFingerprint, balanceCheckState, balanceExpiresAt, planFingerprint]);

  async function refreshProviderBalances() {
    if (!planFingerprint) return;
    setBalanceCheckFingerprint(planFingerprint);
    setBalanceCheckState("checking");
    setBalanceExpiresAt("");
    setBalanceError("");
    try {
      const response = await fetch(`/api/claims/${encodeURIComponent(claim.id)}/preflight`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-returnsplit-request-id": `preflight_${claim.id}_${Date.now()}` },
        body: JSON.stringify({ expectedPlanFingerprint: planFingerprint }),
      });
      const body = await response.json() as { status?: string; checkedAt?: string; expiresAt?: string; error?: string };
      const expiresAt = body.expiresAt ? Date.parse(body.expiresAt) : Number.NaN;
      if (!response.ok || body.status !== "verified" || !body.checkedAt || !body.expiresAt || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error(body.error ?? "Provider balances could not be verified.");
      }
      setBalanceCheckedAt(body.checkedAt);
      setBalanceExpiresAt(body.expiresAt);
      setBalanceCheckState("verified");
    } catch (error) {
      setBalanceError(error instanceof Error ? error.message : "Provider balances could not be verified.");
      setBalanceCheckState("error");
    }
  }

  async function executePlan() {
    if (!planFingerprint) {
      setExecutionError("This plan has no review fingerprint. Reload before approving it.");
      return;
    }
    const approvalNeedsPreflight = claim.status === "ready_for_approval" && !claim.approvedAt && !isRetry;
    const expiration = Date.parse(balanceExpiresAt);
    if (approvalNeedsPreflight && (
      balanceCheckState !== "verified"
      || balanceCheckFingerprint !== planFingerprint
      || !Number.isFinite(expiration)
      || expiration <= Date.now()
    )) {
      setBalanceCheckState("required");
      setBalanceCheckedAt("");
      setBalanceExpiresAt("");
      setBalanceError("The previous balance check expired. Check current balances again before approval.");
      setLocalState("initial");
      return;
    }
    setLocalState("executing");
    setExecutionError("");
    try {
      const response = await fetch(`/api/claims/${encodeURIComponent(claim.id)}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-returnsplit-request-id": `approval_${claim.id}_${crypto.randomUUID()}` },
        body: JSON.stringify({ expectedPlanFingerprint: planFingerprint }),
      });
      const body = await response.json() as Partial<ClaimWorkbenchReceipt> & { state?: string; error?: string; message?: string; lastError?: string };
      if (body.state && body.state !== "completed") {
        setExecutionError(body.lastError ?? body.message ?? "Execution paused safely before the next money movement.");
        setLocalState("initial");
        router.refresh();
        return;
      }
      if (!response.ok || body.state !== "completed") throw new Error(body.error ?? "Execution did not complete");
      if (body.completedAt && body.requestId && body.planFingerprint && body.refundId && body.reversals) {
        setReceipt({ completedAt: body.completedAt, requestId: body.requestId, planFingerprint: body.planFingerprint, refundId: body.refundId, reversals: body.reversals });
      }
      setLocalState("completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Execution paused safely";
      if (message.startsWith("Provider preflight failed:")) {
        setBalanceCheckState("error");
        setBalanceError(message.replace("Provider preflight failed:", "").trim());
        setExecutionError("");
      } else {
        setExecutionError(message);
      }
      setLocalState("initial");
    }
  }

  async function saveReviewDecision(decision: Record<string, string>) {
    setReviewState("saving");
    setReviewError("");
    try {
      const response = await fetch(`/api/claims/${encodeURIComponent(claim.id)}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-returnsplit-request-id": `review_${claim.id}_${Date.now()}` },
        body: JSON.stringify(decision),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The review decision could not be saved");
      setReviewState("saved");
      setEscalation((current) => current?.kind === "evidence_request" && current.status === "open"
        ? { ...current, status: "closed" }
        : current);
      focusApprovalAfterRefreshRef.current = true;
      router.refresh();
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "The review decision could not be saved");
      setReviewState("error");
    }
  }

  async function openOperationsCase(input?: { kind: "evidence_request"; rationale: string }) {
    setEscalating(true);
    setReviewError("");
    try {
      const requestId = `escalate_${claim.id}_${crypto.randomUUID()}`;
      const response = await fetch(`/api/claims/${encodeURIComponent(claim.id)}/escalate`, {
        method: "POST",
        headers: { ...(input ? { "content-type": "application/json" } : {}), "x-returnsplit-request-id": requestId },
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
      const body = await response.json() as Partial<EscalationReceipt> & { error?: string };
      if (!response.ok || !body.caseId || !body.createdAt || !body.requestId || !body.actor || !body.queue || !body.owner || !body.dueAt || !body.status || !body.nextAction || !body.kind) {
        throw new Error(body.error ?? "The reconciliation case could not be opened");
      }
      setEscalation(body as EscalationReceipt);
      window.requestAnimationFrame(() => escalationStatusRef.current?.focus());
      router.refresh();
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "The reconciliation case could not be opened");
    } finally {
      setEscalating(false);
    }
  }

  async function saveRecoveryUpdate() {
    const recoveryCase = escalation?.kind === "recovery" ? escalation : undefined;
    if (!recoveryCase || recoveryCase.status !== "open") return;
    const recoveredAmountPaise = parseRupeesToPaise(recoveredRupees);
    const writtenOffAmountPaise = parseRupeesToPaise(writtenOffRupees);
    const note = recoveryNote.trim();
    if (recoveredAmountPaise === undefined || writtenOffAmountPaise === undefined) {
      setRecoveryError("Enter recovered and written-off totals in rupees with no more than two decimal places.");
      setRecoveryErrorTarget("amounts");
      setRecoveryState("error");
      return;
    }
    if (recoveredAmountPaise < recoveryCase.recoveredAmountPaise || writtenOffAmountPaise < recoveryCase.writtenOffAmountPaise) {
      setRecoveryError("Cumulative recovered and written-off totals cannot decrease.");
      setRecoveryErrorTarget("amounts");
      setRecoveryState("error");
      return;
    }
    if (!recoveryResponsibleParty) {
      setRecoveryError("Select the party responsible for this recovery outcome.");
      setRecoveryErrorTarget("responsible_party");
      setRecoveryState("error");
      return;
    }
    if (note.length < 12 || note.length > 500) {
      setRecoveryError("Add an operator note between 12 and 500 characters.");
      setRecoveryErrorTarget("note");
      setRecoveryState("error");
      return;
    }
    const accountedAmountPaise = recoveredAmountPaise + writtenOffAmountPaise;
    if (accountedAmountPaise > recoveryCase.targetAmountPaise) {
      setRecoveryError("Recovered and written-off totals cannot exceed the recovery target.");
      setRecoveryErrorTarget("amounts");
      setRecoveryState("error");
      return;
    }
    if (closeRecovery !== (accountedAmountPaise === recoveryCase.targetAmountPaise)) {
      setRecoveryError(accountedAmountPaise === recoveryCase.targetAmountPaise
        ? "The full target is accounted for. Mark the case closed to save this update."
        : "A case can close only after the full target is recovered or written off.");
      setRecoveryErrorTarget("closure");
      setRecoveryState("error");
      return;
    }

    setRecoveryState("saving");
    setRecoveryError("");
    setRecoveryErrorTarget(undefined);
    try {
      const response = await fetch(`/api/claims/${encodeURIComponent(claim.id)}/recovery`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-returnsplit-request-id": `recovery_${claim.id}_${crypto.randomUUID()}` },
        body: JSON.stringify({
          recoveredAmountPaise,
          writtenOffAmountPaise,
          responsibleParty: recoveryResponsibleParty,
          note,
          status: closeRecovery ? "closed" : "open",
        }),
      });
      const body = await response.json() as Partial<RecoveryReceipt> & { error?: string };
      if (!response.ok || body.kind !== "recovery" || !body.caseId || typeof body.outstandingAmountPaise !== "number") {
        throw new Error(body.error ?? "The recovery update could not be saved.");
      }
      setEscalation(body as RecoveryReceipt);
      setRecoveredRupees(paiseInput(body.recoveredAmountPaise ?? recoveredAmountPaise));
      setWrittenOffRupees(paiseInput(body.writtenOffAmountPaise ?? writtenOffAmountPaise));
      setRecoveryNote("");
      setRecoveryState("saved");
      setRecoveryErrorTarget(undefined);
      router.refresh();
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : "The recovery update could not be saved.");
      setRecoveryErrorTarget("form");
      setRecoveryState("error");
    }
  }

  function refreshStatus() {
    startStatusRefresh(() => router.refresh());
  }

  function clearRecoveryFeedback() {
    setRecoveryState("idle");
    setRecoveryError("");
    setRecoveryErrorTarget(undefined);
  }

  const openRecovery = escalation?.kind === "recovery" && escalation.status === "open";
  const refundCompleted = isResolvedLocally || claim.status === "completed";
  const refundCompletedWithOpenRecovery = openRecovery && refundCompleted;
  const visibleClosedEscalations = closedEscalations
    .filter((entry) => !(escalation?.kind === "recovery" && entry.caseId === escalation.caseId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const currentStatus = openRecovery && refundCompleted ? "Refund complete · recovery open" : isResolvedLocally ? "Completed" : operation.label;
  const currentTone = openRecovery && refundCompleted ? "review" as const : isResolvedLocally ? "completed" as const : operation.tone;
  const approvalRecorded = isResolvedLocally || Boolean(claim.approvedAt);
  const requiresFreshBalanceCheck = claim.status === "ready_for_approval" && !approvalRecorded && !isRetry;
  const currentBalanceCheckState = balanceCheckFingerprint === planFingerprint
    ? balanceCheckState
    : requiresFreshBalanceCheck ? "required" : "not_required";
  const currentBalanceCheckedAt = balanceCheckFingerprint === planFingerprint ? balanceCheckedAt : "";
  const currentBalanceError = balanceCheckFingerprint === planFingerprint ? balanceError : "";
  const returnedLines = claim.returnedItems.map((returned) => ({
    returned,
    line: order.lines.find((line) => line.id === returned.orderLineId),
  }));
  const everyItemMatched = returnedLines.every(({ line }) => Boolean(line));
  const returnedQuantityByLine = new Map<string, number>();
  for (const returned of claim.returnedItems) {
    if (!returned.orderLineId) continue;
    returnedQuantityByLine.set(returned.orderLineId, (returnedQuantityByLine.get(returned.orderLineId) ?? 0) + returned.quantity);
  }
  const isFullReturn = everyItemMatched
    && order.lines.every((line) => returnedQuantityByLine.get(line.id) === line.quantity);
  const visibleReviewFlags = claim.review.flags.filter((flag) => flag.code !== "provider_failure" && flag.code !== "provider_result_unknown");
  const fundingSummary = !plan
    ? "Complete the highlighted review to calculate who funds the refund."
    : retryingRefund
      ? `All seller reversals are confirmed. Retry the ${formatMoney(plan.customerRefundPaise)} customer refund.`
      : isRetry
      ? `Retry ${formatMoney(pendingSellerPaise)} from ${pendingReversals.map((entry) => entry.sellerName).join(" + ")}, then refund ${formatMoney(plan.customerRefundPaise)}.`
      : plan.sellerFundedPaise
        ? `Reverse ${formatMoney(plan.sellerFundedPaise)} from ${plan.sellerReversals.map((entry) => entry.sellerName).join(" + ")}. Creo Market contributes ${formatMoney(plan.marketplaceFundedPaise)}.`
        : `Creo Market funds the full ${formatMoney(plan.customerRefundPaise)} refund.`;
  const safetyMessage = openRecovery && refundCompleted
    ? "Recovery updates record accounting outcomes only; they cannot move customer or seller funds."
    : requiresReconciliation
    ? "No retry will run until the provider result is confirmed."
    : needsManualIntervention
      ? "Automatic execution is blocked while payments operations resolves this failure."
      : isRetry
        ? "Retry skips every confirmed movement."
        : plan
          ? "Any change to the evidence, policy, or amount requires a new approval."
          : "No money can move until the required review is complete.";
  const paymentPreflight = requiresReconciliation
    ? { text: "Provider result must be checked before any retry", status: "pending" as const }
    : needsManualIntervention
      ? { text: "Automatic execution is blocked pending payments review", status: "fail" as const }
      : executionInProgress
        ? { text: "Provider confirmation is still in progress", status: "pending" as const }
        : requiresFreshBalanceCheck && currentBalanceCheckState !== "verified"
          ? {
              text: currentBalanceCheckState === "checking"
                ? "Checking current payment and transfer balances"
                : `Refresh the provider balances; this plan used a snapshot from ${dateTime(plan?.calculatedAt ?? claim.submittedAt)}`,
              status: "pending" as const,
            }
        : requiresFreshBalanceCheck && currentBalanceCheckedAt
          ? { text: `Provider balances verified ${dateTime(currentBalanceCheckedAt)}`, status: "pass" as const }
        : claim.status === "needs_review"
          ? { text: "Payment checks run after the required review", status: "pending" as const }
          : claim.status === "blocked" || !plan
            ? { text: "Payment or transfer checks need attention", status: "fail" as const }
            : {
                text: `Balance snapshot captured ${dateTime(plan.calculatedAt)} · ${providerMode === "demo" ? "simulation" : providerLabel}`,
                status: "pass" as const,
              };

  return (
    <div className="page">
      <nav className="breadcrumb" aria-label="Breadcrumb"><Link href="/claims">Claims</Link><Icon name="chevron-right" /><span>{claim.reference}</span></nav>
      <header className="page-header">
        <div className="page-heading">
          <div className="detail-heading"><h1>Return claim {claim.reference}</h1><StatusPill tone={currentTone}>{currentStatus}</StatusPill></div>
          <div className="meta-line"><span>Order {order.reference}</span><span className="meta-person"><Avatar name={claim.customer.name} size={26} />{claim.customer.name}</span><span>Received {dateTime(claim.submittedAt)}</span></div>
        </div>
      </header>

      {isResolvedLocally && <div className="callout" style={{ marginBottom: 16 }} role="status"><Icon name="circle-check" /><div><strong>Execution completed</strong><p>{plan?.sellerReversals.length ? "All required seller reversals were confirmed before the customer refund. Every step was added to the audit trail." : "No seller reversal was required. The marketplace-funded customer refund was confirmed and added to the audit trail."}</p></div></div>}
      {visibleReviewFlags.map((flag) => <div key={flag.code} className={`callout ${flag.tone === "danger" ? "danger" : flag.tone === "warning" ? "warning" : "info"}`} style={{ marginBottom: 16 }}><Icon name={flag.tone === "danger" ? "circle-alert" : "clock"} /><div><strong>{flag.label}</strong><p>{flag.detail}</p></div></div>)}

      <div className="workbench-grid">
          <Card className="evidence-card" title="Claim assessment" description="Evidence, order match, and the policy-bound funding decision." action={<span className="extraction-note"><Icon name={everyItemMatched ? "circle-check" : "clock"} /> {everyItemMatched ? "Order line matched" : "Match needs review"}</span>}>
            <blockquote className="claim-quote">“{claim.claimText}”</blockquote>
            {returnedLines.map(({ returned, line }, index) => <div className="evidence-line" key={returned.id}>
              <div className="evidence-label"><div><div className="product-name">{line?.title ?? returned.claimedTitle}</div><div className="product-meta">{line ? line.variant ?? "No variant" : "Not matched to an order item"} · Qty {returned.quantity}</div></div></div>
              {line ? <StatusPill tone="active">Order match</StatusPill> : <StatusPill tone="review">Match required</StatusPill>}
              {index === 0 && !line && <span className="sr-only">This item needs human matching.</span>}
            </div>)}
            {claim.status === "needs_review" && claim.review.flags.some((flag) => flag.code === "ambiguous_item") && (
              <div className="review-form">
                {escalation?.kind === "evidence_request" && escalation.status === "open" && <div ref={escalationStatusRef} tabIndex={-1}><OperationsCase receipt={escalation} /></div>}
                <div className="field"><label htmlFor="order-line">Which item did the customer return?</label><select id="order-line" value={selectedLine} onChange={(event) => setSelectedLine(event.target.value)}><option value="">Choose an order line</option>{order.lines.map((line) => <option key={line.id} value={line.id}>{line.title} · {line.variant ?? "No variant"}</option>)}</select></div>
                <button className="button secondary" disabled={!selectedLine || reviewState === "saving"} onClick={() => {
                  const returnedItem = claim.returnedItems.find((item) => !item.orderLineId);
                  if (returnedItem) void saveReviewDecision({ kind: "item_match", returnedItemId: returnedItem.id, orderLineId: selectedLine });
                }}><Icon name="check" /> {reviewState === "saving" ? "Saving and recalculating…" : "Confirm item and recalculate"}</button>
                {!(escalation?.kind === "evidence_request" && escalation.status === "open") && <>
                  <details className="decision-alternative"><summary>Cannot determine from this evidence</summary><div className="decision-alternative-body"><div className="field"><label htmlFor="evidence-rationale">Why is more evidence required?</label><textarea id="evidence-rationale" maxLength={500} value={evidenceRationale} onChange={(event) => setEvidenceRationale(event.target.value)} placeholder="For example: both colour variants are identical in the current photo." /><p className="field-help">Required · 12–500 characters. The demo stores a redacted note and integrity hash, never the raw text.</p></div><button className="button secondary" disabled={evidenceRationale.trim().length < 12 || escalating} onClick={() => void openOperationsCase({ kind: "evidence_request", rationale: evidenceRationale })}><Icon name="clock" />{escalating ? "Opening request…" : "Request customer evidence"}</button></div></details>
                </>}
                {reviewError && reviewState !== "error" && <div className="callout danger" role="alert"><Icon name="circle-alert" /><div><strong>Request not opened</strong><p>{reviewError}</p></div></div>}
                {reviewState === "saved" && <div className="callout" role="status"><Icon name="circle-check" /><div><strong>Review saved</strong><p>The claim was recalculated and the updated plan is loading.</p></div></div>}
                {reviewState === "error" && <div className="callout danger" role="alert"><Icon name="circle-alert" /><div><strong>Review not saved</strong><p>{reviewError}</p></div></div>}
              </div>
            )}
            <section className="assessment-section" aria-labelledby="funding-decision-heading">
              <div className="section-heading"><h3 id="funding-decision-heading">Funding decision</h3><p>The immediate funding source follows the locked policy. Recovery responsibility is tracked separately.</p></div>
            <div className="decision-list">
              <div className="decision-row"><div className="decision-key">Return reason</div><div className="decision-value">{claim.reasonLabel}</div></div>
              <div className="decision-row"><div className="decision-key">Immediate funding source</div><div className="decision-value">{fundingSourceText(claim.review.liability)}</div></div>
              <div className="decision-row"><div className="decision-key">Why</div><div className="decision-value">{claim.review.explanation}</div></div>
              <div className="decision-row"><div className="decision-key">Policy applied</div><div className="decision-value">{policy.name} v{policy.version} · effective {dateOnly(policy.effectiveFrom)}<div className="policy-citation"><strong>{policy.citation}</strong><br />{policy.summary}</div></div></div>
            </div>
            {claim.status === "needs_review" && claim.review.flags.some((flag) => flag.code === "liability_unclear") && (
              <div className="review-form">
                {escalation?.kind === "evidence_request" && escalation.status === "open" && <div ref={escalationStatusRef} tabIndex={-1}><OperationsCase receipt={escalation} /></div>}
                <p className="field-help">Creo Market can front the customer refund now. A recovery case will track courier or seller responsibility separately.</p>
                <button className="button secondary" disabled={reviewState === "saving"} onClick={() => void saveReviewDecision({ kind: "liability", liability: "marketplace" })}><Icon name="check" /> {reviewState === "saving" ? "Saving and recalculating…" : "Front refund from marketplace"}</button>
                {!(escalation?.kind === "evidence_request" && escalation.status === "open") && <>
                  <details className="decision-alternative"><summary>Cannot determine who should fund this</summary><div className="decision-alternative-body"><div className="field"><label htmlFor="liability-evidence-rationale">Why is more evidence required?</label><textarea id="liability-evidence-rationale" maxLength={500} value={evidenceRationale} onChange={(event) => setEvidenceRationale(event.target.value)} placeholder="For example: packaging photos do not distinguish courier damage from inadequate packing." /><p className="field-help">Required · 12–500 characters. No funding decision will be guessed.</p></div><button className="button secondary" disabled={evidenceRationale.trim().length < 12 || escalating} onClick={() => void openOperationsCase({ kind: "evidence_request", rationale: evidenceRationale })}><Icon name="clock" />{escalating ? "Opening request…" : "Request supporting evidence"}</button></div></details>
                </>}
                {reviewError && reviewState !== "error" && <div className="callout danger" role="alert"><Icon name="circle-alert" /><div><strong>Request not opened</strong><p>{reviewError}</p></div></div>}
                {reviewState === "saved" && <div className="callout" role="status"><Icon name="circle-check" /><div><strong>Review saved</strong><p>The claim was recalculated and the updated plan is loading.</p></div></div>}
                {reviewState === "error" && <div className="callout danger" role="alert"><Icon name="circle-alert" /><div><strong>Review not saved</strong><p>{reviewError}</p></div></div>}
              </div>
            )}
            {escalation?.kind === "recovery" && <div className="review-form"><RecoveryCase
              receipt={escalation}
              canUpdate={refundCompleted}
              responsibleParty={recoveryResponsibleParty}
              recoveredRupees={recoveredRupees}
              writtenOffRupees={writtenOffRupees}
              note={recoveryNote}
              closeCase={closeRecovery}
              state={recoveryState}
              error={recoveryError}
              errorTarget={recoveryErrorTarget}
              onResponsiblePartyChange={(value) => { setRecoveryResponsibleParty(value); clearRecoveryFeedback(); }}
              onRecoveredRupeesChange={(value) => { setRecoveredRupees(value); setCloseRecovery(false); clearRecoveryFeedback(); }}
              onWrittenOffRupeesChange={(value) => { setWrittenOffRupees(value); setCloseRecovery(false); clearRecoveryFeedback(); }}
              onNoteChange={(value) => { setRecoveryNote(value); clearRecoveryFeedback(); }}
              onCloseCaseChange={(value) => { setCloseRecovery(value); clearRecoveryFeedback(); }}
              onSave={() => void saveRecoveryUpdate()}
            /></div>}
            {visibleClosedEscalations.length > 0 && <details className="case-history"><summary>Prior operations cases ({visibleClosedEscalations.length})</summary><div className="case-history-list">{visibleClosedEscalations.map((entry) => <OperationsCase key={entry.caseId} receipt={entry} announce={false} />)}</div></details>}
            </section>
          </Card>

          <aside className="workbench-side" aria-label="Claim action">
            <section className="card action-card">
              <div className="action-summary">
                <p className="eyebrow">{refundCompletedWithOpenRecovery ? "Customer refund outcome" : isResolvedLocally || claim.status === "completed" ? "Final outcome" : claim.status === "processing" ? "Execution status" : "Approval summary"}</p>
                <h2 className="section-title">{plan ? <>Refund <Money paise={plan.customerRefundPaise} /></> : claim.review.headline}</h2>
                <p className="action-subtitle">{fundingSummary}</p>
                <div className="action-divider" />
                {localState === "executing" ? <div ref={executionStatusRef} tabIndex={-1}><div className="progress-step current" aria-live="polite"><span className="step-icon"><span className="spinner" style={{ width: 9, height: 9, borderColor: "#cad1cc", borderTopColor: "#176247" }} /></span><span>{requiresReconciliation ? "Checking provider result…" : "Executing approved plan…"}</span><span>Waiting for provider</span></div></div>
                  : isResolvedLocally || claim.status === "completed" ? <div ref={executionStatusRef} tabIndex={-1} className="callout"><Icon name="circle-check" /><div><strong>{refundCompletedWithOpenRecovery ? "Customer refund complete" : "Execution complete"}</strong><p>{refundCompletedWithOpenRecovery ? "The refund is confirmed. Recovery remains open in the claim assessment." : isResolvedLocally ? "The provider state and local ledger agree." : operation.detail}</p></div></div>
                    : requiresReconciliation ? <><div className="callout warning" role="status"><Icon name="circle-alert" /><div><strong>{operation.heading}</strong><p>{operation.detail}</p></div></div><button ref={approvalButtonRef} className="button action-primary action-followup" disabled={!planFingerprint} onClick={() => void executePlan()}><Icon name="refresh" />Check provider result</button></>
                      : claim.status === "ready_for_approval" && currentBalanceCheckState !== "verified" ? <button ref={approvalButtonRef} className="button action-primary" disabled={!planFingerprint || currentBalanceCheckState === "checking"} onClick={() => void refreshProviderBalances()}><Icon name="refresh" />{currentBalanceCheckState === "checking" ? "Checking balances…" : "Check current balances"}</button>
                      : isRetry || claim.status === "ready_for_approval" ? <button ref={approvalButtonRef} className="button action-primary" disabled={!planFingerprint} onClick={() => setLocalState("confirm")}><Icon name={isRetry ? "refresh" : "check"} />{approvalLabel}</button>
                      : executionInProgress ? <><div className="callout info" role="status"><Icon name="clock" /><div><strong>{operation.heading}</strong><p>{operation.detail}</p></div></div><button className="button secondary action-followup" type="button" disabled={isRefreshing} onClick={refreshStatus}><Icon name="refresh" />{isRefreshing ? "Refreshing…" : "Refresh status"}</button></>
                      : needsManualIntervention ? escalation
                        ? <div ref={escalationStatusRef} tabIndex={-1} className="callout warning" role="status"><Icon name="clock" /><div><strong>Payments case opened</strong><p>{escalation.caseId} · no further automatic movement will run.</p></div></div>
                        : <><div className="callout danger" role="status"><Icon name="circle-alert" /><div><strong>{operation.heading}</strong><p>{operation.detail}</p></div></div><button className="button action-primary action-followup" disabled={escalating} onClick={() => void openOperationsCase()}><Icon name="activity" />{escalating ? "Opening case…" : "Escalate to payments ops"}</button></>
                      : claim.status === "blocked" ? escalation
                        ? <div ref={escalationStatusRef} tabIndex={-1} className="callout warning" role="status"><Icon name="clock" /><div><strong>Reconciliation case opened</strong><p>{escalation.caseId} · approval remains blocked until provider balances are corrected.</p></div></div>
                        : <button className="button action-primary" disabled={escalating} onClick={() => void openOperationsCase()}><Icon name="activity" />{escalating ? "Opening case…" : "Escalate to payments ops"}</button>
                        : <p className="action-guidance">Complete the required review in the claim assessment. A fresh plan will be calculated before approval becomes available.</p>}
                {executionError && <div className="callout danger" style={{ marginTop: 12 }} role="alert"><Icon name="circle-alert" /><div><strong>Execution paused</strong><p>{executionError}</p></div></div>}
                {currentBalanceError && <div className="callout danger" style={{ marginTop: 12 }} role="alert"><Icon name="circle-alert" /><div><strong>Balance check failed</strong><p>{currentBalanceError}</p></div></div>}
                {(claim.status === "blocked" || needsManualIntervention) && reviewError && <div className="callout danger" style={{ marginTop: 12 }} role="alert"><Icon name="circle-alert" /><div><strong>Escalation not saved</strong><p>{reviewError}</p></div></div>}
                <div className="safety-note"><Icon name="lock" /><span>{safetyMessage}</span></div>
                <div className="preflight-list"><CheckRow text={paymentPreflight.text} status={paymentPreflight.status} /><CheckRow text={`Policy v${policy.version} locked to this order`} status="pass" /><CheckRow text={approvalRecorded ? "Human approval recorded before execution" : "Human approval required before execution"} status={approvalRecorded ? "pass" : "pending"} /></div>
              </div>
            </section>
          </aside>

          <Card className="calculation-card" title="Money movement" description="Amounts preserve the original discount allocation and reconcile exactly.">
            {plan ? <>
              <div className="table-card money-table-card" role="region" aria-label="Refund calculation"><table className="data-table money-table"><caption className="sr-only">Exact refund calculation in Indian rupees</caption><thead><tr><th scope="col">Component</th><th scope="col">Gross</th><th scope="col">Adjustment</th><th scope="col">Customer refund</th></tr></thead><tbody>
                {plan.lineAllocations.map((line) => <tr key={line.orderLineId}><th scope="row"><span className="table-primary">{line.title}</span><span className="table-secondary">Quantity {line.quantity}</span></th><td data-label="Gross"><Money paise={line.grossPaise} /></td><td data-label="Discount">−<Money paise={line.discountAllocationPaise} /></td><td data-label="Refund"><Money paise={line.customerRefundPaise} /></td></tr>)}
                <tr><th scope="row"><span className="table-primary">Outbound shipping</span><span className="table-secondary">{isFullReturn ? "Full return" : "Partial return"} · {plan.shippingRefundPaise > 0 ? "refunded by policy" : order.shippingPaise > 0 ? "not refundable by policy" : "no shipping charged"}</span></th><td data-label="Gross"><Money paise={order.shippingPaise} /></td><td data-label="Adjustment">{order.shippingPaise === plan.shippingRefundPaise ? "None" : <>−<Money paise={order.shippingPaise - plan.shippingRefundPaise} /></>}</td><td data-label="Refund"><Money paise={plan.shippingRefundPaise} /></td></tr>
              </tbody></table></div>
              <div className="reconcile-row"><span>Customer refund</span><strong><Money paise={plan.customerRefundPaise} /></strong></div>
            </> : <div className="empty-state">Money movement is withheld until the item and immediate funding source are unambiguous.</div>}
          </Card>

          <Card className="audit-card" title="Audit trail" description="Inputs, decisions, approvals, and provider results remain linked to this claim." action={<a className="button secondary" href={`/api/claims/${encodeURIComponent(claim.id)}/audit`} download><Icon name="file-text" />Download audit</a>}>
            <div className="timeline">
              {(isResolvedLocally || claim.status === "completed") && <TimelineEvent icon="circle-check" title="Customer refund confirmed" detail={`${receipt?.refundId ?? "Refund record"} · request ${receipt?.requestId ?? claim.execution?.requestId ?? "recorded"}`} time={timeOnly(receipt?.completedAt ?? claim.completedAt ?? claim.submittedAt)} />}
              {receipt?.reversals.map((reversal) => <TimelineEvent key={reversal.providerId} icon="check" title="Seller reversal confirmed" detail={`${reversal.providerId} · ${formatMoney(reversal.amountPaise)}`} time={timeOnly(receipt.completedAt)} />)}
              {claim.approvedAt && <TimelineEvent icon="check" title="Plan approved" detail={`${claim.execution?.approvedBy ?? "Khushi Diwan"} · approval bound to plan hash`} time={timeOnly(claim.approvedAt)} />}
              {[...reviewEvents]
                .filter((event) => event.type !== "refund_created" || !(isResolvedLocally || claim.status === "completed"))
                .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
                .map((event) => <TimelineEvent key={event.id} icon={activityTimelinePresentation(event.type).icon} title={activityTimelinePresentation(event.type).title} detail={`${event.actor} · ${event.summary} · request ${event.requestId ?? "recorded"}`} time={timeOnly(event.occurredAt)} />)}
              <TimelineEvent icon="shield" title={claim.review.headline} detail={`${policy.citation} · ${claim.decision?.calculationVersion ?? "awaiting calculation"}`} time={timeOnly(claim.submittedAt)} />
              <TimelineEvent icon="inbox" title="Return claim received" detail={`Order ${order.reference} · evidence locked`} time={timeOnly(claim.submittedAt)} />
            </div>
            {plan && <details className="technical-details"><summary>Technical references</summary><div className="reference-list"><div><span>Payment</span><code>{order.paymentReference}</code></div>{plan.sellerReversals.map((reversal) => <div key={reversal.transferId}><span>Transfer</span><code>{reversal.providerReference}</code></div>)}<div><span>Approved plan</span><code>{receipt?.planFingerprint ?? planFingerprint ?? "Not calculated"}</code></div>{receipt?.refundId && <div><span>Refund</span><code>{receipt.refundId}</code></div>}</div></details>}
          </Card>

      </div>

      {localState === "confirm" && plan && <dialog ref={dialogRef} className="modal-dialog" aria-labelledby="confirm-title" onCancel={(event) => { event.preventDefault(); setLocalState("initial"); }} onMouseDown={(event) => { if (event.target === event.currentTarget) setLocalState("initial"); }}>
        <section className="modal">
          <header className="modal-header"><div><h2 id="confirm-title">{retryingRefund ? `Retry the ${formatMoney(plan.customerRefundPaise)} customer refund?` : isRetry || plan.sellerFundedPaise ? `Reverse ${formatMoney(isRetry ? pendingSellerPaise : plan.sellerFundedPaise)} and refund ${formatMoney(plan.customerRefundPaise)}?` : `Refund ${formatMoney(plan.customerRefundPaise)} from Creo Market?`}</h2><p>{retryingRefund ? "Every seller reversal is already confirmed and will be skipped." : isRetry ? "Confirmed reversals will not run again." : plan.sellerReversals.length ? "Seller funds are reversed first; only then is the customer refunded." : "No seller transfer will be reversed for this marketplace-funded decision."}</p></div><button ref={closeRef} className="icon-button" aria-label="Close confirmation" onClick={() => setLocalState("initial")}><Icon name="x" /></button></header>
          <div className="modal-body">
            <div className="confirmation-ledger">
              {plan.sellerReversals.map((reversal) => {
                const confirmed = completedReversalIds.has(reversal.transferId);
                return <div className="confirmation-row" key={reversal.transferId}><span>{reversal.sellerName} · {confirmed ? "already confirmed" : isRetry ? "will reverse now" : "seller reversal"}</span><strong>{formatMoney(reversal.amountPaise)}</strong></div>;
              })}
              <div className="confirmation-row"><span>Marketplace contribution</span><strong>{formatMoney(plan.marketplaceFundedPaise)}</strong></div>
              <div className="confirmation-row"><span>Customer refund</span><strong>{formatMoney(plan.customerRefundPaise)}</strong></div>
              <div className="confirmation-row"><span>Approved plan</span><strong><code title={planFingerprint}>{shortHash(planFingerprint)}</code></strong></div>
              <div className="confirmation-row"><span>Environment</span><strong>{providerMode === "demo" ? "Simulation · No live money" : `${providerLabel} · No live money`}</strong></div>
            </div>
            <div className="callout info" style={{ marginTop: 13 }}><Icon name="shield" /><div><strong>Safe execution order</strong><p>Balances are checked again immediately before execution. Each operation is recorded, reconciled, and never blindly retried after an unknown response.</p></div></div>
          </div>
          <footer className="modal-footer"><button className="button secondary" onClick={() => setLocalState("initial")}>Cancel</button><button className="button" onClick={executePlan}>{confirmLabel}</button></footer>
        </section>
      </dialog>}
    </div>
  );
}

function CheckRow({ text, status }: { text: string; status: "pass" | "pending" | "fail" }) {
  return <div className={`check-row ${status}`}><span className="check-mark"><Icon name={status === "pass" ? "check" : status === "pending" ? "clock" : "x"} /></span><span>{text}</span></div>;
}

function OperationsCase({ receipt, announce = true }: { receipt: EscalationReceipt; announce?: boolean }) {
  const latestNote = receipt.notes.at(-1);
  return <div className="case-summary" {...(announce ? { role: "status" } : {})}><div className="case-summary-heading"><div><span className="eyebrow">{receipt.kind === "recovery" ? "Recovery case" : receipt.kind === "evidence_request" ? "Evidence request" : "Operations case"}</span><strong>{receipt.caseId}</strong></div><StatusPill tone={receipt.status === "open" ? "review" : "completed"} icon={receipt.status === "open" ? "clock" : undefined}>{receipt.status === "open" ? "Open" : "Closed"}</StatusPill></div><dl><div><dt>Owner</dt><dd>{receipt.owner}</dd></div><div><dt>Due</dt><dd>{dateTime(receipt.dueAt)}{receipt.overdue ? " · overdue" : ""}</dd></div><div><dt>Age</dt><dd>{formatCaseAge(receipt.ageHours)}</dd></div><div><dt>Next action</dt><dd>{receipt.nextAction}</dd></div>{latestNote && <div><dt>Latest note</dt><dd>{latestNote.redactedText}</dd></div>}</dl></div>;
}

function RecoveryCase({
  receipt,
  canUpdate,
  responsibleParty,
  recoveredRupees,
  writtenOffRupees,
  note,
  closeCase,
  state,
  error,
  errorTarget,
  onResponsiblePartyChange,
  onRecoveredRupeesChange,
  onWrittenOffRupeesChange,
  onNoteChange,
  onCloseCaseChange,
  onSave,
}: {
  receipt: RecoveryReceipt;
  canUpdate: boolean;
  responsibleParty: "" | "seller" | "courier" | "marketplace";
  recoveredRupees: string;
  writtenOffRupees: string;
  note: string;
  closeCase: boolean;
  state: RecoveryState;
  error: string;
  errorTarget?: RecoveryErrorTarget;
  onResponsiblePartyChange: (value: "seller" | "courier" | "marketplace") => void;
  onRecoveredRupeesChange: (value: string) => void;
  onWrittenOffRupeesChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onCloseCaseChange: (value: boolean) => void;
  onSave: () => void;
}) {
  const recoveredAmountPaise = parseRupeesToPaise(recoveredRupees);
  const writtenOffAmountPaise = parseRupeesToPaise(writtenOffRupees);
  const fullTargetAccounted = recoveredAmountPaise !== undefined
    && writtenOffAmountPaise !== undefined
    && recoveredAmountPaise + writtenOffAmountPaise === receipt.targetAmountPaise;
  const isSaving = state === "saving";
  const errorId = state === "error" && error ? "recovery-form-error" : undefined;
  const describedBy = (helpId: string, target: RecoveryErrorTarget) => errorId && errorTarget === target ? `${helpId} ${errorId}` : helpId;

  return <div className="recovery-case">
    <OperationsCase receipt={receipt} />
    <div className="recovery-ledger" aria-label="Recovery accounting">
      <div><span>Recovery target</span><strong><Money paise={receipt.targetAmountPaise} /></strong></div>
      <div><span>Recovered</span><strong><Money paise={receipt.recoveredAmountPaise} /></strong></div>
      <div><span>Written off</span><strong><Money paise={receipt.writtenOffAmountPaise} /></strong></div>
      <div className="recovery-outstanding"><span>Outstanding</span><strong><Money paise={receipt.outstandingAmountPaise} /></strong></div>
    </div>
    <div className="recovery-responsibility"><span>Recovery responsibility</span><strong>{recoveryPartyLabel(receipt.responsibleParty)}</strong><span>Outcome</span><strong>{recoveryOutcomeLabel(receipt.recoveryOutcome)}</strong></div>
    {receipt.notes.length > 0 && <details className="case-notes"><summary>View redacted note history ({receipt.notes.length})</summary><ol>{receipt.notes.map((entry, index) => <li key={`${entry.recordedAt}-${entry.sha256}-${index}`}><p>{entry.redactedText}</p><span>{entry.actor} · {dateTime(entry.recordedAt)} · integrity {shortHash(entry.sha256)}</span></li>)}</ol></details>}
    {receipt.status === "open" && !canUpdate && <div className="callout info" role="status"><Icon name="clock" /><div><strong>Recovery ledger is waiting for the refund</strong><p>The case is tracked now, but recovered and written-off totals can be posted only after the customer refund is confirmed.</p></div></div>}
    {receipt.status === "open" && canUpdate ? <form className="recovery-update-form" noValidate aria-busy={isSaving} aria-describedby={errorTarget === "form" ? errorId : undefined} onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <div className="section-heading"><h4>Record recovery outcome</h4><p>Enter cumulative totals. Values cannot decrease, and the full target must be recovered or written off before closure.</p></div>
      <fieldset className="liability-options" disabled={isSaving} aria-invalid={errorTarget === "responsible_party"} aria-describedby={errorTarget === "responsible_party" ? errorId : undefined}><legend>Responsible party (required)</legend>{(["seller", "courier", "marketplace"] as const).map((party) => <label key={party}><input type="radio" name="recovery-responsible-party" value={party} required checked={responsibleParty === party} onChange={() => onResponsiblePartyChange(party)} /><span>{recoveryPartyLabel(party)}</span></label>)}</fieldset>
      <div className="recovery-form-grid">
        <div className="field"><label htmlFor="recovered-total">Cumulative recovered (₹)</label><input id="recovered-total" name="recovered-total" inputMode="decimal" required disabled={isSaving} value={recoveredRupees} onChange={(event) => onRecoveredRupeesChange(event.target.value)} aria-invalid={errorTarget === "amounts"} aria-describedby={describedBy("recovery-amount-help", "amounts")} /></div>
        <div className="field"><label htmlFor="written-off-total">Cumulative written off (₹)</label><input id="written-off-total" name="written-off-total" inputMode="decimal" required disabled={isSaving} value={writtenOffRupees} onChange={(event) => onWrittenOffRupeesChange(event.target.value)} aria-invalid={errorTarget === "amounts"} aria-describedby={describedBy("recovery-amount-help", "amounts")} /></div>
      </div>
      <p id="recovery-amount-help" className="field-help">Target {formatMoney(receipt.targetAmountPaise)} · currently {formatMoney(receipt.outstandingAmountPaise)} outstanding.</p>
      <div className="field"><label htmlFor="recovery-note">Operator note</label><textarea id="recovery-note" name="recovery-note" required minLength={12} maxLength={500} disabled={isSaving} value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="Record the evidence, settlement reference, or approved write-off reason." aria-invalid={errorTarget === "note"} aria-describedby={describedBy("recovery-note-help", "note")} /><p id="recovery-note-help" className="field-help">Required · 12–500 characters. Email addresses, Indian phone numbers, IP addresses, and long numeric identifiers are deterministically redacted before storage.</p></div>
      <label className={`checkbox-field ${!fullTargetAccounted ? "is-disabled" : ""}`}><input type="checkbox" name="close-recovery" required={fullTargetAccounted} disabled={isSaving || !fullTargetAccounted} checked={closeCase} onChange={(event) => onCloseCaseChange(event.target.checked)} aria-invalid={errorTarget === "closure"} aria-describedby={describedBy("recovery-close-help", "closure")} /><span><strong>Close this recovery case</strong><small id="recovery-close-help">Required when the full target is accounted for.</small></span></label>
      <button className="button secondary" type="submit" disabled={isSaving}><Icon name="check" />{isSaving ? "Saving recovery…" : "Save recovery update"}</button>
      {state === "saved" && <div className="callout" role="status"><Icon name="circle-check" /><div><strong>Recovery updated</strong><p>The totals, responsibility, and redacted note were added to the audit trail.</p></div></div>}
      {state === "error" && error && <div id="recovery-form-error" className="callout danger" role="alert"><Icon name="circle-alert" /><div><strong>Recovery not updated</strong><p>{error}</p></div></div>}
    </form> : receipt.status === "closed" ? <div className="callout" role="status"><Icon name="circle-check" /><div><strong>Recovery closed</strong><p>The full {formatMoney(receipt.targetAmountPaise)} target is accounted for as recovered or written off.</p></div></div> : null}
  </div>;
}

function TimelineEvent({ icon, title, detail, time }: { icon: "circle-check" | "check" | "shield" | "inbox"; title: string; detail: string; time: string }) {
  return <div className="timeline-event"><span className="timeline-dot"><Icon name={icon} /></span><div className="timeline-copy"><strong>{title}</strong><span>{detail}</span></div><span className="timeline-time">{time}</span></div>;
}

function activityTimelinePresentation(type: ClaimWorkbenchActivity["type"]): { icon: "circle-check" | "check" | "shield" | "inbox"; title: string } {
  if (type === "transfer_reversed") return { icon: "check", title: "Seller reversal confirmed" };
  if (type === "provider_failure") return { icon: "shield", title: "Execution paused safely" };
  if (type === "provider_snapshot_checked") return { icon: "shield", title: "Provider balances checked" };
  if (type === "refund_created") return { icon: "circle-check", title: "Customer refund confirmed" };
  if (type === "calculation_created") return { icon: "shield", title: "Review resolved and plan recalculated" };
  if (type === "item_extracted") return { icon: "shield", title: "Evidence match abstained" };
  if (type === "manual_review_requested") return { icon: "shield", title: "Manual review requested" };
  if (type === "approval_recorded") return { icon: "check", title: "Plan approved" };
  if (type === "duplicate_event_ignored") return { icon: "shield", title: "Duplicate event ignored" };
  if (type === "recovery_updated") return { icon: "shield", title: "Recovery case updated" };
  if (type === "claim_received") return { icon: "inbox", title: "Return claim received" };
  return { icon: "shield", title: type === "reconciliation_pending" ? "Provider reconciliation pending" : "Execution update" };
}

function formatMoney(paise: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(paise / 100); }
function paiseInput(paise: number) { return (paise / 100).toFixed(2); }
function parseRupeesToPaise(value: string): number | undefined {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const [rupees, fraction = ""] = normalized.split(".");
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? paise : undefined;
}
function dateTime(value: string) { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(value)); }
function dateOnly(value: string) { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00+05:30`)); }
function timeOnly(value: string) { return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(value)); }
function fundingSourceText(value: LiabilityParty) { return ({ seller: "Seller net settlement + marketplace commission", marketplace: "Creo Market", courier: "Creo Market advance; courier recovery pending", customer: "Customer", unresolved: "Not determined" } as const)[value]; }
function recoveryPartyLabel(value: RecoveryReceipt["responsibleParty"]) { return ({ seller: "Seller", courier: "Courier", marketplace: "Marketplace / internal", unresolved: "Unresolved" } as const)[value]; }
function recoveryOutcomeLabel(value: RecoveryReceipt["recoveryOutcome"]) { return ({ pending: "Pending", partial: "Partially accounted", recovered: "Fully recovered", written_off: "Written off", mixed: "Recovered + written off" } as const)[value]; }
function formatCaseAge(hours: number) { return hours < 1 ? "Less than 1 hour" : hours < 24 ? `${hours} hour${hours === 1 ? "" : "s"}` : `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? "" : "s"}`; }
function shortHash(value?: string) { return value ? `${value.slice(0, 12)}…${value.slice(-8)}` : "Not calculated"; }
