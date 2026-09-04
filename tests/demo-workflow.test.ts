import assert from "node:assert/strict";
import test from "node:test";

import { POST as approveClaim } from "../src/app/api/claims/[id]/approve/route";
import { POST as escalateClaim } from "../src/app/api/claims/[id]/escalate/route";
import { POST as preflightClaim } from "../src/app/api/claims/[id]/preflight/route";
import { POST as updateRecovery } from "../src/app/api/claims/[id]/recovery/route";
import { POST as resolveClaim } from "../src/app/api/claims/[id]/resolve/route";
import { POST as resetDemo } from "../src/app/api/demo/reset/route";
import {
  getDemoClaimView,
  getDemoEscalation,
  getDemoEscalationHistory,
  getDemoExecutionActivity,
  getDemoPreflight,
  getDemoRecoveryCase,
  getDemoRuntime,
  getDemoSessionActivity,
  hasOpenDemoRecovery,
  resetDemoRuntime,
  toDemoEscalationReceipt,
  type DemoRecoveryReceipt,
} from "../src/server/demo-runtime";
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

async function recordVerifiedPreflight(id: string, expectedPlanFingerprint: string, requestId: string) {
  const response = await preflightClaim(
    mutationRequest(`/api/claims/${id}/preflight`, { expectedPlanFingerprint }, requestId),
    context(id),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: string }).status, "verified");
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

test("an operator can abstain, request evidence with a rationale, and close the case by resolving the review", async () => {
  resetDemoRuntime();
  const id = "RET-260903-033";
  const shortRationale = await escalateClaim(
    mutationRequest(`/api/claims/${id}/escalate`, { kind: "evidence_request", rationale: "unclear" }, "req_evidence_short"),
    context(id),
  );
  assert.equal(shortRationale.status, 409);

  const rationale = "Both colour variants are indistinguishable; follow up at customer@example.com or +91 98765 43210.";
  const response = await escalateClaim(
    mutationRequest(`/api/claims/${id}/escalate`, { kind: "evidence_request", rationale }, "req_evidence"),
    context(id),
  );
  const body = await response.json() as { caseId: string; kind: string; owner: string; dueAt: string; nextAction: string; notes: Array<{ redactedText: string }> };
  assert.equal(response.status, 200);
  assert.equal(body.kind, "evidence_request");
  assert.equal(body.owner, "Customer Support");
  assert.match(body.dueAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(body.nextAction, /product-label photo/i);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(rationale));
  assert.match(body.notes[0]?.redactedText ?? "", /Both colour variants.*\[redacted email\].*\[redacted phone\]/);
  assert.doesNotMatch(JSON.stringify(body), /customer@example\.com|98765 43210/);
  assert.equal((await getDemoClaimView(id))?.statusLabel, "Evidence requested");
  assert.match(getDemoEscalation(id)?.notes[0]?.sha256 ?? "", /^[a-f0-9]{64}$/);

  const resolution = await resolveClaim(
    mutationRequest(`/api/claims/${id}/resolve`, {
      kind: "item_match",
      returnedItemId: "returned_ret033_1",
      orderLineId: "line_mm18489_sand",
    }, "req_evidence_resolved"),
    context(id),
  );
  assert.equal(resolution.status, 200);
  assert.equal(getDemoEscalation(id)?.status, "closed");
  assert.match(getDemoEscalation(id)?.closedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
});

test("a closed evidence request does not block a later payments-reconciliation case", async () => {
  resetDemoRuntime();
  const id = "RET-260903-033";
  const evidence = await escalateClaim(
    mutationRequest(`/api/claims/${id}/escalate`, {
      kind: "evidence_request",
      rationale: "The submitted image cannot distinguish the two ordered colour variants.",
    }, "req_sequential_evidence"),
    context(id),
  );
  assert.equal(evidence.status, 200);

  const resolution = await resolveClaim(
    mutationRequest(`/api/claims/${id}/resolve`, {
      kind: "item_match",
      returnedItemId: "returned_ret033_1",
      orderLineId: "line_mm18489_sand",
    }, "req_sequential_resolution"),
    context(id),
  );
  assert.equal(resolution.status, 200);
  const claim = await getDemoClaimView(id);
  assert.ok(claim?.decision);
  const expectedPlanFingerprint = refundPlanFingerprint(claim.decision);
  await recordVerifiedPreflight(id, expectedPlanFingerprint, "req_sequential_preflight");
  getDemoRuntime().demoProvider?.queueFault(
    `saga_${id}:reversal:${claim.decision.sellerReversals[0].transferId}`,
    "fail_terminal",
  );
  const approval = await approveClaim(
    mutationRequest(`/api/claims/${id}/approve`, { expectedPlanFingerprint }, "req_sequential_approval"),
    context(id),
  );
  assert.equal(approval.status, 409);

  const reconciliation = await escalateClaim(
    mutationRequest(`/api/claims/${id}/escalate`, undefined, "req_sequential_reconciliation"),
    context(id),
  );
  const reconciliationBody = await reconciliation.json() as { caseId: string; kind: string; status: string };
  assert.equal(reconciliation.status, 200);
  assert.equal(reconciliationBody.kind, "reconciliation");
  assert.equal(reconciliationBody.status, "open");
  assert.deepEqual(getDemoEscalationHistory(id).map((entry) => [entry.kind, entry.status]), [
    ["evidence_request", "closed"],
    ["reconciliation", "open"],
  ]);
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
  const missingPreflight = await approveClaim(
    mutationRequest(`/api/claims/${id}/approve`, { expectedPlanFingerprint }, "req_missing_preflight"),
    context(id),
  );
  assert.equal(missingPreflight.status, 409);
  assert.match((await missingPreflight.json() as { error: string }).error, /current verified provider balance check is required/i);

  await recordVerifiedPreflight(id, expectedPlanFingerprint, "req_approve_preflight");
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
  const verifiedBody = await verified.json() as { status: string; checkedAt: string; expiresAt: string; expectedPaymentRemainingPaise: number };
  assert.equal(verifiedBody.status, "verified");
  assert.ok(verifiedBody.expiresAt > verifiedBody.checkedAt);
  assert.equal(verifiedBody.expectedPaymentRemainingPaise, claim.decision.providerSnapshot.remainingRefundablePaise);
  assert.equal(getDemoPreflight(id)?.requestId, "req_preflight");
  assert.ok(getDemoSessionActivity().some((event) => event.claimId === id && event.type === "provider_snapshot_checked"));

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

test("approval rejects an expired persisted preflight before creating a saga", async () => {
  resetDemoRuntime();
  const id = "RET-260903-031";
  const claim = await getDemoClaimView(id);
  assert.ok(claim?.decision);
  const expectedPlanFingerprint = refundPlanFingerprint(claim.decision);
  await recordVerifiedPreflight(id, expectedPlanFingerprint, "req_expiring_preflight");

  const preflight = getDemoPreflight(id);
  assert.ok(preflight);
  preflight.expiresAt = new Date(0).toISOString();

  const response = await approveClaim(
    mutationRequest(`/api/claims/${id}/approve`, { expectedPlanFingerprint }, "req_expired_preflight_approval"),
    context(id),
  );
  assert.equal(response.status, 409);
  assert.match((await response.json() as { error: string }).error, /current verified provider balance check is required/i);
  assert.equal(await getDemoRuntime().store.findByClaimId(id), undefined);
});

test("retryable and unknown provider outcomes survive a claim reload with only the safe next action", async () => {
  const id = "RET-260903-031";

  resetDemoRuntime();
  let claim = await getDemoClaimView(id);
  assert.ok(claim?.decision);
  const reversal = claim.decision.sellerReversals[0];
  getDemoRuntime().demoProvider?.queueFault(`saga_${id}:reversal:${reversal.transferId}`, "fail_retryable");
  await recordVerifiedPreflight(id, refundPlanFingerprint(claim.decision), "req_retryable_preflight");
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
  await recordVerifiedPreflight(id, refundPlanFingerprint(claim.decision), "req_unknown_preflight");
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
  await recordVerifiedPreflight(id, refundPlanFingerprint(claim.decision), "req_refund_retry_preflight");
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
  await recordVerifiedPreflight(id, refundPlanFingerprint(claim.decision), "req_terminal_preflight");
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

test("a marketplace-funded refund keeps its recovery work open after execution and reconciles through an idempotent lifecycle", async () => {
  resetDemoRuntime();
  const id = "RET-260903-035";
  const resolution = await resolveClaim(
    mutationRequest(`/api/claims/${id}/resolve`, { kind: "liability", liability: "marketplace" }, "req_liability"),
    context(id),
  );
  const resolutionBody = await resolution.json() as { planFingerprint: string; status: string; sellerReversalCount: number; customerRefundPaise: number };
  assert.equal(resolution.status, 200);
  assert.equal(resolutionBody.status, "ready_for_approval");
  assert.equal(resolutionBody.sellerReversalCount, 0);
  assert.doesNotMatch(JSON.stringify(resolutionBody), /@example\.com|providerTransferId|linkedAccountId/);
  const recoveryCase = getDemoEscalation(id);
  assert.equal(recoveryCase?.kind, "recovery");
  assert.equal(recoveryCase?.owner, "Recovery Operations");
  assert.equal(recoveryCase?.status, "open");
  assert.equal(recoveryCase?.notes.length, 0);
  assert.equal(recoveryCase?.responsibleParty, "unresolved");
  assert.equal(recoveryCase?.targetAmountPaise, resolutionBody.customerRefundPaise);
  assert.equal(hasOpenDemoRecovery(id), true);
  assert.ok(recoveryCase);
  const overdueReceipt = toDemoEscalationReceipt(
    recoveryCase,
    new Date(new Date(recoveryCase.createdAt).getTime() + 49 * 60 * 60 * 1_000),
  );
  assert.equal(overdueReceipt.ageHours, 49);
  assert.equal(overdueReceipt.overdue, true);

  const prematureRecovery = await updateRecovery(
    mutationRequest(`/api/claims/${id}/recovery`, {
      recoveredAmountPaise: 100,
      writtenOffAmountPaise: 0,
      responsibleParty: "courier",
      note: "Recovery cannot be recorded before the customer refund completes.",
      status: "open",
    }, "req_recovery_premature"),
    context(id),
  );
  assert.equal(prematureRecovery.status, 409);

  await recordVerifiedPreflight(id, resolutionBody.planFingerprint, "req_marketplace_preflight");
  const approval = await approveClaim(
    mutationRequest(`/api/claims/${id}/approve`, { expectedPlanFingerprint: resolutionBody.planFingerprint }, "req_marketplace_approve"),
    context(id),
  );
  const approvalBody = await approval.json() as { state: string; reversalCount: number; refundStatus: string };
  assert.equal(approval.status, 200);
  assert.equal(approvalBody.state, "completed");
  assert.equal(approvalBody.reversalCount, 0);
  assert.equal(approvalBody.refundStatus, "succeeded");
  const completed = await getDemoClaimView(id);
  assert.equal(completed?.status, "completed");
  assert.match(completed?.review.explanation ?? "", /no seller reversal was required/i);
  assert.doesNotMatch(completed?.review.explanation ?? "", /seller reversal was confirmed/i);
  assert.equal(hasOpenDemoRecovery(id), true);

  const targetAmountPaise = getDemoRecoveryCase(id)?.targetAmountPaise ?? 0;
  const recoveredAmountPaise = Math.floor(targetAmountPaise / 3);
  const privateNote = "Courier contact ops.agent@example.com confirmed receipt at +91 98765 43210.";
  const partial = await updateRecovery(
    mutationRequest(`/api/claims/${id}/recovery`, {
      recoveredAmountPaise,
      writtenOffAmountPaise: 0,
      responsibleParty: "courier",
      note: privateNote,
      status: "open",
    }, "req_recovery_partial"),
    context(id),
  );
  const partialBody = await partial.json() as DemoRecoveryReceipt & Record<string, unknown>;
  assert.equal(partial.status, 200);
  assert.equal(partialBody.status, "open");
  assert.equal(partialBody.recoveryOutcome, "partial");
  assert.equal(partialBody.recoveredAmountPaise, recoveredAmountPaise);
  assert.equal(partialBody.writtenOffAmountPaise, 0);
  assert.equal(partialBody.outstandingAmountPaise, targetAmountPaise - recoveredAmountPaise);
  assert.equal(partialBody.responsibleParty, "courier");
  assert.equal(partialBody.noteRecorded, true);
  assert.match(partialBody.notes[0]?.redactedText ?? "", /\[redacted email\].*\[redacted phone\]/);
  assert.match(partialBody.notes[0]?.sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(partialBody), /ops\.agent@example\.com|98765 43210/);
  assert.equal(partialBody.claimId, undefined);
  assert.equal(partialBody.processedUpdateFingerprints, undefined);

  const duplicate = await updateRecovery(
    mutationRequest(`/api/claims/${id}/recovery`, {
      recoveredAmountPaise,
      writtenOffAmountPaise: 0,
      responsibleParty: "courier",
      note: privateNote,
      status: "open",
    }, "req_recovery_partial"),
    context(id),
  );
  assert.equal(duplicate.status, 200);
  assert.equal(getDemoRecoveryCase(id)?.notes.length, 1);
  assert.equal(getDemoSessionActivity().filter((event) => event.requestId === "req_recovery_partial").length, 1);

  const requestIdCollision = await updateRecovery(
    mutationRequest(`/api/claims/${id}/recovery`, {
      recoveredAmountPaise,
      writtenOffAmountPaise: 0,
      responsibleParty: "courier",
      note: "A different update cannot reuse the prior mutation request identifier.",
      status: "open",
    }, "req_recovery_partial"),
    context(id),
  );
  assert.equal(requestIdCollision.status, 409);

  const regressed = await updateRecovery(
    mutationRequest(`/api/claims/${id}/recovery`, {
      recoveredAmountPaise: Math.max(0, recoveredAmountPaise - 1),
      writtenOffAmountPaise: 0,
      responsibleParty: "courier",
      note: "Confirmed recovery accounting cannot silently move backwards.",
      status: "open",
    }, "req_recovery_regression"),
    context(id),
  );
  assert.equal(regressed.status, 409);

  const overSettled = await updateRecovery(
    mutationRequest(`/api/claims/${id}/recovery`, {
      recoveredAmountPaise: targetAmountPaise,
      writtenOffAmountPaise: 1,
      responsibleParty: "courier",
      note: "This update exceeds the exact marketplace-funded recovery target.",
      status: "closed",
    }, "req_recovery_over_settled"),
    context(id),
  );
  assert.equal(overSettled.status, 409);

  const incompleteClose = await updateRecovery(
    mutationRequest(`/api/claims/${id}/recovery`, {
      recoveredAmountPaise,
      writtenOffAmountPaise: 0,
      responsibleParty: "courier",
      note: "Attempted closure before the recovery target was reconciled.",
      status: "closed",
    }, "req_recovery_incomplete"),
    context(id),
  );
  assert.equal(incompleteClose.status, 409);
  assert.equal(hasOpenDemoRecovery(id), true);

  const closed = await updateRecovery(
    mutationRequest(`/api/claims/${id}/recovery`, {
      recoveredAmountPaise,
      writtenOffAmountPaise: targetAmountPaise - recoveredAmountPaise,
      responsibleParty: "courier",
      note: "Courier payment recorded; the unrecoverable balance was approved for write-off.",
      status: "closed",
    }, "req_recovery_close"),
    context(id),
  );
  const closedBody = await closed.json() as DemoRecoveryReceipt;
  assert.equal(closed.status, 200);
  assert.equal(closedBody.status, "closed");
  assert.equal(closedBody.recoveryOutcome, "mixed");
  assert.equal(closedBody.outstandingAmountPaise, 0);
  assert.equal(closedBody.overdue, false);
  assert.match(closedBody.closedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(closedBody.notes.length, 2);
  assert.equal(hasOpenDemoRecovery(id), false);
  assert.equal((await getDemoClaimView(id))?.status, "completed");
});

test("recovery updates reject invalid totals, unsupported parties, and claims without a recovery case", async () => {
  resetDemoRuntime();
  const noCase = await updateRecovery(
    mutationRequest("/api/claims/RET-260903-031/recovery", {
      recoveredAmountPaise: 100,
      writtenOffAmountPaise: 0,
      responsibleParty: "seller",
      note: "A valid note for a missing recovery case.",
      status: "open",
    }, "req_recovery_missing"),
    context("RET-260903-031"),
  );
  assert.equal(noCase.status, 409);

  const invalid = await updateRecovery(
    mutationRequest("/api/claims/RET-260903-031/recovery", {
      recoveredAmountPaise: 10.5,
      writtenOffAmountPaise: 0,
      responsibleParty: "customer",
      note: "A valid-length but structurally invalid recovery note.",
      status: "open",
    }, "req_recovery_invalid"),
    context("RET-260903-031"),
  );
  assert.equal(invalid.status, 400);
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
