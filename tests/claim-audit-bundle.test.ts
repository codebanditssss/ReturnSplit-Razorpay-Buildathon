import assert from "node:assert/strict";
import test from "node:test";

import { POST as approveClaim } from "../src/app/api/claims/[id]/approve/route";
import { GET as downloadClaimAudit } from "../src/app/api/claims/[id]/audit/route";
import { POST as escalateClaim } from "../src/app/api/claims/[id]/escalate/route";
import { POST as preflightClaim } from "../src/app/api/claims/[id]/preflight/route";
import { POST as updateRecovery } from "../src/app/api/claims/[id]/recovery/route";
import { POST as resolveClaim } from "../src/app/api/claims/[id]/resolve/route";
import { getOrderById } from "../src/lib/data";
import { refundPlanFingerprint } from "../src/lib/execution-saga";
import { getDemoClaimView, getDemoRuntime, resetDemoRuntime } from "../src/server/demo-runtime";

const context = (id: string) => ({ params: Promise.resolve({ id }) });

function mutationRequest(path: string, body: unknown, requestId: string) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost",
      "content-type": "application/json",
      "x-returnsplit-request-id": requestId,
    },
    body: JSON.stringify(body),
  });
}

test("claim audit export is complete enough to inspect and excludes raw identifiers", async () => {
  resetDemoRuntime();
  const id = "RET-260903-031";
  const claim = await getDemoClaimView(id);
  const order = claim ? getOrderById(claim.orderId) : undefined;
  assert.ok(claim?.decision && order);
  const planFingerprint = refundPlanFingerprint(claim.decision);

  const preflight = await preflightClaim(mutationRequest(`/api/claims/${id}/preflight`, {
    expectedPlanFingerprint: planFingerprint,
  }, "req_audit_export_preflight"), context(id));
  assert.equal(preflight.status, 200);

  const approval = await approveClaim(new Request(`http://localhost/api/claims/${id}/approve`, {
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost",
      "content-type": "application/json",
      "x-returnsplit-request-id": "req_audit_export_test",
    },
    body: JSON.stringify({ expectedPlanFingerprint: planFingerprint }),
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

test("claim audit export includes recovery accounting and only redacted operations notes", async () => {
  resetDemoRuntime();
  const id = "RET-260903-035";
  const evidenceEmail = "customer.evidence@example.com";
  const evidenceRequest = await escalateClaim(mutationRequest(`/api/claims/${id}/escalate`, {
    kind: "evidence_request",
    rationale: `Damage evidence is inconclusive; request new photos from ${evidenceEmail}.`,
  }, "req_audit_evidence_open"), context(id));
  assert.equal(evidenceRequest.status, 200);
  const resolution = await resolveClaim(mutationRequest(`/api/claims/${id}/resolve`, {
    kind: "liability",
    liability: "marketplace",
  }, "req_audit_recovery_open"), context(id));
  const resolutionBody = await resolution.json() as { customerRefundPaise: number };
  assert.equal(resolution.status, 200);
  const claim = await getDemoClaimView(id);
  assert.ok(claim?.decision);
  const planFingerprint = refundPlanFingerprint(claim.decision);
  const preflight = await preflightClaim(mutationRequest(`/api/claims/${id}/preflight`, {
    expectedPlanFingerprint: planFingerprint,
  }, "req_audit_recovery_preflight"), context(id));
  assert.equal(preflight.status, 200);
  const approval = await approveClaim(mutationRequest(`/api/claims/${id}/approve`, {
    expectedPlanFingerprint: planFingerprint,
  }, "req_audit_recovery_approve"), context(id));
  assert.equal(approval.status, 200);

  const rawEmail = "courier.owner@example.com";
  const rawPhone = "+91 99887 76655";
  const rawIpAddress = "203.0.113.42";
  const rawAadhaar = "1234 5678 9012";
  const rawCard = "4111-1111-1111-1111";
  const update = await updateRecovery(mutationRequest(`/api/claims/${id}/recovery`, {
    recoveredAmountPaise: 0,
    writtenOffAmountPaise: resolutionBody.customerRefundPaise,
    responsibleParty: "courier",
    note: `Unable to collect from ${rawEmail}; phone ${rawPhone}; IP ${rawIpAddress}; Aadhaar ${rawAadhaar}; card ${rawCard}.`,
    status: "closed",
  }, "req_audit_recovery_close"), context(id));
  assert.equal(update.status, 200);

  const response = await downloadClaimAudit(new Request(`http://localhost/api/claims/${id}/audit`), context(id));
  const serialized = await response.text();
  const bundle = JSON.parse(serialized) as {
    operationsCases: Array<{
      kind: string;
      status: string;
      notes: Array<{ redactedText: string; sha256: string }>;
    }>;
    escalation: {
      status: string;
      noteRecorded: boolean;
      notes: Array<{ redactedText: string; sha256: string }>;
      closedAt: string;
      recovery: {
        targetAmountPaise: number;
        recoveredAmountPaise: number;
        writtenOffAmountPaise: number;
        outstandingAmountPaise: number;
        responsibleParty: string;
        outcome: string;
      };
    };
  };
  assert.equal(response.status, 200);
  assert.deepEqual(bundle.operationsCases.map((entry) => [entry.kind, entry.status]), [
    ["evidence_request", "closed"],
    ["recovery", "closed"],
  ]);
  assert.match(bundle.operationsCases[0]?.notes[0]?.redactedText ?? "", /\[redacted email\]/);
  assert.equal(bundle.escalation.status, "closed");
  assert.equal(bundle.escalation.noteRecorded, true);
  assert.match(bundle.escalation.notes[0]?.redactedText ?? "", /\[redacted email\].*\[redacted phone\].*\[redacted IP address\].*\[redacted number\].*\[redacted number\]/);
  assert.match(bundle.escalation.notes[0]?.sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.match(bundle.escalation.closedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(bundle.escalation.recovery, {
    targetAmountPaise: resolutionBody.customerRefundPaise,
    recoveredAmountPaise: 0,
    writtenOffAmountPaise: resolutionBody.customerRefundPaise,
    outstandingAmountPaise: 0,
    responsibleParty: "courier",
    outcome: "written_off",
  });
  assert.doesNotMatch(serialized, new RegExp(rawEmail.replaceAll(".", "\\.")));
  assert.doesNotMatch(serialized, new RegExp(rawPhone.replace(/[+]/g, "\\+")));
  assert.doesNotMatch(serialized, new RegExp(rawIpAddress.replaceAll(".", "\\.")));
  assert.doesNotMatch(serialized, new RegExp(rawAadhaar));
  assert.doesNotMatch(serialized, new RegExp(rawCard));
  assert.doesNotMatch(serialized, new RegExp(evidenceEmail.replaceAll(".", "\\.")));
});
