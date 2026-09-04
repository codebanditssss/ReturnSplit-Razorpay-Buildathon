import assert from "node:assert/strict";
import test from "node:test";

import { buildFallbackForecast } from "../src/features/risk/forecast";
import { assessRefundReserve, summarizeOpenRefundExposure } from "../src/features/risk/refund-reserve";
import { getClaimById } from "../src/lib/data";

test("reserve exposure counts executable recoveries and reserves blocked claims in full", () => {
  const ready = getClaimById("RET-260903-031");
  const blocked = getClaimById("RET-260903-038");
  const unpriced = getClaimById("RET-260903-033");
  assert.ok(ready?.decision && blocked?.decision && unpriced && !unpriced.decision);

  const exposure = summarizeOpenRefundExposure([ready, blocked, unpriced]);

  assert.equal(exposure.pricedClaimCount, 2);
  assert.equal(exposure.unpricedClaimCount, 1);
  assert.equal(exposure.blockedClaimCount, 1);
  assert.equal(
    exposure.customerRefundPaise,
    ready.decision.customerRefundPaise + blocked.decision.customerRefundPaise,
  );
  assert.equal(exposure.expectedSellerReversalPaise, ready.decision.sellerFundedPaise);
  assert.equal(exposure.marketplaceFundedCommitmentPaise, ready.decision.marketplaceFundedPaise);
  assert.equal(exposure.blockedAtRiskPaise, blocked.decision.customerRefundPaise);
  assert.equal(
    exposure.knownReserveCommitmentPaise,
    ready.decision.marketplaceFundedPaise + blocked.decision.customerRefundPaise,
  );
});

test("reserve exposure does not deduct reversals for terminal or provider-unknown execution", () => {
  const ready = getClaimById("RET-260903-031");
  assert.ok(ready?.decision);

  const terminal = {
    ...ready,
    status: "processing" as const,
    execution: {
      sagaId: "saga_terminal",
      state: "failed" as const,
      canResume: false,
      pendingOperation: "transfer_reversal" as const,
    },
  };
  const providerUnknown = {
    ...ready,
    status: "processing" as const,
    execution: {
      sagaId: "saga_unknown",
      state: "reversal_result_unknown" as const,
      requiresReconciliation: true,
      pendingOperation: "transfer_reversal" as const,
    },
  };

  const exposure = summarizeOpenRefundExposure([terminal, providerUnknown]);

  assert.equal(exposure.pricedClaimCount, 2);
  assert.equal(exposure.blockedClaimCount, 2);
  assert.equal(exposure.expectedSellerReversalPaise, 0);
  assert.equal(exposure.marketplaceFundedCommitmentPaise, 0);
  assert.equal(exposure.blockedAtRiskPaise, ready.decision.customerRefundPaise * 2);
  assert.equal(exposure.knownReserveCommitmentPaise, ready.decision.customerRefundPaise * 2);
});

test("reserve assessment adds the open commitment exactly once", () => {
  const forecast = buildFallbackForecast(7);
  const baseline = assessRefundReserve(forecast, Number.MAX_SAFE_INTEGER);
  const knownOpenCommitmentPaise = 12_345;
  const reservePaise = baseline.stressPlanPaise + knownOpenCommitmentPaise + 500;
  const assessment = assessRefundReserve(forecast, reservePaise, knownOpenCommitmentPaise);

  assert.equal(
    assessment.totalStressRequirementPaise,
    assessment.stressPlanPaise + knownOpenCommitmentPaise,
  );
  assert.equal(assessment.headroomPaise, 500);
  assert.equal(assessment.status, "covered");
});
