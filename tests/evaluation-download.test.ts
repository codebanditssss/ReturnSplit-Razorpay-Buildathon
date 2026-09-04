import assert from "node:assert/strict";
import test from "node:test";
import { GET as downloadBatchEvaluation } from "../src/app/api/evaluation/batch/route";
import { GET as downloadForecastEvaluation } from "../src/app/api/evaluation/forecast/route";

test("batch evidence download contains the full exception list and timing scope", async () => {
  const response = await downloadBatchEvaluation();
  const report = await response.json() as {
    records: number;
    elapsedMs: number;
    recordsPerSecond: number | null;
    latencyMs: { p50: number | null; p95: number | null };
    exceptionRecords: number;
    exceptions: unknown[];
  };

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="returnsplit-engine-evaluation.json"',
  );
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(report.records, 64);
  assert.equal(report.exceptions.length, report.exceptionRecords);
  assert.equal(report.exceptionRecords, 16);
  assert.ok(report.elapsedMs >= 0);
  assert.ok(report.recordsPerSecond === null || report.recordsPerSecond > 0);
  assert.ok(report.latencyMs.p50 !== null);
  assert.ok(report.latencyMs.p95 !== null);
});

test("forecast evidence download is a dated, explicitly non-production artifact", async () => {
  const response = await downloadForecastEvaluation();
  const report = await response.json() as {
    datasetKind: string;
    timesFmOrigins: number;
    fallbackOrigins: number;
    releaseStatus: string;
    horizons: unknown[];
  };

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="returnsplit-timesfm-backtest.json"',
  );
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(report.datasetKind, "synthetic_demo");
  assert.equal(report.timesFmOrigins, 15);
  assert.equal(report.fallbackOrigins, 0);
  assert.equal(report.releaseStatus, "not_approved_for_production");
  assert.equal(report.horizons.length, 3);
});
