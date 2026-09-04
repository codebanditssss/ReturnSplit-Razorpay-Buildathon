import type { Claim, ClaimExecutionSummary, ClaimStatus } from "./types";

export type ClaimOperationKind =
  | "ready"
  | "review"
  | "blocked"
  | "executing"
  | "executing_reversal"
  | "executing_refund"
  | "retry_reversal"
  | "retry_refund"
  | "reconcile_reversal"
  | "reconcile_refund"
  | "manual_intervention"
  | "completed";

export interface ClaimOperationPresentation {
  kind: ClaimOperationKind;
  label: string;
  heading: string;
  detail?: string;
  tone: "ready" | "review" | "blocked" | "info" | "completed";
  queueStatus: ClaimStatus;
}

type PresentableClaim = Pick<Claim, "status" | "statusLabel"> & {
  execution?: Pick<ClaimExecutionSummary,
    "state" | "canResume" | "requiresReconciliation" | "lastError" | "pendingOperation"
  >;
};

/**
 * One operator-facing vocabulary for the queue, order list, and claim detail.
 * Provider uncertainty is intentionally distinct from a safe retry: an unknown
 * result must be reconciled before ReturnSplit can submit another request.
 */
export function claimOperationPresentation(claim: PresentableClaim): ClaimOperationPresentation {
  const execution = claim.execution;

  if (claim.status === "completed" || execution?.state === "completed") {
    return {
      kind: "completed",
      label: "Completed",
      heading: "Execution complete",
      detail: "The customer refund is confirmed.",
      tone: "completed",
      queueStatus: "completed",
    };
  }

  const needsReconciliation = execution?.requiresReconciliation === true
    || execution?.state === "reversal_result_unknown"
    || execution?.state === "refund_result_unknown";
  if (needsReconciliation) {
    const isRefund = execution?.pendingOperation === "payment_refund"
      || execution?.state === "refund_result_unknown";
    return {
      kind: isRefund ? "reconcile_refund" : "reconcile_reversal",
      label: "Provider check required",
      heading: "Provider result needs a check",
      detail: isRefund
        ? "The refund response is not final. Check the provider before retrying."
        : "The reversal response is not final. Check the provider before retrying.",
      tone: "review",
      queueStatus: "processing",
    };
  }

  if (execution?.state === "failed" && execution.canResume === true) {
    const isRefund = execution.pendingOperation === "payment_refund";
    return {
      kind: isRefund ? "retry_refund" : "retry_reversal",
      label: isRefund ? "Retry refund" : "Retry reversal",
      heading: isRefund ? "Customer refund ready to retry" : "Seller reversal ready to retry",
      detail: isRefund
        ? "Confirmed seller reversals will be skipped. Only the customer refund will run."
        : "Confirmed movements will be skipped. Only the failed reversal and remaining steps will run.",
      tone: "info",
      queueStatus: "processing",
    };
  }

  if (execution?.state === "failed") {
    return {
      kind: "manual_intervention",
      label: "Manual intervention",
      heading: "Automatic execution stopped",
      detail: execution.lastError ?? "Payments operations must resolve the provider rejection.",
      tone: "blocked",
      queueStatus: "blocked",
    };
  }

  if (execution && ["approved", "reversing_transfers", "refunding_payment"].includes(execution.state)) {
    const isRefund = execution.pendingOperation === "payment_refund"
      || execution.state === "refunding_payment";
    return {
      kind: isRefund ? "executing_refund" : "executing_reversal",
      label: isRefund ? "Refund in progress" : "Reversal in progress",
      heading: isRefund ? "Customer refund in progress" : "Seller reversal in progress",
      detail: isRefund
        ? "Waiting for the provider to confirm the customer refund."
        : "Waiting for the provider to confirm the seller reversal.",
      tone: "info",
      queueStatus: "processing",
    };
  }

  if (claim.status === "ready_for_approval") {
    return {
      kind: "ready",
      label: "Ready to approve",
      heading: "Ready for approval",
      tone: "ready",
      queueStatus: "ready_for_approval",
    };
  }

  if (claim.status === "blocked") {
    return {
      kind: "blocked",
      label: "Blocked",
      heading: "Approval blocked",
      detail: "Resolve the payment or transfer check before approval.",
      tone: "blocked",
      queueStatus: "blocked",
    };
  }

  if (claim.status === "processing") {
    return {
      kind: "executing",
      label: claim.statusLabel || "Execution in progress",
      heading: "Execution in progress",
      detail: "Refresh to load the latest confirmed provider state.",
      tone: "info",
      queueStatus: "processing",
    };
  }

  return {
    kind: "review",
    label: claim.statusLabel || "Needs review",
    heading: "Review required",
    tone: "review",
    queueStatus: "needs_review",
  };
}
