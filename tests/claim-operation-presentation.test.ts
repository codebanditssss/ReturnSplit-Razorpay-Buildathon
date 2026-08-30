import assert from "node:assert/strict";
import test from "node:test";

import { claimOperationPresentation } from "../src/lib/claim-operation-presentation";
import type { ClaimExecutionSummary, ClaimStatus } from "../src/lib/types";

function present(status: ClaimStatus, execution?: ClaimExecutionSummary) {
  return claimOperationPresentation({ status, statusLabel: "Existing label", ...(execution ? { execution } : {}) });
}

test("unknown provider results are warnings that require a check, never safe retries", () => {
  const result = present("processing", {
    sagaId: "saga_unknown",
    state: "refund_result_unknown",
    canResume: false,
    requiresReconciliation: true,
    pendingOperation: "payment_refund",
  });

  assert.equal(result.kind, "reconcile_refund");
  assert.equal(result.label, "Provider check required");
  assert.equal(result.tone, "review");
  assert.match(result.detail ?? "", /before retrying/);
});

test("retry presentation identifies the exact remaining operation", () => {
  const refund = present("processing", {
    sagaId: "saga_refund_retry",
    state: "failed",
    canResume: true,
    pendingOperation: "payment_refund",
  });
  const reversal = present("processing", {
    sagaId: "saga_reversal_retry",
    state: "failed",
    canResume: true,
    pendingOperation: "transfer_reversal",
  });

  assert.equal(refund.label, "Retry refund");
  assert.equal(refund.kind, "retry_refund");
  assert.equal(reversal.label, "Retry reversal");
  assert.equal(reversal.kind, "retry_reversal");
});

test("non-retryable failures are presented and queued as blocked", () => {
  const result = present("processing", {
    sagaId: "saga_terminal",
    state: "failed",
    canResume: false,
    pendingOperation: "transfer_reversal",
    lastError: "Provider rejected the reversal.",
  });

  assert.equal(result.kind, "manual_intervention");
  assert.equal(result.label, "Manual intervention");
  assert.equal(result.tone, "blocked");
  assert.equal(result.queueStatus, "blocked");
  assert.equal(result.detail, "Provider rejected the reversal.");
});

test("a processing claim without a projected step remains an execution state", () => {
  const result = present("processing");

  assert.equal(result.kind, "executing");
  assert.equal(result.tone, "info");
  assert.equal(result.queueStatus, "processing");
});
