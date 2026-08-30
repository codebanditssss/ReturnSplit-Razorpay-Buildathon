import { createHash } from "node:crypto";

import {
  assertForecastHistory,
  buildSeasonalFallback,
  isForecastHorizon,
  type ForecastHistoryPoint,
  type ForecastHorizon,
  type ForecastResponse,
} from "../features/risk/forecast";

const DEFAULT_HORIZONS = [7, 14, 30] as const;
const DEFAULT_MIN_TRAINING_POINTS = 14;
const DEFAULT_ORIGIN_STRIDE = 1;
const BIGINT_ZERO = BigInt(0);
const BIGINT_TWO = BigInt(2);
const BIGINT_TEN = BigInt(10);
const BIGINT_THIRTY = BigInt(30);
const DECIMAL_SCALE = BigInt(1_000_000);

export type ForecastDatasetKind =
  | "synthetic_demo"
  | "user_supplied_aggregate";

export type CandidateRequestState =
  | "timesfm_endpoint_configured"
  | "timesfm_endpoint_not_configured"
  | "timesfm_endpoint_rejected";

export type CandidateSource = ForecastResponse["source"];

export interface CandidateForecastRequest {
  history: ReadonlyArray<ForecastHistoryPoint>;
  horizon: ForecastHorizon;
  isIllustrative: boolean;
}

export type CandidateForecaster = (
  request: CandidateForecastRequest,
) => Promise<ForecastResponse>;

export interface ForecastBacktestOptions {
  history: ReadonlyArray<ForecastHistoryPoint>;
  datasetLabel: string;
  datasetKind: ForecastDatasetKind;
  evaluatedAt: string;
  candidateRequestState: CandidateRequestState;
  candidateForecast: CandidateForecaster;
  horizons?: ReadonlyArray<ForecastHorizon>;
  minTrainingPoints?: number;
  originStride?: number;
  /** `null` evaluates every eligible origin. */
  maxOriginsPerHorizon?: number | null;
}

export interface ForecastSample {
  actualPaise: number;
  p50Paise: number;
  p10Paise?: number;
  p90Paise?: number;
}

export interface IntervalCoverageMetrics {
  nominalCoverage: 0.8;
  coveredObservations: number;
  observations: number;
  coverage: number;
}

export interface PinballLossMetrics {
  p10Paise: number;
  p50Paise: number;
  p90Paise: number;
  meanPaise: number;
}

export interface ForecastMetrics {
  observations: number;
  /** Exact raw totals are strings so values remain lossless in JSON. */
  totalActualPaise: string;
  totalAbsoluteErrorPaise: string;
  maePaise: number;
  wape: number;
  intervalCoverage: IntervalCoverageMetrics | null;
  pinballLoss: PinballLossMetrics | null;
}

export interface BaselineDelta {
  /** Negative values mean the candidate had lower error. */
  maePaise: number;
  /** Negative values mean the candidate had lower error. */
  wape: number;
}

export interface ForecastOriginRecord {
  trainingPoints: number;
  cutoffDate: string;
  targetStartDate: string;
  targetEndDate: string;
  candidateSource: CandidateSource;
  evaluatorCaughtFailure: boolean;
}

export interface ForecastHorizonResult {
  horizonDays: ForecastHorizon;
  availableOrigins: number;
  evaluatedOrigins: number;
  candidateSourceCounts: Record<CandidateSource, number>;
  evaluatorCaughtFailures: number;
  origins: ForecastOriginRecord[];
  candidate: ForecastMetrics;
  seasonalNaive: ForecastMetrics;
  lastValue: ForecastMetrics;
  candidateDelta: {
    versusSeasonalNaive: BaselineDelta;
    versusLastValue: BaselineDelta;
  };
}

export type CandidateOutcome =
  | "timesfm_only"
  | "mixed_timesfm_and_fallback"
  | "fallback_only";

export type ForecastEvidenceStatus =
  | "timesfm_not_measured"
  | "incomplete_timesfm_backtest"
  | "illustrative_backtest"
  | "historical_backtest_only";

export interface ForecastBacktestReport {
  schemaVersion: "1.0";
  kind: "rolling_origin_forecast_backtest";
  evaluatedAt: string;
  dataset: {
    label: string;
    kind: ForecastDatasetKind;
    points: number;
    startDate: string;
    endDate: string;
    sha256: string;
  };
  protocol: {
    horizonsDays: ForecastHorizon[];
    minTrainingPoints: number;
    originStrideDays: number;
    maxOriginsPerHorizon: number | "all";
    targetWindowsOverlap: boolean;
  };
  candidate: {
    requestedModel: "google/timesfm-2.5-200m-pytorch";
    requestState: CandidateRequestState;
    outcome: CandidateOutcome;
    timesFmOrigins: number;
    fallbackOrigins: number;
    evaluatorCaughtFailures: number;
    modelLabels: string[];
  };
  results: ForecastHorizonResult[];
  releaseGate: {
    status: "not_approved_for_production";
    evidenceStatus: ForecastEvidenceStatus;
    reason: string;
  };
  limitations: string[];
}

interface PointForecast {
  date: string;
  p50Paise: number;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

function assertIsoTimestamp(value: string, label: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
}

function addUtcDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function divideBigInts(
  numerator: bigint,
  denominator: bigint,
  scale = DECIMAL_SCALE,
): number {
  if (denominator <= BIGINT_ZERO) {
    throw new Error("Metric denominator must be positive");
  }
  const rounded =
    (numerator * scale + denominator / BIGINT_TWO) / denominator;
  return Number(rounded) / Number(scale);
}

function safeIntegerPaise(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be non-negative integer paise`);
  }
}

function absoluteDifference(left: number, right: number): bigint {
  const delta = BigInt(left) - BigInt(right);
  return delta < BIGINT_ZERO ? -delta : delta;
}

function pinballLossDeciPaise(
  actualPaise: number,
  predictionPaise: number,
  quantileTenths: 1 | 5 | 9,
): bigint {
  const difference = absoluteDifference(actualPaise, predictionPaise);
  const weight = actualPaise >= predictionPaise
    ? quantileTenths
    : 10 - quantileTenths;
  return difference * BigInt(weight);
}

/**
 * Scores point predictions and, when both p10 and p90 are present, their
 * nominal 80% interval. Exact paise totals use BigInt internally.
 */
export function calculateForecastMetrics(
  samples: ReadonlyArray<ForecastSample>,
): ForecastMetrics {
  if (samples.length === 0) {
    throw new Error("At least one forecast sample is required");
  }

  const intervalFlags = samples.map(
    (sample) => sample.p10Paise !== undefined || sample.p90Paise !== undefined,
  );
  const hasIntervals = intervalFlags.every(Boolean);
  if (!hasIntervals && intervalFlags.some(Boolean)) {
    throw new Error("Prediction intervals must be present for every sample or none");
  }

  let totalActualPaise = BIGINT_ZERO;
  let totalAbsoluteErrorPaise = BIGINT_ZERO;
  let coveredObservations = 0;
  let p10LossDeciPaise = BIGINT_ZERO;
  let p50LossDeciPaise = BIGINT_ZERO;
  let p90LossDeciPaise = BIGINT_ZERO;

  for (const sample of samples) {
    safeIntegerPaise(sample.actualPaise, "actualPaise");
    safeIntegerPaise(sample.p50Paise, "p50Paise");
    totalActualPaise += BigInt(sample.actualPaise);
    totalAbsoluteErrorPaise += absoluteDifference(
      sample.actualPaise,
      sample.p50Paise,
    );

    if (hasIntervals) {
      const p10Paise = sample.p10Paise as number;
      const p90Paise = sample.p90Paise as number;
      safeIntegerPaise(p10Paise, "p10Paise");
      safeIntegerPaise(p90Paise, "p90Paise");
      if (p10Paise > sample.p50Paise || sample.p50Paise > p90Paise) {
        throw new Error("Forecast quantiles must be ordered p10 <= p50 <= p90");
      }
      if (sample.actualPaise >= p10Paise && sample.actualPaise <= p90Paise) {
        coveredObservations += 1;
      }
      p10LossDeciPaise += pinballLossDeciPaise(
        sample.actualPaise,
        p10Paise,
        1,
      );
      p50LossDeciPaise += pinballLossDeciPaise(
        sample.actualPaise,
        sample.p50Paise,
        5,
      );
      p90LossDeciPaise += pinballLossDeciPaise(
        sample.actualPaise,
        p90Paise,
        9,
      );
    }
  }

  if (totalActualPaise === BIGINT_ZERO) {
    throw new Error("WAPE is undefined when all actual values are zero");
  }

  const observations = BigInt(samples.length);
  const intervalCoverage = hasIntervals
    ? {
        nominalCoverage: 0.8 as const,
        coveredObservations,
        observations: samples.length,
        coverage: divideBigInts(
          BigInt(coveredObservations),
          observations,
        ),
      }
    : null;
  const pinballLoss = hasIntervals
    ? {
        p10Paise: divideBigInts(
          p10LossDeciPaise,
          observations * BIGINT_TEN,
        ),
        p50Paise: divideBigInts(
          p50LossDeciPaise,
          observations * BIGINT_TEN,
        ),
        p90Paise: divideBigInts(
          p90LossDeciPaise,
          observations * BIGINT_TEN,
        ),
        meanPaise: divideBigInts(
          p10LossDeciPaise + p50LossDeciPaise + p90LossDeciPaise,
          observations * BIGINT_THIRTY,
        ),
      }
    : null;

  return {
    observations: samples.length,
    totalActualPaise: totalActualPaise.toString(),
    totalAbsoluteErrorPaise: totalAbsoluteErrorPaise.toString(),
    maePaise: divideBigInts(totalAbsoluteErrorPaise, observations),
    wape: divideBigInts(totalAbsoluteErrorPaise, totalActualPaise),
    intervalCoverage,
    pinballLoss,
  };
}

function makeForecastDates(
  history: ReadonlyArray<ForecastHistoryPoint>,
  horizon: ForecastHorizon,
): string[] {
  const lastDate = history[history.length - 1].date;
  return Array.from({ length: horizon }, (_, index) =>
    addUtcDays(lastDate, index + 1),
  );
}

/** A strict daily seasonal-naive benchmark: repeat the last observed week. */
export function buildSeasonalNaiveForecast(
  history: ReadonlyArray<ForecastHistoryPoint>,
  horizon: ForecastHorizon,
): PointForecast[] {
  if (history.length < 7) {
    throw new Error("Seasonal-naive forecasting requires at least seven days");
  }
  const dates = makeForecastDates(history, horizon);
  const seasonalWeek = history.slice(-7);
  return dates.map((date, index) => ({
    date,
    p50Paise: seasonalWeek[index % seasonalWeek.length].valuePaise,
  }));
}

/** A last-observation-carried-forward benchmark. */
export function buildLastValueForecast(
  history: ReadonlyArray<ForecastHistoryPoint>,
  horizon: ForecastHorizon,
): PointForecast[] {
  const dates = makeForecastDates(history, horizon);
  const lastValuePaise = history[history.length - 1].valuePaise;
  return dates.map((date) => ({ date, p50Paise: lastValuePaise }));
}

function validateCandidateForecast(
  response: ForecastResponse,
  history: ReadonlyArray<ForecastHistoryPoint>,
  horizon: ForecastHorizon,
): void {
  if (
    response.source !== "google_timesfm_2_5" &&
    response.source !== "deterministic_seasonal_fallback"
  ) {
    throw new Error("Candidate response has an unknown source");
  }
  if (typeof response.modelLabel !== "string" || response.modelLabel.length === 0) {
    throw new Error("Candidate response has no model label");
  }
  if (!Array.isArray(response.forecast) || response.forecast.length !== horizon) {
    throw new Error("Candidate response has the wrong horizon");
  }

  const expectedDates = makeForecastDates(history, horizon);
  response.forecast.forEach((point, index) => {
    if (point.date !== expectedDates[index]) {
      throw new Error("Candidate response dates do not match the target window");
    }
    safeIntegerPaise(point.p10Paise, "candidate p10Paise");
    safeIntegerPaise(point.p50Paise, "candidate p50Paise");
    safeIntegerPaise(point.p90Paise, "candidate p90Paise");
    if (point.p10Paise > point.p50Paise || point.p50Paise > point.p90Paise) {
      throw new Error("Candidate response quantiles cross");
    }
  });
}

function availableTrainingLengths(
  seriesLength: number,
  horizon: ForecastHorizon,
  minTrainingPoints: number,
  originStride: number,
): number[] {
  const latestTrainingLength = seriesLength - horizon;
  const descending: number[] = [];
  for (
    let trainingLength = latestTrainingLength;
    trainingLength >= minTrainingPoints;
    trainingLength -= originStride
  ) {
    descending.push(trainingLength);
  }
  return descending.reverse();
}

function selectTrainingLengths(
  available: ReadonlyArray<number>,
  maxOriginsPerHorizon: number | null,
): number[] {
  if (maxOriginsPerHorizon === null) return [...available];
  return available.slice(-maxOriginsPerHorizon);
}

function fingerprintHistory(
  history: ReadonlyArray<ForecastHistoryPoint>,
): string {
  const canonical = history
    .map((point) => `${point.date}:${point.valuePaise}`)
    .join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function roundedDifference(left: number, right: number): number {
  return Math.round((left - right) * 1_000_000) / 1_000_000;
}

function evidenceStatus(
  outcome: CandidateOutcome,
  datasetKind: ForecastDatasetKind,
): ForecastEvidenceStatus {
  if (outcome === "fallback_only") return "timesfm_not_measured";
  if (outcome === "mixed_timesfm_and_fallback") {
    return "incomplete_timesfm_backtest";
  }
  return datasetKind === "synthetic_demo"
    ? "illustrative_backtest"
    : "historical_backtest_only";
}

function gateReason(status: ForecastEvidenceStatus): string {
  if (status === "timesfm_not_measured") {
    return "No evaluated origin used TimesFM output; candidate metrics describe the labeled deterministic fallback.";
  }
  if (status === "incomplete_timesfm_backtest") {
    return "Some evaluated origins used the deterministic fallback, so the aggregate cannot be attributed to TimesFM.";
  }
  if (status === "illustrative_backtest") {
    return "All candidate origins used TimesFM, but the bundled series is synthetic and cannot establish production accuracy.";
  }
  return "This is a historical backtest on supplied aggregates; production approval still requires representative held-out data, calibration, and operational review.";
}

function buildLimitations(
  datasetKind: ForecastDatasetKind,
  outcome: CandidateOutcome,
  targetWindowsOverlap: boolean,
): string[] {
  const limitations = [
    "Metrics describe aggregate daily refund outflow only; they do not validate claim eligibility, seller liability, or money movement.",
    "The nominal p10-p90 interval is scored for empirical coverage and pinball loss but is not declared calibrated.",
    "The point baselines do not emit prediction intervals, so coverage and pinball loss are null for those baselines.",
  ];
  if (datasetKind === "synthetic_demo") {
    limitations.push(
      "The bundled Creo Market series is synthetic; its metrics are engineering checks, not model-accuracy evidence.",
    );
  } else {
    limitations.push(
      "The evaluator cannot verify the supplied series' provenance, representativeness, missing-event handling, or leakage controls.",
    );
  }
  if (outcome !== "timesfm_only") {
    limitations.push(
      "At least one candidate origin used the deterministic fallback; do not label aggregate candidate metrics as TimesFM accuracy.",
    );
  }
  if (targetWindowsOverlap) {
    limitations.push(
      "Rolling target windows overlap at the configured stride, so observations are correlated and no confidence interval is claimed.",
    );
  }
  return limitations;
}

/**
 * Runs a leakage-safe rolling-origin backtest. Every provider call receives
 * only observations available at that origin, and calls are deliberately
 * sequential because the TimesFM sidecar serializes inference.
 */
export async function evaluateForecastBacktest({
  history,
  datasetLabel,
  datasetKind,
  evaluatedAt,
  candidateRequestState,
  candidateForecast,
  horizons = DEFAULT_HORIZONS,
  minTrainingPoints = DEFAULT_MIN_TRAINING_POINTS,
  originStride = DEFAULT_ORIGIN_STRIDE,
  maxOriginsPerHorizon = 5,
}: ForecastBacktestOptions): Promise<ForecastBacktestReport> {
  assertForecastHistory(history);
  if (datasetLabel.trim().length === 0 || datasetLabel.length > 160) {
    throw new Error("Dataset label must contain between 1 and 160 characters");
  }
  assertIsoTimestamp(evaluatedAt, "evaluatedAt");
  assertPositiveInteger(minTrainingPoints, "minTrainingPoints");
  assertPositiveInteger(originStride, "originStride");
  if (minTrainingPoints < 14) {
    throw new Error("minTrainingPoints cannot be below 14");
  }
  if (maxOriginsPerHorizon !== null) {
    assertPositiveInteger(maxOriginsPerHorizon, "maxOriginsPerHorizon");
  }
  if (horizons.length === 0 || new Set(horizons).size !== horizons.length) {
    throw new Error("Forecast horizons must be non-empty and unique");
  }
  for (const horizon of horizons) {
    if (!isForecastHorizon(horizon)) {
      throw new Error("Forecast horizons must be 7, 14, or 30 days");
    }
    if (history.length < minTrainingPoints + horizon) {
      throw new Error(
        `History needs at least ${minTrainingPoints + horizon} points for a ${horizon}-day backtest`,
      );
    }
  }

  const modelLabels = new Set<string>();
  const results: ForecastHorizonResult[] = [];

  for (const horizon of horizons) {
    const available = availableTrainingLengths(
      history.length,
      horizon,
      minTrainingPoints,
      originStride,
    );
    const trainingLengths = selectTrainingLengths(
      available,
      maxOriginsPerHorizon,
    );
    const candidateSamples: ForecastSample[] = [];
    const seasonalNaiveSamples: ForecastSample[] = [];
    const lastValueSamples: ForecastSample[] = [];
    const origins: ForecastOriginRecord[] = [];
    const candidateSourceCounts: Record<CandidateSource, number> = {
      google_timesfm_2_5: 0,
      deterministic_seasonal_fallback: 0,
    };
    let evaluatorCaughtFailures = 0;

    for (const trainingLength of trainingLengths) {
      const trainingHistory = history.slice(0, trainingLength);
      const target = history.slice(trainingLength, trainingLength + horizon);
      let candidateResponse: ForecastResponse;
      let evaluatorCaughtFailure = false;

      try {
        candidateResponse = await candidateForecast({
          history: trainingHistory,
          horizon,
          isIllustrative: datasetKind === "synthetic_demo",
        });
        validateCandidateForecast(candidateResponse, trainingHistory, horizon);
      } catch {
        evaluatorCaughtFailure = true;
        evaluatorCaughtFailures += 1;
        candidateResponse = buildSeasonalFallback({
          history: trainingHistory,
          horizon,
          generatedAt: `${trainingHistory[trainingHistory.length - 1].date}T00:00:00.000Z`,
          isIllustrative: datasetKind === "synthetic_demo",
          notice:
            "The configured candidate failed during evaluation. This origin uses the deterministic weekday fallback and is not a TimesFM measurement.",
        });
      }

      candidateSourceCounts[candidateResponse.source] += 1;
      modelLabels.add(candidateResponse.modelLabel);
      const seasonalNaive = buildSeasonalNaiveForecast(
        trainingHistory,
        horizon,
      );
      const lastValue = buildLastValueForecast(trainingHistory, horizon);

      target.forEach((actual, index) => {
        const candidate = candidateResponse.forecast[index];
        candidateSamples.push({
          actualPaise: actual.valuePaise,
          p10Paise: candidate.p10Paise,
          p50Paise: candidate.p50Paise,
          p90Paise: candidate.p90Paise,
        });
        seasonalNaiveSamples.push({
          actualPaise: actual.valuePaise,
          p50Paise: seasonalNaive[index].p50Paise,
        });
        lastValueSamples.push({
          actualPaise: actual.valuePaise,
          p50Paise: lastValue[index].p50Paise,
        });
      });

      origins.push({
        trainingPoints: trainingLength,
        cutoffDate: trainingHistory[trainingHistory.length - 1].date,
        targetStartDate: target[0].date,
        targetEndDate: target[target.length - 1].date,
        candidateSource: candidateResponse.source,
        evaluatorCaughtFailure,
      });
    }

    const candidate = calculateForecastMetrics(candidateSamples);
    const seasonalNaive = calculateForecastMetrics(seasonalNaiveSamples);
    const lastValue = calculateForecastMetrics(lastValueSamples);
    results.push({
      horizonDays: horizon,
      availableOrigins: available.length,
      evaluatedOrigins: trainingLengths.length,
      candidateSourceCounts,
      evaluatorCaughtFailures,
      origins,
      candidate,
      seasonalNaive,
      lastValue,
      candidateDelta: {
        versusSeasonalNaive: {
          maePaise: roundedDifference(candidate.maePaise, seasonalNaive.maePaise),
          wape: roundedDifference(candidate.wape, seasonalNaive.wape),
        },
        versusLastValue: {
          maePaise: roundedDifference(candidate.maePaise, lastValue.maePaise),
          wape: roundedDifference(candidate.wape, lastValue.wape),
        },
      },
    });
  }

  const timesFmOrigins = results.reduce(
    (sum, result) => sum + result.candidateSourceCounts.google_timesfm_2_5,
    0,
  );
  const fallbackOrigins = results.reduce(
    (sum, result) =>
      sum + result.candidateSourceCounts.deterministic_seasonal_fallback,
    0,
  );
  const evaluatorCaughtFailures = results.reduce(
    (sum, result) => sum + result.evaluatorCaughtFailures,
    0,
  );
  const outcome: CandidateOutcome = timesFmOrigins === 0
    ? "fallback_only"
    : fallbackOrigins === 0
      ? "timesfm_only"
      : "mixed_timesfm_and_fallback";
  const status = evidenceStatus(outcome, datasetKind);
  const targetWindowsOverlap = originStride < Math.max(...horizons);

  return {
    schemaVersion: "1.0",
    kind: "rolling_origin_forecast_backtest",
    evaluatedAt: new Date(evaluatedAt).toISOString(),
    dataset: {
      label: datasetLabel,
      kind: datasetKind,
      points: history.length,
      startDate: history[0].date,
      endDate: history[history.length - 1].date,
      sha256: fingerprintHistory(history),
    },
    protocol: {
      horizonsDays: [...horizons],
      minTrainingPoints,
      originStrideDays: originStride,
      maxOriginsPerHorizon: maxOriginsPerHorizon ?? "all",
      targetWindowsOverlap,
    },
    candidate: {
      requestedModel: "google/timesfm-2.5-200m-pytorch",
      requestState: candidateRequestState,
      outcome,
      timesFmOrigins,
      fallbackOrigins,
      evaluatorCaughtFailures,
      modelLabels: [...modelLabels].sort(),
    },
    results,
    releaseGate: {
      status: "not_approved_for_production",
      evidenceStatus: status,
      reason: gateReason(status),
    },
    limitations: buildLimitations(datasetKind, outcome, targetWindowsOverlap),
  };
}
