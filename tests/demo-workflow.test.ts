import assert from "node:assert/strict";
import test from "node:test";

import { POST as approveClaim } from "../src/app/api/claims/[id]/approve/route";
import { POST as escalateClaim } from "../src/app/api/claims/[id]/escalate/route";
import { POST as preflightClaim } from "../src/app/api/claims/[id]/preflight/route";
import { POST as resolveClaim } from "../src/app/api/claims/[id]/resolve/route";
import { POST as resetDemo } from "../src/app/api/demo/reset/route";
import { getDemoClaimView, getDemoEscalation, getDemoExecutionActivity, getDemoRuntime, getDemoSessionActivity, resetDemoRuntime } from "../src/server/demo-runtime";
import { refundPlanFingerprint } from "../src/lib/execution-saga";

const context = (id: string) => ({ params: Promise.resolve({ id }) });

function mutationRequest(path: string, body?: unknown, requestId = "req_demo_test") {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost",
      "x-returnsplit-request-id": requestId,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("an item-match review persists, recalculates, and creates a new executable fingerprint", async () => {
  resetDemoRuntime();
  const id = "RET-260903-033";
  const response = await resolveClaim(
    mutationRequest(`/api/claims/${id}/resolve`, {
      kind: "item_match",
      returnedItemId: "returned_ret033_1",
      orderLineId: "line_mm18489_sand",
    }),
    context(id),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { planFingerprint: string };
  assert.match(body.planFingerprint, /^[a-f0-9]{64}$/);

  const persisted = await getDemoClaimView(id);
  assert.equal(persisted?.status, "ready_for_approval");
  assert.equal(persisted.returnedItems[0].orderLineId, "line_mm18489_sand");
  assert.ok(persisted.decision);
  assert.equal(refundPlanFingerprint(persisted.decision), body.planFingerprint);
  assert.ok(getDemoSessionActivity().some((event) => event.claimId === id && event.requestId === "req_demo_test"));
});

test("approval rejects a stale fingerprint before execution and duplicate approval remains idempotent", async () => {
  resetDemoRuntime();
  const id = "RET-260903-031";
  const claim = await getDemoClaimView(id);
  assert.ok(claim?.decision);

  const stale = await approveClaim(
    mutationRequest(`/api/claims/${id}/approve`, { expectedPlanFingerprint: "0".repeat(64) }, "req_stale"),
    context(id),
  );
  assert.equal(stale.status, 409);
  assert.equal((await getDemoClaimView(id))?.status, "ready_for_approval");

  const expectedPlanFingerprint = refundPlanFingerprint(claim.decision);
  const first = await approveClaim(
    mutationRequest(`/api/claims/${id}/approve`, { expectedPlanFingerprint }, "req_approve"),
    context(id),
  );
  const firstBody = await first.json() as { state: string; refundId: string };
  assert.equal(first.status, 200);
  assert.equal(firstBody.state, "completed");
  assert.match(firstBody.refundId, /^•{4}/);
  assert.doesNotMatch(JSON.stringify(firstBody), /demo_rfnd_/);

  const duplicate = await approveClaim(
    mutationRequest(`/api/claims/${id}/approve`, { expectedPlanFingerprint }, "req_duplicate"),
    context(id),
  );
  const duplicateBody = await duplicate.json() as { state: string; refundId: string };
  assert.equal(duplicate.status, 200);
  assert.equal(duplicateBody.refundId, firstBody.refundId);

  const completed = await getDemoClaimView(id);
  const saga = await getDemoRuntime().store.findByClaimId(id);
  assert.equal(completed?.status, "completed");
  assert.equal(completed.approvedAt, saga?.approval.approvedAt);
  assert.deepEqual(completed.execution?.completedReversalTransferIds, ["trf_mm18472_aavya"]);

  const executionActivity = await getDemoExecutionActivity();
  assert.ok(executionActivity.some((event) => event.claimId === id && event.type === "approval_recorded"));
  assert.ok(executionActivity.some((event) => event.claimId === id && event.type === "transfer_reversed"));
  assert.ok(executionActivity.some((event) => event.claimId === id && event.type === "refund_created"));
  assert.ok(executionActivity.every((event) => event.requestId && event.actor));
});

test("provider preflight verifies current balances and approval fails closed after an external change", async () => {
  resetDemoRuntime();
  const id = "RET-260903-031";
  const claim = await getDemoClaimView(id);
  assert.ok(claim?.decision);
  const expectedPlanFingerprint = refundPlanFingerprint(claim.decision);

  const verified = await preflightClaim(
    mutationRequest(`/api/claims/${id}/preflight`, { expectedPlanFingerprint }, "req_preflight"),
    context(id),
  );
  assert.equal(verified.status, 200);
  assert.equal((await verified.json() as { status: string }).status, "verified");

  const reversal = claim.decision.sellerReversals[0];
  await getDemoRuntime().provider.reverseTransfer({
    providerTransferId: reversal.providerTransferId,
    amountPaise: 1,
    receipt: "external_change",
    idempotencyKey: "external_change",
    notes: {},
  });
  const stale = await approveClaim(
    mutationRequest(`/api/claims/${id}/approve`, { expectedPlanFingerprint }, "req_after_external_change"),
    context(id),
  );
  assert.equal(stale.status, 409);
  assert.match((await stale.json() as { error: string }).error, /provider preflight failed.*balance changed/i);
  assert.equal(await getDemoRuntime().store.findByClaimId(id), undefined);
});

test("retryable and unknown provider outcomes survive a claim reload with only the safe next action", async () => {
  const id = "RET-260903-031";

  resetDemoRuntime();
  let claim = await getDemoClaimView(id);
  assert.ok(claim?.decision);
  const reversal = claim.decision.sellerReversals[0];
  getDemoRuntime().demoProvider?.queueFault(`saga_${id}:reversal:${reversal.transferId}`, "fail_retryable");
  const failed = await approveClaim(
    mutationRequest(`/api/claims/${id}/approve`, { expectedPlanFingerprint: refundPlanFingerprint(claim.decision) }, "req_retryable"),
    context(id),
  );
  assert.equal(failed.status, 409);
  assert.equal((await failed.json() as { action: string }).action, "retry");
  let projected = await getDemoClaimView(id);
  assert.equal(projected?.status, "processing");
  assert.equal(projected.statusLabel, "Retry available");
  assert.equal(projected.execution?.canResume, true);

  resetDemoRuntime();
  claim = await getDemoClaimView(id);
  assert.ok(claim?.decision);
  getDemoRuntime().demoProvider?.queueFault(`saga_${id}:reversal:${claim.decision.sellerReversals[0].transferId}`, "unknown_before_commit");
  const unknown = await approveClaim(
    mutationRequest(`/api/claims/${id}/approve`, { expectedPlanFingerprint: refundPlanFingerprint(claim.decision) }, "req_unknown"),
    context(id),
  );
  assert.equal(unknown.status, 202);
  assert.equal((await unknown.json() as { action: string }).action, "reconcile");
  projected = await getDemoClaimView(id);
  assert.equal(projected?.statusLabel, "Reconciliation required");
  assert.equal(projected?.execution?.requiresReconciliation, true);
});

test("a retryable refund failure is identified as a refund operation after every reversal succeeds", async () => {
  resetDemoRuntime();
  const id = "RET-260903-031";
  const claim = await getDemoClaimView(id);
  assert.ok(claim?.decision);
  getDemoRuntime().demoProvider?.queueFault(`saga_${id}:refund`, "fail_retryable");
  const response = await approveClaim(
    mutationRequest(`/api/claims/${id}/approve`, { expectedPlanFingerprint: refundPlanFingerprint(claim.decision) }, "req_refund_retry"),
    context(id),
  );
  assert.equal(response.status, 409);
  const projected = await getDemoClaimView(id);
  assert.equal(projected?.statusLabel, "Retry available");
  assert.equal(projected?.execution?.pendingOperation, "payment_refund");
  assert.deepEqual(projected?.execution?.completedReversalTransferIds, ["trf_mm18472_aavya"]);
});

test("a terminal provider failure cannot retry and can be escalated", async () => {
  resetDemoRuntime();
  const id = "RET-260903-031";
  const claim = await getDemoClaimView(id);
  assert.ok(claim?.decision);
  const reversal = claim.decision.sellerReversals[0];
  getDemoRuntime().demoProvider?.queueFault(`saga_${id}:reversal:${reversal.transferId}`, "fail_terminal");
  const response = await approveClaim(
    mutationRequest(`/api/claims/${id}/approve`, { expectedPlanFingerprint: refundPlanFingerprint(claim.decision) }, "req_terminal"),
    context(id),
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { action: string }).action, "manual_intervention");
  const projected = await getDemoClaimView(id);
  assert.equal(projected?.statusLabel, "Manual intervention");
  assert.equal(projected?.execution?.canResume, false);

  const escalation = await escalateClaim(mutationRequest(`/api/claims/${id}/escalate`, undefined, "req_terminal_escalate"), context(id));
  assert.equal(escalation.status, 200);
  assert.ok(getDemoEscalation(id));
});

test("a marketplace liability decision persists and executes without reversing a seller transfer", async () => {
  resetDemoRuntime();
  const id = "RET-260903-035";
  const resolution = await resolveClaim(
    mutationRequest(`/api/claims/${id}/resolve`, { kind: "liability", liability: "marketplace" }, "req_liability"),
    context(id),
  );
  const resolutionBody = await resolution.json() as { planFingerprint: string; status: string; sellerReversalCount: number };
  assert.equal(resolution.status, 200);
  assert.equal(resolutionBody.status, "ready_for_approval");
  assert.equal(resolutionBody.sellerReversalCount, 0);
  assert.doesNotMatch(JSON.stringify(resolutionBody), /@example\.com|providerTransferId|linkedAccountId/);

  const approval = await approveClaim(
    mutationRequest(`/api/claims/${id}/approve`, { expectedPlanFingerprint: resolutionBody.planFingerprint }, "req_marketplace_approve"),
    context(id),
  );
  const approvalBody = await approval.json() as { state: string; reversalCount: number; refundStatus: string };
  assert.equal(approval.status, 200);
  assert.equal(approvalBody.state, "completed");
  assert.equal(approvalBody.reversalCount, 0);
  assert.equal(approvalBody.refundStatus, "succeeded");
});

test("a blocked claim creates one persisted reconciliation case and reset clears it", async () => {
  resetDemoRuntime();
  const id = "RET-260903-038";
  const first = await escalateClaim(mutationRequest(`/api/claims/${id}/escalate`, undefined, "req_escalate"), context(id));
  const firstBody = await first.json() as { caseId: string };
  assert.equal(first.status, 200);
  assert.equal(firstBody.caseId, "recon_RET_260903_038");

  const duplicate = await escalateClaim(mutationRequest(`/api/claims/${id}/escalate`, undefined, "req_escalate_again"), context(id));
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json() as { caseId: string }).caseId, firstBody.caseId);
  assert.equal(getDemoSessionActivity().filter((event) => event.claimId === id).length, 1);

  resetDemoRuntime();
  assert.equal(getDemoEscalation(id), undefined);
  assert.equal(getDemoSessionActivity().length, 0);
});

test("the reset endpoint validates and returns deterministic scenario routes", async () => {
  const response = await resetDemo(mutationRequest("/api/demo/reset", { scenario: "retry_recovery" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, scenario: "retry_recovery", startPath: "/claims/RET-260903-041" });

  const invalid = await resetDemo(mutationRequest("/api/demo/reset", { scenario: "unknown" }));
  assert.equal(invalid.status, 400);
});

test("browser mutation routes reject requests without a verifiable same-origin context", async () => {
  const response = await resetDemo(new Request("http://localhost/api/demo/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario: "golden_path" }),
  }));
  assert.equal(response.status, 403);

  const preflight = await preflightClaim(new Request("http://localhost/api/claims/RET-260903-031/preflight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedPlanFingerprint: "0".repeat(64) }),
  }), context("RET-260903-031"));
  assert.equal(preflight.status, 403);
});
