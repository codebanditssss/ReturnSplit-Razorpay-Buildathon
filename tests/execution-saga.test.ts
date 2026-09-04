import assert from "node:assert/strict";
import test from "node:test";

import { getClaimById, getOrderById, getPolicyById } from "../src/lib/data";
import { executeApprovedRefund, InMemorySagaStore } from "../src/lib/execution-saga";
import { DemoRouteProvider } from "../src/lib/provider";
import { InMemoryWebhookInbox } from "../src/lib/webhook-inbox";

function goldenFixture() {
  const claim = getClaimById("RET-260903-031");
  const order = getOrderById("MM-18472");
  const policy = order ? getPolicyById(order.policyId) : undefined;
  assert.ok(claim?.decision && order && policy);
  const provider = new DemoRouteProvider({
    transfers: Object.fromEntries(order.transfers.map((entry) => [entry.providerTransferId, entry.originalAmountPaise - entry.reversedAmountPaise])),
    payments: { [order.paymentId]: order.capturedPaymentPaise - order.refundedPaymentPaise },
  });
  const store = new InMemorySagaStore();
  const approval = { actorId: "usr_neha", actorName: "Neha Kapoor", requestId: "req_test_001" };
  const now = () => new Date("2026-09-03T10:32:00.000Z");
  return { claim, order, policy, plan: claim.decision, provider, store, approval, now };
}

test("executes every required reversal before creating the refund", async () => {
  const fixture = goldenFixture();
  const saga = await executeApprovedRefund(fixture);
  assert.equal(saga.state, "completed");
  assert.ok(saga.reversals.every((step) => step.status === "succeeded"));
  assert.equal(saga.refund.status, "succeeded");

  const reversalAudit = saga.audit.findIndex((entry) => entry.action === "transfer_reversed");
  const refundAudit = saga.audit.findIndex((entry) => entry.action === "refund_created_and_completed");
  assert.ok(reversalAudit >= 0 && refundAudit > reversalAudit);
});

test("blocks a new saga when provider balances changed after calculation", async () => {
  const fixture = goldenFixture();
  const reversal = fixture.plan.sellerReversals[0];
  await fixture.provider.reverseTransfer({
    providerTransferId: reversal.providerTransferId,
    amountPaise: 1,
    receipt: "external_change",
    idempotencyKey: "external_change",
    notes: {},
  });

  await assert.rejects(executeApprovedRefund(fixture), /Provider preflight failed.*balance changed/i);
  assert.equal(await fixture.store.findByClaimId(fixture.plan.claimId), undefined);
});

test("a duplicate approval returns the completed saga without moving money twice", async () => {
  const fixture = goldenFixture();
  const first = await executeApprovedRefund(fixture);
  const second = await executeApprovedRefund(fixture);
  assert.equal(second.version, first.version);
  assert.equal(second.refund.providerId, first.refund.providerId);
  assert.equal(second.reversals[0].attempts, 1);
  assert.equal(second.refund.attempts, 1);
});

test("atomically blocks concurrent claims that over-reserve the same returned order line", async () => {
  const fixture = goldenFixture();
  const competingPlan = { ...fixture.plan, claimId: "RET-competing-claim" };

  const results = await Promise.allSettled([
    executeApprovedRefund(fixture),
    executeApprovedRefund({
      ...fixture,
      plan: competingPlan,
      approval: { ...fixture.approval, requestId: "req_competing_002" },
    }),
  ]);

  const completed = results.filter(
    (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof executeApprovedRefund>>> =>
      result.status === "fulfilled" && result.value.state === "completed",
  );
  const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.equal(completed.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(String(rejected[0].reason), /Returned quantity reservation conflict/);
});

test("the store rejects mutation of an approval-bound plan snapshot", async () => {
  const fixture = goldenFixture();
  const saga = await executeApprovedRefund(fixture);
  const mutated = {
    ...saga,
    planSnapshot: {
      ...saga.planSnapshot,
      policySnapshot: {
        ...saga.planSnapshot.policySnapshot,
        rules: {
          ...saga.planSnapshot.policySnapshot.rules,
          marketplaceCommissionBps: 1_600,
        },
      },
    },
  };

  await assert.rejects(
    fixture.store.save(mutated, saga.version),
    /Approved refund plan is immutable/,
  );
});

test("the store rejects terminal regression, approval changes, successful-step resets, and audit truncation", async () => {
  const fixture = goldenFixture();
  const saga = await executeApprovedRefund(fixture);

  await assert.rejects(
    fixture.store.save({ ...saga, state: "approved" }, saga.version),
    /Saga state cannot move from completed to approved/,
  );
  await assert.rejects(
    fixture.store.save({ ...saga, approval: { ...saga.approval, actorName: "Mallory" } }, saga.version),
    /approval and provider identity are immutable/,
  );
  await assert.rejects(
    fixture.store.save({ ...saga, refund: { ...saga.refund, status: "ready", providerId: undefined } }, saga.version),
    /Refund step .* cannot move from succeeded to ready/,
  );
  await assert.rejects(
    fixture.store.save({ ...saga, audit: saga.audit.slice(0, -1) }, saga.version),
    /audit history cannot be truncated/,
  );
});

test("unknown-after-commit is reconciled by receipt and never replayed", async () => {
  const fixture = goldenFixture();
  fixture.provider.queueFault(`saga_${fixture.plan.claimId}:reversal:${fixture.plan.sellerReversals[0].transferId}`, "unknown_after_commit");

  const uncertain = await executeApprovedRefund(fixture);
  assert.equal(uncertain.state, "reversal_result_unknown");
  assert.equal(uncertain.reversals[0].attempts, 1);

  const recovered = await executeApprovedRefund(fixture);
  assert.equal(recovered.state, "completed");
  assert.equal(recovered.reversals[0].attempts, 1);
  assert.ok(recovered.audit.some((entry) => entry.action === "transfer_reversal_reconciled"));
});

test("unknown-before-commit pauses after re-fetch instead of blindly retrying", async () => {
  const fixture = goldenFixture();
  fixture.provider.queueFault(`saga_${fixture.plan.claimId}:reversal:${fixture.plan.sellerReversals[0].transferId}`, "unknown_before_commit");

  await executeApprovedRefund(fixture);
  const reconciled = await executeApprovedRefund(fixture);
  assert.equal(reconciled.state, "reversal_result_unknown");
  assert.equal(reconciled.reversals[0].attempts, 1);
  assert.equal(reconciled.refund.status, "ready");
});

test("explicit retry resumes a retryable failure without repeating successful steps", async () => {
  const fixture = goldenFixture();
  fixture.provider.queueFault(`saga_${fixture.plan.claimId}:reversal:${fixture.plan.sellerReversals[0].transferId}`, "fail_retryable");

  const failed = await executeApprovedRefund(fixture);
  assert.equal(failed.state, "failed");
  assert.equal(failed.reversals[0].status, "retryable_failure");

  const retried = await executeApprovedRefund({
    ...fixture,
    approval: { ...fixture.approval, actorId: "usr_priyanshu", actorName: "Priyanshu", requestId: "req_retry_002" },
  });
  assert.equal(retried.state, "completed");
  assert.equal(retried.reversals[0].attempts, 2);
  assert.equal(retried.refund.attempts, 1);
  assert.equal(retried.lastRequestId, "req_retry_002");
  assert.ok(retried.audit.some((entry) => entry.action === "execution_resume_requested" && entry.actor === "Priyanshu" && entry.requestId === "req_retry_002"));
});

test("requires a named human approval and an override reason", async () => {
  const fixture = goldenFixture();
  await assert.rejects(
    executeApprovedRefund({ ...fixture, approval: { actorId: "", actorName: "", requestId: "req_invalid" } }),
    /human approver/,
  );
  await assert.rejects(
    executeApprovedRefund({ ...fixture, approval: { ...fixture.approval, isOverride: true } }),
    /reason is required/,
  );
});

test("webhook inbox ignores exact duplicates and surfaces event-ID conflicts", () => {
  const inbox = new InMemoryWebhookInbox();
  const event = {
    providerEventId: "event_demo_1",
    eventType: "refund.processed",
    bodyFingerprint: "sha256:abc",
    receivedAt: "2026-09-03T10:32:05.000Z",
    signatureVerified: true,
  };
  assert.deepEqual(inbox.admit(event), { outcome: "accepted" });
  assert.deepEqual(inbox.admit(event), { outcome: "duplicate", firstReceivedAt: event.receivedAt });
  assert.deepEqual(
    inbox.admit({ ...event, bodyFingerprint: "sha256:different" }),
    { outcome: "id_conflict", firstReceivedAt: event.receivedAt },
  );
  assert.deepEqual(inbox.admit({ ...event, providerEventId: "event_demo_2", signatureVerified: false }), { outcome: "rejected_unverified" });
});
