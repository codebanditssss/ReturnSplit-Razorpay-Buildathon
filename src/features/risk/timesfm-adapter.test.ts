import assert from "node:assert/strict";
import test from "node:test";

import {
  TimesFmForecastAdapter,
  parseTimesFmEndpoint,
} from "./timesfm-adapter";

const GENERATED_AT = "2026-09-04T06:00:00.000Z";

function serviceForecast(horizon: 7 | 14 | 30) {
  const firstDate = Date.UTC(2026, 8, 4);
  return {
    modelId: "google/timesfm-2.5-200m-pytorch",
    generatedAt: GENERATED_AT,
    forecast: Array.from({ length: horizon }, (_, index) => ({
      date: new Date(firstDate + index * 86_400_000).toISOString().slice(0, 10),
      p10Paise: 1_000_000 + index,
      p50Paise: 1_250_000 + index,
      p90Paise: 1_500_000 + index,
    })),
  };
}

test("accepts a valid TimesFM response and sends the server credential", async () => {
  let requestBody: unknown;
  let authorization: string | null = null;
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(input.toString(), "https://forecast.internal.example/v1/forecast");
    assert.equal(init?.method, "POST");
    authorization = new Headers(init?.headers).get("Authorization");
    requestBody = JSON.parse(String(init?.body));
    return Response.json(serviceForecast(7));
  };
  const adapter = new TimesFmForecastAdapter({
    endpoint: new URL("https://forecast.internal.example/v1/forecast"),
    timeoutMs: 1_000,
    apiToken: "test-token",
    fetchImpl,
    now: () => new Date("2026-09-04T07:00:00.000Z"),
  });

  const result = await adapter.forecast({ horizon: 7, isIllustrative: true });

  assert.equal(result.source, "google_timesfm_2_5");
  assert.equal(result.generatedAt, GENERATED_AT);
  assert.equal(result.forecast.length, 7);
  assert.deepEqual(result.forecast[0], {
    date: "2026-09-04",
    p10Paise: 1_000_000,
    p50Paise: 1_250_000,
    p90Paise: 1_500_000,
  });
  assert.equal(authorization, "Bearer test-token");
  assert.equal((requestBody as { horizon: number }).horizon, 7);
});

test("falls back when the service payload is malformed or has crossed quantiles", async (context) => {
  const invalidPayloads = [
    {
      name: "missing p90",
      payload: {
        ...serviceForecast(7),
        forecast: serviceForecast(7).forecast.map((point, index) =>
          index === 0
            ? { date: point.date, p10Paise: point.p10Paise, p50Paise: point.p50Paise }
            : point,
        ),
      },
    },
    {
      name: "crossed quantiles",
      payload: {
        ...serviceForecast(7),
        forecast: serviceForecast(7).forecast.map((point, index) =>
          index === 0
            ? { ...point, p10Paise: 2_000_000, p50Paise: 1_250_000 }
            : point,
        ),
      },
    },
  ];

  for (const invalid of invalidPayloads) {
    await context.test(invalid.name, async () => {
      const adapter = new TimesFmForecastAdapter({
        endpoint: new URL("https://forecast.internal.example/v1/forecast"),
        timeoutMs: 1_000,
        fetchImpl: async () => Response.json(invalid.payload),
        now: () => new Date(GENERATED_AT),
      });

      const result = await adapter.forecast({ horizon: 7 });

      assert.equal(result.source, "deterministic_seasonal_fallback");
      assert.equal(result.generatedAt, GENERATED_AT);
      assert.match(result.notice ?? "", /invalid payload/);
    });
  }
});

test("aborts a slow service request and returns the labeled fallback", async () => {
  let aborted = false;
  const fetchImpl: typeof fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(new DOMException("The operation was aborted", "AbortError"));
        },
        { once: true },
      );
    });
  const adapter = new TimesFmForecastAdapter({
    endpoint: new URL("https://forecast.internal.example/v1/forecast"),
    timeoutMs: 500,
    fetchImpl,
    now: () => new Date(GENERATED_AT),
  });

  const result = await adapter.forecast({ horizon: 7 });

  assert.equal(aborted, true);
  assert.equal(result.source, "deterministic_seasonal_fallback");
  assert.match(result.notice ?? "", /timed out/);
});

test("allows HTTPS and loopback HTTP endpoints only", () => {
  assert.equal(
    parseTimesFmEndpoint("https://forecast.example/v1/forecast").protocol,
    "https:",
  );
  assert.equal(
    parseTimesFmEndpoint("http://localhost:8091/v1/forecast").hostname,
    "localhost",
  );
  assert.equal(
    parseTimesFmEndpoint("http://127.0.0.1:8091/v1/forecast").hostname,
    "127.0.0.1",
  );
  assert.equal(
    parseTimesFmEndpoint("http://[::1]:8091/v1/forecast").hostname,
    "[::1]",
  );

  assert.throws(
    () => parseTimesFmEndpoint("http://forecast.example/v1/forecast"),
    /must use HTTPS/,
  );
  assert.throws(
    () => parseTimesFmEndpoint("ftp://forecast.example/v1/forecast"),
    /must use HTTPS/,
  );
  assert.throws(
    () => parseTimesFmEndpoint("/v1/forecast"),
    /absolute URL/,
  );
  assert.throws(
    () => parseTimesFmEndpoint("https://user:secret@forecast.example/v1/forecast"),
    /must not contain credentials/,
  );
  assert.throws(
    () => parseTimesFmEndpoint("https://forecast.example/v1/forecast#secret"),
    /must not contain credentials or a fragment/,
  );
});
