import assert from "node:assert/strict";
import test from "node:test";

import { POST as approveClaim } from "../src/app/api/claims/[id]/approve/route";
import { GET as downloadClaimAudit } from "../src/app/api/claims/[id]/audit/route";
import { getOrderById } from "../src/lib/data";
import { refundPlanFingerprint } from "../src/lib/execution-saga";
import { getDemoClaimView, getDemoRuntime, resetDemoRuntime } from "../src/server/demo-runtime";

const context = (id: string) => ({ params: Promise.resolve({ id }) });

test("claim audit export is complete enough to inspect and excludes raw identifiers", async () => {
  resetDemoRuntime();
  const id = "RET-260903-031";
  const claim = await getDemoClaimView(id);
  const order = claim ? getOrderById(claim.orderId) : undefined;
  assert.ok(claim?.decision && order);

  const approval = await approveClaim(new Request(`http://localhost/api/claims/${id}/approve`, {
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost",
      "content-type": "application/json",
      "x-returnsplit-request-id": "req_audit_export_test",
    },
    body: JSON.stringify({ expectedPlanFingerprint: refundPlanFingerprint(claim.decision) }),
  }), context(id));
  assert.equal(approval.status, 200);

  const response = await downloadClaimAudit(
    new Request(`http://localhost/api/claims/${id}/audit`),
    context(id),
  );
  const serialized = await response.text();
  const bundle = JSON.parse(serialized) as {
    kind: string;
    claim: { claimEvidenceSha256: string };
    decision: { planFingerprint: string };
    approval: { actor: string };
    execution: { state: string; events: Array<{ action: string; detail: Record<string, unknown> }> };
  };

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-disposition"), `attachment; filename="${id}-audit.json"`);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(bundle.kind, "returnsplit_redacted_claim_audit_bundle");
  assert.match(bundle.claim.claimEvidenceSha256, /^[a-f0-9]{64}$/);
  assert.match(bundle.decision.planFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(bundle.approval.actor, "Priyanshu");
  assert.equal(bundle.execution.state, "completed");
  assert.ok(bundle.execution.events.length >= 4);
  const approvalEvent = bundle.execution.events.find((event) => event.action === "refund_plan_approved");
  assert.match(String(approvalEvent?.detail.providerSnapshotVerifiedAt), /^\d{4}-\d{2}-\d{2}T/);

  assert.doesNotMatch(serialized, new RegExp(claim.customer.email.replaceAll(".", "\\.")));
  assert.doesNotMatch(serialized, new RegExp(order.paymentId));
  assert.doesNotMatch(serialized, new RegExp(claim.claimText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const transfer of order.transfers) {
    assert.doesNotMatch(serialized, new RegExp(transfer.providerTransferId));
    assert.doesNotMatch(serialized, new RegExp(transfer.linkedAccountId));
  }
  const saga = await getDemoRuntime().store.findByClaimId(id);
  assert.ok(saga);
  for (const step of [...saga.reversals, saga.refund]) {
    if (step.providerId) assert.doesNotMatch(serialized, new RegExp(step.providerId));
    assert.doesNotMatch(serialized, new RegExp(step.receipt));
    assert.doesNotMatch(serialized, new RegExp(step.idempotencyKey));
  }
});

test("claim audit export returns 404 for an unknown claim", async () => {
  const response = await downloadClaimAudit(
    new Request("http://localhost/api/claims/not-a-claim/audit"),
    context("not-a-claim"),
  );
  assert.equal(response.status, 404);
});
