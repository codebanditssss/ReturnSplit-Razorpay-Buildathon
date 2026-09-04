import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLastValueForecast,
  buildSeasonalNaiveForecast,
  calculateForecastMetrics,
  evaluateForecastBacktest,
} from "../src/evaluation/forecast-backtest";
import {
  buildSeasonalFallback,
  type ForecastHistoryPoint,
} from "../src/features/risk/forecast";

const EVALUATED_AT = "2026-09-04T12:00:00.000Z";

function dailySeries(length: number): ForecastHistoryPoint[] {
  const firstDay = Date.UTC(2026, 0, 1);
  return Array.from({ length }, (_, index) => ({
    date: new Date(firstDay + index * 86_400_000).toISOString().slice(0, 10),
    valuePaise: 100_000 + index * 1_000,
  }));
}

function futureDate(lastDate: string, offset: number): string {
  const date = new Date(`${lastDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

test("calculates point, interval-coverage, and pinball metrics", () => {
  const metrics = calculateForecastMetrics([
    { actualPaise: 100, p10Paise: 80, p50Paise: 90, p90Paise: 120 },
    { actualPaise: 200, p10Paise: 160, p50Paise: 220, p90Paise: 230 },
  ]);

  assert.equal(metrics.totalActualPaise, "300");
  assert.equal(metrics.totalAbsoluteErrorPaise, "30");
  assert.equal(metrics.maePaise, 15);
  assert.equal(metrics.wape, 0.1);
  assert.deepEqual(metrics.intervalCoverage, {
    nominalCoverage: 0.8,
    coveredObservations: 2,
    observations: 2,
    coverage: 1,
  });
  assert.deepEqual(metrics.pinballLoss, {
    p10Paise: 3,
    p50Paise: 7.5,
    p90Paise: 2.5,
    meanPaise: 4.333333,
  });

  const pointOnly = calculateForecastMetrics([
    { actualPaise: 100, p50Paise: 90 },
  ]);
  assert.equal(pointOnly.intervalCoverage, null);
  assert.equal(pointOnly.pinballLoss, null);
});

test("uses only pre-origin history and evaluates 7, 14, and 30-day windows", async () => {
  const history = dailySeries(60);
  const receivedTrainingLengths: number[] = [];
  const report = await evaluateForecastBacktest({
    history,
    datasetLabel: "linear-synthetic-fixture",
    datasetKind: "synthetic_demo",
    evaluatedAt: EVALUATED_AT,
    candidateRequestState: "timesfm_endpoint_configured",
    maxOriginsPerHorizon: 2,
    candidateForecast: async ({ history: training, horizon }) => {
      receivedTrainingLengths.push(training.length);
      const last = training[training.length - 1];
      return {
        history: training.map((point) => ({ ...point })),
        forecast: Array.from({ length: horizon }, (_, index) => {
          const valuePaise = last.valuePaise + (index + 1) * 1_000;
          return {
            date: futureDate(last.date, index + 1),
            p10Paise: valuePaise,
            p50Paise: valuePaise,
            p90Paise: valuePaise,
          };
        }),
        source: "google_timesfm_2_5",
        modelLabel: "TimesFM test double",
        generatedAt: EVALUATED_AT,
        isIllustrative: true,
      };
    },
  });

  assert.deepEqual(receivedTrainingLengths, [52, 53, 45, 46, 29, 30]);
  assert.equal(report.candidate.outcome, "timesfm_only");
  assert.equal(report.candidate.timesFmOrigins, 6);
  assert.equal(report.releaseGate.status, "not_approved_for_production");
  assert.equal(report.releaseGate.evidenceStatus, "illustrative_backtest");
  assert.equal(report.results.length, 3);
  for (const result of report.results) {
    assert.equal(result.evaluatedOrigins, 2);
    assert.equal(result.candidate.observations, result.horizonDays * 2);
    assert.equal(result.candidate.maePaise, 0);
    assert.equal(result.candidate.wape, 0);
    assert.equal(result.candidate.intervalCoverage?.coverage, 1);
    assert.equal(result.candidate.pinballLoss?.meanPaise, 0);
    assert.equal(result.seasonalNaive.intervalCoverage, null);
    assert.equal(result.lastValue.pinballLoss, null);
  }
});

test("reports deterministic fallback origins without attributing them to TimesFM", async () => {
  const history = dailySeries(40);
  const report = await evaluateForecastBacktest({
    history,
    datasetLabel: "fallback-fixture",
    datasetKind: "user_supplied_aggregate",
    evaluatedAt: EVALUATED_AT,
    candidateRequestState: "timesfm_endpoint_not_configured",
    horizons: [7],
    maxOriginsPerHorizon: 2,
    candidateForecast: ({ history: training, horizon, isIllustrative }) =>
      Promise.resolve(
        buildSeasonalFallback({
          history: training,
          horizon,
          generatedAt: EVALUATED_AT,
          isIllustrative,
        }),
      ),
  });

  assert.equal(report.candidate.outcome, "fallback_only");
  assert.equal(report.candidate.timesFmOrigins, 0);
  assert.equal(report.candidate.fallbackOrigins, 2);
  assert.equal(report.releaseGate.evidenceStatus, "timesfm_not_measured");
  assert.match(report.releaseGate.reason, /No evaluated origin used TimesFM/);
  assert.equal(
    report.results[0].candidateSourceCounts.deterministic_seasonal_fallback,
    2,
  );
});

test("marks a partially available TimesFM run as incomplete evidence", async () => {
  const history = dailySeries(40);
  let call = 0;
  const report = await evaluateForecastBacktest({
    history,
    datasetLabel: "mixed-source-fixture",
    datasetKind: "user_supplied_aggregate",
    evaluatedAt: EVALUATED_AT,
    candidateRequestState: "timesfm_endpoint_configured",
    horizons: [7],
    maxOriginsPerHorizon: 2,
    candidateForecast: ({ history: training, horizon, isIllustrative }) => {
      call += 1;
      if (call === 2) {
        return Promise.resolve(
          buildSeasonalFallback({
            history: training,
            horizon,
            generatedAt: EVALUATED_AT,
            isIllustrative,
          }),
        );
      }
      const last = training[training.length - 1];
      return Promise.resolve({
        history: training.map((point) => ({ ...point })),
        forecast: Array.from({ length: horizon }, (_, index) => {
          const valuePaise = last.valuePaise + (index + 1) * 1_000;
          return {
            date: futureDate(last.date, index + 1),
            p10Paise: valuePaise,
            p50Paise: valuePaise,
            p90Paise: valuePaise,
          };
        }),
        source: "google_timesfm_2_5" as const,
        modelLabel: "TimesFM test double",
        generatedAt: EVALUATED_AT,
        isIllustrative,
      });
    },
  });

  assert.equal(report.candidate.outcome, "mixed_timesfm_and_fallback");
  assert.equal(report.candidate.timesFmOrigins, 1);
  assert.equal(report.candidate.fallbackOrigins, 1);
  assert.equal(
    report.releaseGate.evidenceStatus,
    "incomplete_timesfm_backtest",
  );
});

test("fails an invalid provider origin closed to a labeled evaluator fallback", async () => {
  const report = await evaluateForecastBacktest({
    history: dailySeries(40),
    datasetLabel: "provider-failure-fixture",
    datasetKind: "synthetic_demo",
    evaluatedAt: EVALUATED_AT,
    candidateRequestState: "timesfm_endpoint_configured",
    horizons: [7],
    maxOriginsPerHorizon: 1,
    candidateForecast: async () => {
      throw new Error("simulated provider failure");
    },
  });

  assert.equal(report.candidate.outcome, "fallback_only");
  assert.equal(report.candidate.evaluatorCaughtFailures, 1);
  assert.equal(report.results[0].origins[0].evaluatorCaughtFailure, true);
  assert.equal(
    report.results[0].origins[0].candidateSource,
    "deterministic_seasonal_fallback",
  );
});

test("builds strict seasonal-naive and last-value baselines", () => {
  const history = dailySeries(14);
  const seasonal = buildSeasonalNaiveForecast(history, 14);
  const lastValue = buildLastValueForecast(history, 7);

  assert.deepEqual(
    seasonal.slice(0, 8).map((point) => point.p50Paise),
    [...history.slice(-7).map((point) => point.valuePaise), history[7].valuePaise],
  );
  assert.deepEqual(
    lastValue.map((point) => point.p50Paise),
    Array.from({ length: 7 }, () => history[13].valuePaise),
  );
});
