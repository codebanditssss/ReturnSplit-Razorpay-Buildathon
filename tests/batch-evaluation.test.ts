import assert from "node:assert/strict";
import test from "node:test";
import { buildSyntheticBatch, evaluateSyntheticBatch } from "../src/evaluation/batch";

test("64-record synthetic engine replay reports every exception honestly", () => {
  const records = buildSyntheticBatch();
  const report = evaluateSyntheticBatch(records);
  assert.equal(report.records, 64);
  assert.ok(report.elapsedMs >= 0);
  assert.ok(report.recordsPerSecond === null || report.recordsPerSecond > 0);
  assert.ok(report.latencyMs.p50 !== null && report.latencyMs.p50 >= 0);
  assert.ok(report.latencyMs.p95 !== null && report.latencyMs.p95 >= report.latencyMs.p50);
  assert.equal(report.fixtureAssertionsPassed, 64);
  assert.equal(report.automatedRecords, 48);
  assert.equal(report.exceptionRecords, 16);
  assert.equal(report.unsafeAutomations, 0);
  assert.equal(report.wrongSellerPaise, 0);
  assert.equal(report.exceptions.length, 16);
});

test("batch timing reports deterministic wall-clock throughput and nearest-rank latency", () => {
  const records = buildSyntheticBatch().slice(0, 4);
  const timestamps = [100, 101, 103, 103, 107, 108, 114, 114, 122, 125];
  const report = evaluateSyntheticBatch(records, undefined, {
    now: () => {
      const timestamp = timestamps.shift();
      if (timestamp === undefined) {
        throw new Error("timing source was called more than expected");
      }
      return timestamp;
    },
  });

  assert.equal(timestamps.length, 0);
  assert.equal(report.elapsedMs, 25);
  assert.equal(report.recordsPerSecond, 160);
  assert.deepEqual(report.latencyMs, { p50: 4, p95: 8 });
});

test("wrong-seller overage is measured in paise", () => {
  const [record] = buildSyntheticBatch();
  const report = evaluateSyntheticBatch([record], () => ({
    disposition: "execute",
    customerRefundPaise: record.expected.customerRefundPaise,
    reversalVector: { wrong_seller: 12_345 },
  }));
  assert.equal(report.fixtureAssertionsPassed, 0);
  assert.equal(report.wrongSellerPaise, 12_345);
});

test("the replay executes the engine instead of copying expected output", () => {
  const [record] = buildSyntheticBatch();
  const transfer = record.input.order.transfers[0];
  const tampered = {
    ...record,
    input: {
      ...record.input,
      order: {
        ...record.input.order,
        transfers: record.input.order.transfers.map((entry) =>
          entry.id === transfer.id
            ? { ...entry, reversedAmountPaise: entry.originalAmountPaise }
            : entry,
        ),
      },
    },
  };
  const report = evaluateSyntheticBatch([tampered]);
  assert.equal(report.fixtureAssertionsPassed, 0);
  assert.equal(report.dispositionCounts.blocked, 1);
});
