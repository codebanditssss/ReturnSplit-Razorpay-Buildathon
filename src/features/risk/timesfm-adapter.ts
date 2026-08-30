import "server-only";

import {
  DEMO_REFUND_HISTORY,
  assertForecastHistory,
  buildSeasonalFallback,
  type ForecastHistoryPoint,
  type ForecastHorizon,
  type ForecastPoint,
  type ForecastResponse,
} from "./forecast";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 15_000;
const TIMESFM_MODEL_ID = "google/timesfm-2.5-200m-pytorch";

export interface ForecastRequest {
  horizon: ForecastHorizon;
  history?: ReadonlyArray<ForecastHistoryPoint>;
  isIllustrative?: boolean;
}

export interface ForecastProvider {
  forecast(request: ForecastRequest): Promise<ForecastResponse>;
}

export interface TimesFmAdapterOptions {
  endpoint: URL;
  timeoutMs: number;
  apiToken?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface TimesFmServiceResponse {
  modelId: string;
  generatedAt: string;
  forecast: ForecastPoint[];
}

class TimesFmResponseError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/** Accept encrypted endpoints, with plain HTTP allowed only for local dev. */
export function parseTimesFmEndpoint(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("TIMESFM_ENDPOINT must be an absolute URL");
  }

  const secure = endpoint.protocol === "https:";
  const localHttp = endpoint.protocol === "http:" && isLoopbackHost(endpoint.hostname);
  if (!secure && !localHttp) {
    throw new Error("TIMESFM_ENDPOINT must use HTTPS, except on localhost");
  }
  if (endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error("TIMESFM_ENDPOINT must not contain credentials or a fragment");
  }
  return endpoint;
}

function parseTimeout(value: string | undefined): number {
  if (!value) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 500 || parsed > MAX_TIMEOUT_MS) {
    return DEFAULT_TIMEOUT_MS;
  }
  return parsed;
}

function parseIntegerPaise(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TimesFmResponseError(`${label} must be non-negative integer paise`);
  }
  return value as number;
}

function expectedForecastDates(
  history: ReadonlyArray<ForecastHistoryPoint>,
  horizon: ForecastHorizon,
): string[] {
  const lastDate = history[history.length - 1].date;
  const lastTimestamp = new Date(`${lastDate}T00:00:00.000Z`).getTime();
  return Array.from({ length: horizon }, (_, index) =>
    new Date(lastTimestamp + (index + 1) * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );
}

function parseServiceResponse(
  body: unknown,
  history: ReadonlyArray<ForecastHistoryPoint>,
  horizon: ForecastHorizon,
): TimesFmServiceResponse {
  if (!isRecord(body) || body.modelId !== TIMESFM_MODEL_ID) {
    throw new TimesFmResponseError("Unexpected TimesFM service response");
  }
  if (
    typeof body.generatedAt !== "string" ||
    Number.isNaN(Date.parse(body.generatedAt))
  ) {
    throw new TimesFmResponseError("TimesFM response has an invalid timestamp");
  }
  if (!Array.isArray(body.forecast) || body.forecast.length !== horizon) {
    throw new TimesFmResponseError("TimesFM response has an invalid horizon");
  }

  const dates = expectedForecastDates(history, horizon);
  const forecast = body.forecast.map((candidate, index) => {
    if (!isRecord(candidate) || candidate.date !== dates[index]) {
      throw new TimesFmResponseError("TimesFM response dates are invalid");
    }

    const p10Paise = parseIntegerPaise(candidate.p10Paise, "p10Paise");
    const p50Paise = parseIntegerPaise(candidate.p50Paise, "p50Paise");
    const p90Paise = parseIntegerPaise(candidate.p90Paise, "p90Paise");
    if (p10Paise > p50Paise || p50Paise > p90Paise) {
      throw new TimesFmResponseError("TimesFM quantiles cross");
    }

    return { date: dates[index], p10Paise, p50Paise, p90Paise };
  });

  return {
    modelId: TIMESFM_MODEL_ID,
    generatedAt: body.generatedAt,
    forecast,
  };
}

export class TimesFmForecastAdapter implements ForecastProvider {
  private readonly endpoint: URL;
  private readonly timeoutMs: number;
  private readonly apiToken?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor({
    endpoint,
    timeoutMs,
    apiToken,
    fetchImpl = fetch,
    now = () => new Date(),
  }: TimesFmAdapterOptions) {
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 500 ||
      timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new Error(`TimesFM timeout must be between 500 and ${MAX_TIMEOUT_MS} ms`);
    }
    this.endpoint = parseTimesFmEndpoint(endpoint.toString());
    this.timeoutMs = timeoutMs;
    this.apiToken = apiToken;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  async forecast({
    horizon,
    history = DEMO_REFUND_HISTORY,
    isIllustrative = true,
  }: ForecastRequest): Promise<ForecastResponse> {
    assertForecastHistory(history);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (this.apiToken) headers.set("Authorization", `Bearer ${this.apiToken}`);

      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ history, horizon }),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new TimesFmResponseError(`TimesFM returned HTTP ${response.status}`);
      }

      const parsed = parseServiceResponse(await response.json(), history, horizon);
      return {
        history: history.map((point) => ({ ...point })),
        forecast: parsed.forecast,
        source: "google_timesfm_2_5",
        modelLabel: "Google TimesFM 2.5 200M · zero-shot",
        generatedAt: parsed.generatedAt,
        isIllustrative,
        notice:
          "Zero-shot aggregate refund forecast. It is not calibrated on ReturnSplit production outcomes and cannot authorize or change any claim decision.",
      };
    } catch {
      return buildSeasonalFallback({
        history,
        horizon,
        generatedAt: this.now().toISOString(),
        isIllustrative,
        notice:
          "TimesFM timed out, was unavailable, or returned an invalid payload. Showing the deterministic weekday fallback; no production accuracy is claimed.",
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createForecastProviderFromEnvironment(): ForecastProvider | null {
  const configuredEndpoint = process.env.TIMESFM_ENDPOINT?.trim();
  if (!configuredEndpoint) return null;

  try {
    return new TimesFmForecastAdapter({
      endpoint: parseTimesFmEndpoint(configuredEndpoint),
      timeoutMs: parseTimeout(process.env.TIMESFM_TIMEOUT_MS),
      apiToken: process.env.TIMESFM_API_TOKEN?.trim() || undefined,
    });
  } catch {
    return null;
  }
}

export async function getRefundForecast({
  horizon,
  history = DEMO_REFUND_HISTORY,
  isIllustrative = true,
}: ForecastRequest): Promise<ForecastResponse> {
  assertForecastHistory(history);
  const provider = createForecastProviderFromEnvironment();
  if (!provider) {
    return buildSeasonalFallback({
      history,
      horizon,
      generatedAt: new Date().toISOString(),
      isIllustrative,
      notice:
        "TimesFM is not configured or its endpoint was rejected. Showing the deterministic weekday fallback; no production accuracy is claimed.",
    });
  }
  return provider.forecast({ horizon, history, isIllustrative });
}
