import type { Metadata } from "next";
import { RiskForecast } from "@/components/risk-forecast";
import { summarizeOpenRefundExposure } from "@/features/risk";
import { getRefundForecast } from "@/features/risk/timesfm-adapter";
import { getDemoClaimsView } from "@/server/demo-runtime";

export const metadata: Metadata = { title: "Reserve control" };
export const dynamic = "force-dynamic";

export default async function RiskPage() {
  const configuredReserve = Number(process.env.REFUND_RESERVE_PAISE);
  const hasConfiguredReserve = Number.isSafeInteger(configuredReserve) && configuredReserve >= 0;
  const openExposure = summarizeOpenRefundExposure(await getDemoClaimsView());
  return <RiskForecast
    initial={await getRefundForecast({ horizon: 14, isIllustrative: true })}
    reservePaise={hasConfiguredReserve ? configuredReserve : 40_000_000}
    reserveSource={hasConfiguredReserve ? "REFUND_RESERVE_PAISE environment setting" : "Creo Market demo scenario default"}
    openExposure={openExposure}
  />;
}
