import {
  getRefundForecast,
} from "@/features/risk/timesfm-adapter";
import { isForecastHorizon } from "@/features/risk/forecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const rawHorizon = new URL(request.url).searchParams.get("horizon") ?? "14";
  const horizon = Number(rawHorizon);

  if (!Number.isInteger(horizon) || !isForecastHorizon(horizon)) {
    return Response.json(
      { error: "horizon must be 7, 14, or 30" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const forecast = await getRefundForecast({
    horizon,
    isIllustrative: true,
  });

  return Response.json(forecast, {
    headers: { "Cache-Control": "no-store" },
  });
}

