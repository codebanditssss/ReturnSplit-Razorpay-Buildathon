import assert from "node:assert/strict";
import test from "node:test";

import { claims, getClaimById, getOrderById, policies, sellers } from "../src/lib/data";
import { calculateRefundPlan } from "../src/lib/refund-engine";
import { refundPlanFingerprint } from "../src/lib/execution-saga";
import { validateRefundPlan } from "../src/lib/invariants";

test("golden claim reconciles to the expected customer, seller and marketplace paise", () => {
  const claim = getClaimById("RET-260903-031");
  assert.ok(claim?.decision);
  assert.equal(claim.decision.customerRefundPaise, 232_854);
  assert.equal(claim.decision.sellerFundedPaise, 197_926);
  assert.equal(claim.decision.marketplaceFundedPaise, 34_928);
  assert.equal(claim.decision.shippingRefundPaise, 0);
  assert.equal(claim.decision.sellerFundedPaise + claim.decision.marketplaceFundedPaise, claim.decision.customerRefundPaise);
  assert.equal(claim.decision.lineAllocations[0].discountAllocationPaise, 17_046);
  assert.match(refundPlanFingerprint(claim.decision), /^[a-f0-9]{64}$/);
});

test("approval fingerprint binds the evidence used for the decision", () => {
  const claim = getClaimById("RET-260903-031");
  assert.ok(claim?.decision);
  const changedEvidencePlan = {
    ...claim.decision,
    decisionBasis: {
      ...claim.decision.decisionBasis,
      returnedItems: claim.decision.decisionBasis.returnedItems.map((item, index) => index === 0 ? { ...item, evidenceHash: "changed" } : item),
    },
  };
  assert.notEqual(refundPlanFingerprint(changedEvidencePlan), refundPlanFingerprint(claim.decision));
});

test("approval fingerprint binds every policy rule that determines money movement", () => {
  const claim = getClaimById("RET-260903-031");
  const order = getOrderById("MM-18472");
  assert.ok(claim?.decision && order);
  assert.deepEqual(claim.decision.policySnapshot.rules, policies[0].rules);

  const changedPolicyPlan = {
    ...claim.decision,
    policySnapshot: {
      ...claim.decision.policySnapshot,
      rules: {
        ...claim.decision.policySnapshot.rules,
        marketplaceCommissionBps: 1_600,
      },
    },
  };
  assert.notEqual(refundPlanFingerprint(changedPolicyPlan), refundPlanFingerprint(claim.decision));
  assert.ok(validateRefundPlan(changedPolicyPlan, order, policies[0]).some((entry) => entry.code === "policy_mismatch" || entry.code === "plan_semantics_mismatch"));
});

test("rejects a self-consistent plan built from tampered policy rules", () => {
  const claim = getClaimById("RET-260903-031");
  const order = getOrderById("MM-18472");
  assert.ok(claim?.decision && order);
  const shipping = order.shippingPaise;
  const tampered = {
    ...claim.decision,
    policySnapshot: {
      ...claim.decision.policySnapshot,
      rules: { ...claim.decision.policySnapshot.rules, refundOutboundShippingOnPartialReturn: true },
    },
    shippingRefundPaise: shipping,
    customerRefundPaise: claim.decision.customerRefundPaise + shipping,
    marketplaceFundedPaise: claim.decision.marketplaceFundedPaise + shipping,
  };
  const issues = validateRefundPlan(tampered, order, policies[0]);
  assert.ok(issues.some((entry) => entry.code === "policy_mismatch"));
});

test("rejects a reconciled-looking plan when required seller reversals are removed", () => {
  const claim = getClaimById("RET-260903-031");
  const order = getOrderById("MM-18472");
  assert.ok(claim?.decision && order);

  const tampered = {
    ...claim.decision,
    sellerReversals: [],
    sellerFundedPaise: 0,
    marketplaceFundedPaise: claim.decision.customerRefundPaise,
  };
  const issues = validateRefundPlan(tampered, order, policies[0]);
  assert.ok(issues.some((entry) => entry.code === "plan_semantics_mismatch" && entry.message.includes("missing the required seller reversal")));
});

test("rejects substituting marketplace funding for a seller-liable policy outcome", () => {
  const claim = getClaimById("RET-260903-031");
  const order = getOrderById("MM-18472");
  assert.ok(claim?.decision && order);

  const tampered = {
    ...claim.decision,
    decisionBasis: { ...claim.decision.decisionBasis, liability: "marketplace" as const },
    sellerReversals: [],
    sellerFundedPaise: 0,
    marketplaceFundedPaise: claim.decision.customerRefundPaise,
  };
  const issues = validateRefundPlan(tampered, order, policies[0]);
  assert.ok(issues.some((entry) => entry.code === "plan_semantics_mismatch" && entry.message.includes("shifts a seller-liable reason")));
});

test("rejects substituted line identities and quantities even when totals still reconcile", () => {
  const claim = getClaimById("RET-260903-031");
  const order = getOrderById("MM-18472");
  assert.ok(claim?.decision && order);

  const substitutedLinePlan = {
    ...claim.decision,
    lineAllocations: claim.decision.lineAllocations.map((line) => ({
      ...line,
      orderLineId: "line_not_on_order",
      sellerId: "seller_wrong",
      transferId: "transfer_wrong",
      quantity: 999,
    })),
  };
  assert.ok(validateRefundPlan(substitutedLinePlan, order, policies[0]).some((entry) => entry.code === "plan_semantics_mismatch"));

  const changedDecisionQuantity = {
    ...claim.decision,
    decisionBasis: {
      ...claim.decision.decisionBasis,
      returnedItems: claim.decision.decisionBasis.returnedItems.map((item) => ({ ...item, quantity: 2 })),
    },
  };
  assert.ok(validateRefundPlan(changedDecisionQuantity, order, policies[0]).some((entry) => entry.code === "invalid_quantity"));
});

test("blocks an order whose shared transfer crosses seller ownership", () => {
  const claim = getClaimById("RET-260903-031");
  const order = getOrderById("MM-18472");
  assert.ok(claim && order);
  const invalidOrder = {
    ...order,
    lines: order.lines.map((line, index) => index === 1 ? { ...line, transferId: order.lines[0].transferId } : line),
  };
  const result = calculateRefundPlan({ claim, order: invalidOrder, policy: policies[0], sellers });
  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((entry) => entry.code === "transfer_not_found" && entry.message.includes("different sellers")));
});

test("ambiguous item matching abstains before calculating money", () => {
  const claim = getClaimById("RET-260903-033");
  const order = getOrderById("MM-18489");
  assert.ok(claim && order);
  const result = calculateRefundPlan({ claim, order, policy: policies[0], sellers });
  assert.equal(result.status, "needs_review");
  assert.ok(result.issues.some((entry) => entry.code === "ambiguous_item"));
  assert.ok(!("plan" in result));
});

test("unresolved courier versus seller liability abstains", () => {
  const claim = getClaimById("RET-260903-035");
  const order = getOrderById("MM-18501");
  assert.ok(claim && order);
  const result = calculateRefundPlan({ claim, order, policy: policies[0], sellers });
  assert.equal(result.status, "needs_review");
  assert.ok(result.issues.some((entry) => entry.code === "liability_unresolved"));
});

test("prior reversal makes an otherwise valid plan blocked", () => {
  const claim = getClaimById("RET-260903-038");
  const order = getOrderById("MM-18518");
  assert.ok(claim && order);
  const result = calculateRefundPlan({ claim, order, policy: policies[0], sellers });
  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((entry) => entry.code === "reversal_exceeds_remaining"));
  assert.equal(result.status === "blocked" ? result.plan?.customerRefundPaise : undefined, 99_900);
});

test("every ready seeded decision is exactly reconciled", () => {
  for (const claim of claims.filter((entry) => entry.status === "ready_for_approval")) {
    assert.ok(claim.decision);
    assert.equal(
      claim.decision.sellerFundedPaise + claim.decision.marketplaceFundedPaise,
      claim.decision.customerRefundPaise,
    );
    assert.ok(claim.decision.sellerReversals.every((entry) => entry.amountPaise <= entry.remainingReversiblePaise));
  }
});

test("aggregates duplicate reversal rows before enforcing the transfer cap", () => {
  const claim = getClaimById("RET-260903-031");
  const order = getOrderById("MM-18472");
  assert.ok(claim?.decision && order);
  const base = claim.decision.sellerReversals[0];
  const tampered = {
    ...claim.decision,
    sellerReversals: [
      { ...base, amountPaise: 120_000 },
      { ...base, amountPaise: 100_000 },
    ],
    sellerFundedPaise: 220_000,
    marketplaceFundedPaise: 12_854,
  };
  const issues = validateRefundPlan(tampered, order, policies[0]);
  assert.ok(issues.some((entry) => entry.code === "reversal_exceeds_remaining"));
});
