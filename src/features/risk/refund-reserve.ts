import type { ForecastResponse } from "./forecast";
import type { Claim } from "@/lib/types";

export interface RefundForecastSummary {
  expectedPlanPaise: number;
  stressPlanPaise: number;
  uncertaintyBufferPaise: number;
  peakStressDay: {
    date: string;
    p90Paise: number;
  };
}

export type RefundReserveStatus = "covered" | "watch" | "shortfall";

export interface RefundReserveAssessment extends RefundForecastSummary {
  availableReservePaise: number;
  knownOpenCommitmentPaise: number;
  totalStressRequirementPaise: number;
  status: RefundReserveStatus;
  headroomPaise: number;
  note: string;
}

export interface OpenRefundExposure {
  pricedClaimCount: number;
  unpricedClaimCount: number;
  blockedClaimCount: number;
  customerRefundPaise: number;
  expectedSellerReversalPaise: number;
  marketplaceFundedCommitmentPaise: number;
  blockedAtRiskPaise: number;
  knownReserveCommitmentPaise: number;
}

function addPaise(total: number, value: number): number {
  const result = total + value;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("Forecast total exceeds safe integer paise");
  }
  return result;
}

/**
 * Sums daily planning values. `stressPlanPaise` is the sum of daily P90 values;
 * it must not be presented as a statistically calibrated aggregate P90.
 */
export function summarizeRefundForecast(
  response: ForecastResponse,
): RefundForecastSummary {
  if (response.forecast.length === 0) {
    throw new Error("A reserve assessment requires at least one forecast day");
  }

  let expectedPlanPaise = 0;
  let stressPlanPaise = 0;
  let peakStressDay = response.forecast[0];

  for (const point of response.forecast) {
    expectedPlanPaise = addPaise(expectedPlanPaise, point.p50Paise);
    stressPlanPaise = addPaise(stressPlanPaise, point.p90Paise);
    if (point.p90Paise > peakStressDay.p90Paise) peakStressDay = point;
  }

  return {
    expectedPlanPaise,
    stressPlanPaise,
    uncertaintyBufferPaise: stressPlanPaise - expectedPlanPaise,
    peakStressDay: {
      date: peakStressDay.date,
      p90Paise: peakStressDay.p90Paise,
    },
  };
}

/**
 * Operational liquidity guardrail only. It cannot approve, reject, price, or
 * reprioritize an individual return.
 */
export function assessRefundReserve(
  response: ForecastResponse,
  availableReservePaise: number,
  knownOpenCommitmentPaise = 0,
): RefundReserveAssessment {
  if (!Number.isSafeInteger(availableReservePaise) || availableReservePaise < 0) {
    throw new Error("Available reserve must be non-negative integer paise");
  }
  if (!Number.isSafeInteger(knownOpenCommitmentPaise) || knownOpenCommitmentPaise < 0) {
    throw new Error("Known open commitment must be non-negative integer paise");
  }

  const summary = summarizeRefundForecast(response);
  const totalStressRequirementPaise = addPaise(summary.stressPlanPaise, knownOpenCommitmentPaise);
  const status: RefundReserveStatus =
    availableReservePaise >= totalStressRequirementPaise
      ? "covered"
      : availableReservePaise >= addPaise(summary.expectedPlanPaise, knownOpenCommitmentPaise)
        ? "watch"
        : "shortfall";

  return {
    ...summary,
    availableReservePaise,
    knownOpenCommitmentPaise,
    totalStressRequirementPaise,
    status,
    headroomPaise: availableReservePaise - totalStressRequirementPaise,
    note:
      "Planning guardrail combines the current open commitment with forecasted new refund volume. Human approval and ReturnSplit's deterministic paise invariants still govern every money movement.",
  };
}

/**
 * Converts the current claim queue into a conservative reserve commitment.
 * Executable claims contribute their marketplace-funded portion after planned
 * seller reversals. Claims that are blocked, terminally failed, or waiting on
 * an unknown provider result contribute their full customer refund because
 * seller recovery is not currently dependable.
 */
export function summarizeOpenRefundExposure(
  claims: ReadonlyArray<Pick<Claim, "status" | "decision" | "execution">>,
): OpenRefundExposure {
  let pricedClaimCount = 0;
  let unpricedClaimCount = 0;
  let blockedClaimCount = 0;
  let customerRefundPaise = 0;
  let expectedSellerReversalPaise = 0;
  let marketplaceFundedCommitmentPaise = 0;
  let blockedAtRiskPaise = 0;

  for (const claim of claims) {
    if (claim.status === "completed") continue;
    if (!claim.decision) {
      unpricedClaimCount += 1;
      continue;
    }

    pricedClaimCount += 1;
    customerRefundPaise = addPaise(customerRefundPaise, claim.decision.customerRefundPaise);
    const executionIsUncertain = claim.execution?.requiresReconciliation === true
      || claim.execution?.state === "reversal_result_unknown"
      || claim.execution?.state === "refund_result_unknown";
    const executionIsTerminal = claim.execution?.state === "failed"
      && claim.execution.canResume !== true;
    if (claim.status === "blocked" || executionIsUncertain || executionIsTerminal) {
      blockedClaimCount += 1;
      blockedAtRiskPaise = addPaise(blockedAtRiskPaise, claim.decision.customerRefundPaise);
      continue;
    }
    expectedSellerReversalPaise = addPaise(expectedSellerReversalPaise, claim.decision.sellerFundedPaise);
    marketplaceFundedCommitmentPaise = addPaise(
      marketplaceFundedCommitmentPaise,
      claim.decision.marketplaceFundedPaise,
    );
  }

  return {
    pricedClaimCount,
    unpricedClaimCount,
    blockedClaimCount,
    customerRefundPaise,
    expectedSellerReversalPaise,
    marketplaceFundedCommitmentPaise,
    blockedAtRiskPaise,
    knownReserveCommitmentPaise: addPaise(marketplaceFundedCommitmentPaise, blockedAtRiskPaise),
  };
}
