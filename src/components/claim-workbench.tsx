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
import { Icon } from "./icons";
import { Card, Money, StatusPill } from "./ui";

type LocalState = "initial" | "confirm" | "executing" | "completed";
type EscalationReceipt = {
  caseId: string;
  kind: "reconciliation" | "evidence_request" | "recovery";
  createdAt: string;
  requestId: string;
  actor: string;
  queue: "payments_reconciliation" | "claims_review" | "recovery_operations";
  owner: string;
  dueAt: string;
  status: "open" | "closed";
  nextAction: string;
  noteRecorded: boolean;
};
type ReviewState = "idle" | "saving" | "saved" | "error";
type BalanceCheckState = "not_required" | "required" | "checking" | "verified" | "error";

export function ClaimWorkbench({
  claim,
  order,
  policy,
  planFingerprint,
  initialReceipt,
  initialEscalation,
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
  reviewEvents?: readonly ClaimWorkbenchActivity[];
  providerMode: "demo" | "razorpay_test";
  providerLabel: string;
}) {
  const router = useRouter();
  const [localState, setLocalState] = useState<LocalState>("initial");
  const [executionStep, setExecutionStep] = useState(0);
  const [selectedLine, setSelectedLine] = useState("");
  const [evidenceRationale, setEvidenceRationale] = useState("");
  const [executionError, setExecutionError] = useState("");
  const [reviewState, setReviewState] = useState<ReviewState>("idle");
  const [reviewError, setReviewError] = useState("");
  const [balanceCheckState, setBalanceCheckState] = useState<BalanceCheckState>(claim.status === "ready_for_approval" && !claim.approvedAt ? "required" : "not_required");
  const [balanceCheckFingerprint, setBalanceCheckFingerprint] = useState(planFingerprint ?? "");
  const [balanceCheckedAt, setBalanceCheckedAt] = useState("");
  const [balanceError, setBalanceError] = useState("");
  const [escalation, setEscalation] = useState<EscalationReceipt | undefined>(initialEscalation);
  const [escalating, setEscalating] = useState(false);
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

  async function refreshProviderBalances() {
    if (!planFingerprint) return;
    setBalanceCheckFingerprint(planFingerprint);
    setBalanceCheckState("checking");
    setBalanceError("");
    try {
      const response = await fetch(`/api/claims/${encodeURIComponent(claim.id)}/preflight`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedPlanFingerprint: planFingerprint }),
      });
      const body = await response.json() as { status?: string; checkedAt?: string; error?: string };
      if (!response.ok || body.status !== "verified" || !body.checkedAt) {
        throw new Error(body.error ?? "Provider balances could not be verified.");
      }
      setBalanceCheckedAt(body.checkedAt);
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
    setLocalState("executing");
    setExecutionError("");
    setExecutionStep(isRetry ? 1 : 0);
    try {
      setExecutionStep(1);
      const response = await fetch(`/api/claims/${encodeURIComponent(claim.id)}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-returnsplit-request-id": `ui_${claim.id}` },
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
      setExecutionStep(2);
      setExecutionStep(3);
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
      const response = await fetch(`/api/claims/${encodeURIComponent(claim.id)}/escalate`, {
        method: "POST",
        headers: { "x-returnsplit-request-id": `escalate_${claim.id}` },
        ...(input ? { headers: { "content-type": "application/json", "x-returnsplit-request-id": `escalate_${claim.id}` }, body: JSON.stringify(input) } : {}),
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

  function refreshStatus() {
    startStatusRefresh(() => router.refresh());
  }

  const currentStatus = isResolvedLocally ? "Completed" : operation.label;
  const currentTone = isResolvedLocally ? "completed" : operation.tone;
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
  const visibleReviewFlags = claim.review.flags.filter((flag) => flag.code !== "provider_failure" && flag.code !== "provider_result_unknown");
  const fundingSummary = !plan
    ? "Complete the highlighted review to calculate who funds the refund."
    : retryingRefund
      ? `All seller reversals are confirmed. Retry the ${formatMoney(plan.customerRefundPaise)} customer refund.`
      : isRetry
      ? `Retry ${formatMoney(pendingSellerPaise)} from ${pendingReversals.map((entry) => entry.sellerName).join(" + ")}, then refund ${formatMoney(plan.customerRefundPaise)}.`
      : plan.sellerFundedPaise
        ? `Reverse ${formatMoney(plan.sellerFundedPaise)} from ${plan.sellerReversals.map((entry) => entry.sellerName).join(" + ")}. Mora Market contributes ${formatMoney(plan.marketplaceFundedPaise)}.`
        : `Mora Market funds the full ${formatMoney(plan.customerRefundPaise)} refund.`;
  const safetyMessage = requiresReconciliation
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
          <div className="meta-line"><span>Order {order.reference}</span><span>{claim.customer.name}</span><span>Received {dateTime(claim.submittedAt)}</span></div>
        </div>
      </header>

      {isResolvedLocally && <div className="callout" style={{ marginBottom: 16 }} role="status"><Icon name="circle-check" /><div><strong>Execution completed</strong><p>The required reversal was confirmed before the customer refund. Every step was added to the audit trail.</p></div></div>}
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
                {escalation?.kind === "evidence_request" && escalation.status === "open" ? <OperationsCase receipt={escalation} /> : <>
                  <div className="field"><label htmlFor="order-line">Which item did the customer return?</label><select id="order-line" value={selectedLine} onChange={(event) => setSelectedLine(event.target.value)}><option value="">Choose an order line</option>{order.lines.map((line) => <option key={line.id} value={line.id}>{line.title} · {line.variant ?? "No variant"}</option>)}</select></div>
                  <button className="button secondary" disabled={!selectedLine || reviewState === "saving"} onClick={() => {
                    const returnedItem = claim.returnedItems.find((item) => !item.orderLineId);
                    if (returnedItem) void saveReviewDecision({ kind: "item_match", returnedItemId: returnedItem.id, orderLineId: selectedLine });
                  }}><Icon name="check" /> {reviewState === "saving" ? "Saving and recalculating…" : "Confirm item and recalculate"}</button>
                  <details className="decision-alternative"><summary>Cannot determine from this evidence</summary><div className="decision-alternative-body"><div className="field"><label htmlFor="evidence-rationale">Why is more evidence required?</label><textarea id="evidence-rationale" maxLength={500} value={evidenceRationale} onChange={(event) => setEvidenceRationale(event.target.value)} placeholder="For example: both colour variants are identical in the current photo." /><p className="field-help">Required · 12–500 characters. The demo records a hash of this note, not its raw text.</p></div><button className="button secondary" disabled={evidenceRationale.trim().length < 12 || escalating} onClick={() => void openOperationsCase({ kind: "evidence_request", rationale: evidenceRationale })}><Icon name="clock" />{escalating ? "Opening request…" : "Request customer evidence"}</button></div></details>
                </>}
                {reviewState === "saved" && <div className="callout" role="status"><Icon name="circle-check" /><div><strong>Review saved</strong><p>The claim was recalculated and the updated plan is loading.</p></div></div>}
                {reviewState === "error" && <div className="callout danger" role="alert"><Icon name="circle-alert" /><div><strong>Review not saved</strong><p>{reviewError}</p></div></div>}
              </div>
            )}
            <section className="assessment-section" aria-labelledby="funding-decision-heading">
              <div className="section-heading"><h3 id="funding-decision-heading">Funding decision</h3><p>Liability follows the policy active when this order was placed.</p></div>
            <div className="decision-list">
              <div className="decision-row"><div className="decision-key">Return reason</div><div className="decision-value">{claim.reasonLabel}</div></div>
              <div className="decision-row"><div className="decision-key">Liable party</div><div className="decision-value">{liabilityText(claim.review.liability)}</div></div>
              <div className="decision-row"><div className="decision-key">Why</div><div className="decision-value">{claim.review.explanation}</div></div>
              <div className="decision-row"><div className="decision-key">Policy applied</div><div className="decision-value">{policy.name} v{policy.version} · effective {dateOnly(policy.effectiveFrom)}<div className="policy-citation"><strong>{policy.citation}</strong><br />{policy.summary}</div></div></div>
            </div>
            {claim.status === "needs_review" && claim.review.flags.some((flag) => flag.code === "liability_unclear") && (
              <div className="review-form">
                <p className="field-help">Mora Market can front the customer refund now. Recovery from the courier or seller remains a separate reconciliation decision.</p>
                <button className="button secondary" disabled={reviewState === "saving"} onClick={() => void saveReviewDecision({ kind: "liability", liability: "marketplace" })}><Icon name="check" /> {reviewState === "saving" ? "Saving and recalculating…" : "Use marketplace funds"}</button>
                <details className="decision-alternative"><summary>Cannot determine who should fund this</summary><div className="decision-alternative-body"><div className="field"><label htmlFor="liability-evidence-rationale">Why is more evidence required?</label><textarea id="liability-evidence-rationale" maxLength={500} value={evidenceRationale} onChange={(event) => setEvidenceRationale(event.target.value)} placeholder="For example: packaging photos do not distinguish courier damage from inadequate packing." /><p className="field-help">Required · 12–500 characters. No funding decision will be guessed.</p></div><button className="button secondary" disabled={evidenceRationale.trim().length < 12 || escalating} onClick={() => void openOperationsCase({ kind: "evidence_request", rationale: evidenceRationale })}><Icon name="clock" />{escalating ? "Opening request…" : "Request supporting evidence"}</button></div></details>
                {reviewState === "saved" && <div className="callout" role="status"><Icon name="circle-check" /><div><strong>Review saved</strong><p>The claim was recalculated and the updated plan is loading.</p></div></div>}
                {reviewState === "error" && <div className="callout danger" role="alert"><Icon name="circle-alert" /><div><strong>Review not saved</strong><p>{reviewError}</p></div></div>}
              </div>
            )}
            {escalation?.kind === "recovery" && <div className="review-form"><OperationsCase receipt={escalation} /></div>}
            </section>
          </Card>

          <aside className="workbench-side" aria-label="Claim action">
            <section className="card action-card">
              <div className="action-summary">
                <p className="eyebrow">{isResolvedLocally || claim.status === "completed" ? "Final outcome" : claim.status === "processing" ? "Execution status" : "Approval summary"}</p>
                <h2 className="section-title">{plan ? <>Refund <Money paise={plan.customerRefundPaise} /></> : claim.review.headline}</h2>
                <p className="action-subtitle">{fundingSummary}</p>
                <div className="action-divider" />
                {localState === "executing" ? <div ref={executionStatusRef} tabIndex={-1}>{requiresReconciliation ? <div className="progress-step current" aria-live="polite"><span className="step-icon"><span className="spinner" style={{ width: 9, height: 9, borderColor: "#cad1cc", borderTopColor: "#176247" }} /></span><span>Checking provider result</span><span>Working…</span></div> : <ExecutionProgress step={executionStep} isRetry={isRetry} isRefundRetry={retryingRefund} sellerReversalCount={plan?.sellerReversals.length ?? 0} />}</div>
                  : isResolvedLocally || claim.status === "completed" ? <div ref={executionStatusRef} tabIndex={-1} className="callout"><Icon name="circle-check" /><div><strong>Execution complete</strong><p>{isResolvedLocally ? "The provider state and local ledger agree." : operation.detail}</p></div></div>
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
                <tr><th scope="row"><span className="table-primary">Outbound shipping</span><span className="table-secondary">Partial return policy</span></th><td data-label="Gross"><Money paise={order.shippingPaise} /></td><td data-label="Adjustment">Not refunded</td><td data-label="Refund"><Money paise={plan.shippingRefundPaise} /></td></tr>
              </tbody></table></div>
              <div className="reconcile-row"><span>Customer refund</span><strong><Money paise={plan.customerRefundPaise} /></strong></div>
            </> : <div className="empty-state">Money movement is withheld until the item and liable party are unambiguous.</div>}
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
          <header className="modal-header"><div><h2 id="confirm-title">{retryingRefund ? `Retry the ${formatMoney(plan.customerRefundPaise)} customer refund?` : isRetry || plan.sellerFundedPaise ? `Reverse ${formatMoney(isRetry ? pendingSellerPaise : plan.sellerFundedPaise)} and refund ${formatMoney(plan.customerRefundPaise)}?` : `Refund ${formatMoney(plan.customerRefundPaise)} from Mora Market?`}</h2><p>{retryingRefund ? "Every seller reversal is already confirmed and will be skipped." : isRetry ? "Confirmed reversals will not run again." : plan.sellerReversals.length ? "Seller funds are reversed first; only then is the customer refunded." : "No seller transfer will be reversed for this marketplace-funded decision."}</p></div><button ref={closeRef} className="icon-button" aria-label="Close confirmation" onClick={() => setLocalState("initial")}><Icon name="x" /></button></header>
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

function OperationsCase({ receipt }: { receipt: EscalationReceipt }) {
  return <div className="case-summary" role="status"><div className="case-summary-heading"><div><span className="eyebrow">{receipt.kind === "recovery" ? "Recovery case" : receipt.kind === "evidence_request" ? "Evidence request" : "Operations case"}</span><strong>{receipt.caseId}</strong></div><StatusPill tone={receipt.status === "open" ? "review" : "completed"}>{receipt.status === "open" ? "Open" : "Closed"}</StatusPill></div><dl><div><dt>Owner</dt><dd>{receipt.owner}</dd></div><div><dt>Due</dt><dd>{dateTime(receipt.dueAt)}</dd></div><div><dt>Next action</dt><dd>{receipt.nextAction}</dd></div>{receipt.noteRecorded && <div><dt>Operator note</dt><dd>Rationale recorded securely</dd></div>}</dl></div>;
}

function TimelineEvent({ icon, title, detail, time }: { icon: "circle-check" | "check" | "shield" | "inbox"; title: string; detail: string; time: string }) {
  return <div className="timeline-event"><span className="timeline-dot"><Icon name={icon} /></span><div className="timeline-copy"><strong>{title}</strong><span>{detail}</span></div><span className="timeline-time">{time}</span></div>;
}

function activityTimelinePresentation(type: ClaimWorkbenchActivity["type"]): { icon: "circle-check" | "check" | "shield" | "inbox"; title: string } {
  if (type === "transfer_reversed") return { icon: "check", title: "Seller reversal confirmed" };
  if (type === "provider_failure") return { icon: "shield", title: "Execution paused safely" };
  if (type === "refund_created") return { icon: "circle-check", title: "Customer refund confirmed" };
  if (type === "calculation_created") return { icon: "shield", title: "Review resolved and plan recalculated" };
  if (type === "item_extracted") return { icon: "shield", title: "Evidence match abstained" };
  if (type === "manual_review_requested") return { icon: "shield", title: "Manual review requested" };
  if (type === "approval_recorded") return { icon: "check", title: "Plan approved" };
  if (type === "duplicate_event_ignored") return { icon: "shield", title: "Duplicate event ignored" };
  if (type === "claim_received") return { icon: "inbox", title: "Return claim received" };
  return { icon: "shield", title: type === "reconciliation_pending" ? "Provider reconciliation pending" : "Execution update" };
}

function ExecutionProgress({ step, isRetry, isRefundRetry, sellerReversalCount = 1 }: { step: number; isRetry: boolean; isRefundRetry: boolean; sellerReversalCount?: number }) {
  const steps = isRefundRetry ? ["Seller reversals confirmed", "Retry customer refund", "Confirm provider result"] : isRetry ? ["Confirmed prior reversal", "Retry remaining reversal", "Create customer refund"] : sellerReversalCount > 0 ? ["Reserve approved amounts", "Reverse seller transfer", "Create customer refund"] : ["Reserve approved amount", "Create customer refund", "Confirm provider result"];
  return <div className="progress-steps" aria-live="polite">{steps.map((label, index) => <div className={`progress-step ${index < step ? "done" : index === step ? "current" : ""}`} key={label}><span className="step-icon">{index < step ? <Icon name="check" /> : index === step ? <span className="spinner" style={{ width: 9, height: 9, borderColor: "#cad1cc", borderTopColor: "#176247" }} /> : null}</span><span>{label}</span><span>{index < step ? "Done" : index === step ? "Working…" : "Waiting"}</span></div>)}</div>;
}

function formatMoney(paise: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(paise / 100); }
function dateTime(value: string) { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(value)); }
function dateOnly(value: string) { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00+05:30`)); }
function timeOnly(value: string) { return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(value)); }
function liabilityText(value: LiabilityParty) { return ({ seller: "Seller funds net settled item value; marketplace returns commission", marketplace: "Marketplace", courier: "Courier", customer: "Customer", unresolved: "Needs a funding decision" } as const)[value]; }
function shortHash(value?: string) { return value ? `${value.slice(0, 12)}…${value.slice(-8)}` : "Not calculated"; }
