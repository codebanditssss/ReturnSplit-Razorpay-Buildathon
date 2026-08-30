export type ForecastHorizon = 7 | 14 | 30;

export interface ForecastHistoryPoint {
  date: string;
  valuePaise: number;
}

export interface ForecastPoint {
  date: string;
  p10Paise: number;
  p50Paise: number;
  p90Paise: number;
}

export interface ForecastResponse {
  history: ForecastHistoryPoint[];
  forecast: ForecastPoint[];
  source: "deterministic_seasonal_fallback" | "google_timesfm_2_5";
  modelLabel: string;
  generatedAt: string;
  isIllustrative: boolean;
  notice?: string;
}

const DEMO_HISTORY_START = "2026-07-10";
const DEMO_GENERATED_AT = "2026-09-04T00:00:00.000Z";

// Synthetic daily approved-refund totals for the Creo Market demo workspace.
// The series is generated from fixed weekday and cycle values; it is not a
// production observation and contains no customer data.
const WEEKDAY_BASE_PAISE = [
  2_485_000,
  1_635_000,
  1_720_000,
  1_785_000,
  1_910_000,
  2_145_000,
  2_760_000,
] as const;

const CYCLE_ADJUSTMENT_PAISE = [
  -84_000,
  31_000,
  126_000,
  -42_000,
  73_000,
  -19_000,
  158_000,
  54_000,
] as const;

function parseDateOnly(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Expected an ISO calendar date, received ${date}`);
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid ISO calendar date: ${date}`);
  }
  return parsed;
}

function addUtcDays(date: string, days: number): string {
  const parsed = parseDateOnly(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function weekday(date: string): number {
  return parseDateOnly(date).getUTCDay();
}

function makeDemoHistory(): ForecastHistoryPoint[] {
  return Array.from({ length: 56 }, (_, index) => {
    const date = addUtcDays(DEMO_HISTORY_START, index);
    const weekIndex = Math.floor(index / 7);
    const slowGrowthPaise = weekIndex * 18_000;
    const cycleAdjustmentPaise = CYCLE_ADJUSTMENT_PAISE[index % CYCLE_ADJUSTMENT_PAISE.length];

    return {
      date,
      valuePaise:
        WEEKDAY_BASE_PAISE[weekday(date)] +
        slowGrowthPaise +
        cycleAdjustmentPaise,
    };
  });
}

export const DEMO_REFUND_HISTORY: ReadonlyArray<ForecastHistoryPoint> =
  Object.freeze(makeDemoHistory().map((point) => Object.freeze(point)));

export function isForecastHorizon(value: number): value is ForecastHorizon {
  return value === 7 || value === 14 || value === 30;
}

export function assertForecastHistory(
  history: ReadonlyArray<ForecastHistoryPoint>,
): void {
  if (history.length < 14 || history.length > 512) {
    throw new Error("Forecast history must contain between 14 and 512 daily values");
  }

  let previousDate: string | undefined;
  for (const point of history) {
    parseDateOnly(point.date);
    if (!Number.isSafeInteger(point.valuePaise) || point.valuePaise <= 0) {
      throw new Error("Forecast history values must be positive integer paise");
    }

    if (previousDate && point.date !== addUtcDays(previousDate, 1)) {
      throw new Error("Forecast history dates must be unique, ascending, and daily");
    }
    previousDate = point.date;
  }
}

function roundedQuantile(values: ReadonlyArray<number>, quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];

  if (lowerIndex === upperIndex) return lower;
  return Math.round(lower + (upper - lower) * (position - lowerIndex));
}

interface SeasonalFallbackOptions {
  history: ReadonlyArray<ForecastHistoryPoint>;
  horizon: ForecastHorizon;
  generatedAt: string;
  isIllustrative: boolean;
  notice?: string;
}

/**
 * A deterministic weekday-seasonal baseline. It is a continuity fallback, not
 * TimesFM, and its empirical bands are not calibrated production intervals.
 */
export function buildSeasonalFallback({
  history,
  horizon,
  generatedAt,
  isIllustrative,
  notice =
    "Deterministic weekday baseline. Planning signal only; it is not a claim-level risk score or an authorization to move money.",
}: SeasonalFallbackOptions): ForecastResponse {
  if (!isForecastHorizon(horizon)) {
    throw new Error("Forecast horizon must be 7, 14, or 30 days");
  }
  assertForecastHistory(history);

  const lastDate = history[history.length - 1].date;
  const recentHistory = history.slice(-56);
  const forecast = Array.from({ length: horizon }, (_, index) => {
    const date = addUtcDays(lastDate, index + 1);
    const matchingWeekdays = recentHistory
      .filter((point) => weekday(point.date) === weekday(date))
      .map((point) => point.valuePaise);
    const comparisonValues = matchingWeekdays.length > 0
      ? matchingWeekdays
      : recentHistory.map((point) => point.valuePaise);

    const empiricalP10Paise = roundedQuantile(comparisonValues, 0.1);
    const p50Paise = roundedQuantile(comparisonValues, 0.5);
    const empiricalP90Paise = roundedQuantile(comparisonValues, 0.9);
    const uncertaintyMultiplier = 1 + index * 0.025;
    const p10Paise = Math.max(
      0,
      p50Paise -
        Math.round((p50Paise - empiricalP10Paise) * uncertaintyMultiplier),
    );
    const p90Paise = Math.max(
      p50Paise,
      p50Paise +
        Math.round((empiricalP90Paise - p50Paise) * uncertaintyMultiplier),
    );

    return { date, p10Paise, p50Paise, p90Paise };
  });

  return {
    history: history.map((point) => ({ ...point })),
    forecast,
    source: "deterministic_seasonal_fallback",
    modelLabel: "Deterministic weekday baseline · illustrative",
    generatedAt,
    isIllustrative,
    notice,
  };
}

export function buildFallbackForecast(
  horizon: 7 | 14 | 30,
): ForecastResponse {
  return buildSeasonalFallback({
    history: DEMO_REFUND_HISTORY,
    horizon,
    generatedAt: DEMO_GENERATED_AT,
    isIllustrative: true,
    notice:
      "Illustrative demo forecast from a deterministic weekday baseline. TimesFM is not configured or was unavailable; no production accuracy is claimed.",
  });
}
