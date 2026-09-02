import { latestForecastBacktest } from "@/evaluation/forecast-backtest-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return new Response(`${JSON.stringify(latestForecastBacktest, null, 2)}\n`, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": 'attachment; filename="returnsplit-timesfm-backtest.json"',
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
