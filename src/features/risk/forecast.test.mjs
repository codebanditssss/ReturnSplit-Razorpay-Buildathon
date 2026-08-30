import assert from "node:assert/strict"
import test from "node:test"

import {
  DEMO_REFUND_HISTORY,
  assertForecastHistory,
  buildFallbackForecast,
  buildSeasonalFallback,
} from "./forecast.ts"

test("the demo fallback is deterministic and returns the requested horizon", () => {
  const first = buildFallbackForecast(14)
  const second = buildFallbackForecast(14)

  assert.deepEqual(first, second)
  assert.equal(first.history.length, 56)
  assert.equal(first.forecast.length, 14)
  assert.equal(first.source, "deterministic_seasonal_fallback")
  assert.equal(first.isIllustrative, true)
})

test("fallback output stays in non-negative ordered integer paise", () => {
  const response = buildFallbackForecast(30)

  for (const point of response.forecast) {
    assert.equal(Number.isSafeInteger(point.p10Paise), true)
    assert.equal(Number.isSafeInteger(point.p50Paise), true)
    assert.equal(Number.isSafeInteger(point.p90Paise), true)
    assert.ok(point.p10Paise >= 0)
    assert.ok(point.p10Paise <= point.p50Paise)
    assert.ok(point.p50Paise <= point.p90Paise)
  }
})

test("history validation rejects zero paise and date gaps", () => {
  const zeroValue = DEMO_REFUND_HISTORY.map((point, index) => ({
    ...point,
    valuePaise: index === 0 ? 0 : point.valuePaise,
  }))
  assert.throws(() => assertForecastHistory(zeroValue), /positive integer paise/)

  const dateGap = DEMO_REFUND_HISTORY.map((point, index) => ({
    ...point,
    date: index === 10 ? "2026-08-30" : point.date,
  }))
  assert.throws(() => assertForecastHistory(dateGap), /unique, ascending, and daily/)
})

test("fallback rejects unsupported horizons at runtime", () => {
  assert.throws(
    () => buildSeasonalFallback({ history: DEMO_REFUND_HISTORY, horizon: 9, generatedAt: "2026-09-04T00:00:00.000Z", isIllustrative: true }),
    /7, 14, or 30/,
  )
})
