"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { ForecastHorizon, ForecastResponse, OpenRefundExposure } from "@/features/risk";
import { assessRefundReserve } from "@/features/risk";
import { Icon } from "./icons";
import { Card, Money, PageHeader, StatusPill } from "./ui";

const chartWidth = 820;
const chartHeight = 270;
const inset = { top: 20, right: 18, bottom: 38, left: 58 };

export function RiskForecast({ initial, reservePaise, reserveSource, openExposure }: { initial: ForecastResponse; reservePaise: number; reserveSource: string; openExposure: OpenRefundExposure }) {
  const [data, setData] = useState(initial);
  const [horizon, setHorizon] = useState<ForecastHorizon>(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshMessage, setRefreshMessage] = useState("");
  const requestSequence = useRef(0);
  const requestedHorizon = useRef<ForecastHorizon | undefined>(undefined);
  const summary = assessRefundReserve(data, reservePaise, openExposure.knownReserveCommitmentPaise);
  const chart = useMemo(() => buildChart(data), [data]);
  const usesModelQuantiles = data.source === "google_timesfm_2_5";
  const lowBoundLabel = usesModelQuantiles ? "Lower estimate (P10)" : "Low planning bound";
  const highBoundLabel = usesModelQuantiles ? "Upper estimate (P90)" : "High planning bound";
  const historyThrough = data.history.at(-1)?.date;

  async function changeHorizon(next: ForecastHorizon) {
    if (next === horizon && requestedHorizon.current === undefined) return;
    requestedHorizon.current = next;
    setLoading(true);
    setError("");
    setRefreshMessage(`Loading the ${next}-day planning view.`);
    const sequence = ++requestSequence.current;
    try {
      const response = await fetch(`/api/forecasts/refunds?horizon=${next}`);
      if (!response.ok) throw new Error("Forecast request failed");
      const nextData = await response.json() as ForecastResponse;
      if (sequence === requestSequence.current) {
        setData(nextData);
        setHorizon(next);
        setRefreshMessage(`Showing the refreshed ${next}-day planning view.`);
      }
    } catch {
      if (sequence === requestSequence.current) {
        setError("The forecast could not be refreshed. The previous planning view is still shown.");
        setRefreshMessage("");
      }
    } finally {
      if (sequence === requestSequence.current) {
        requestedHorizon.current = undefined;
        setLoading(false);
      }
    }
  }

  return (
    <div className="page">
      <PageHeader title="Reserve control" description="Fund the open refund queue and upcoming demand before it becomes urgent." actions={<StatusPill tone="info">Planning only</StatusPill>} />

      <div className="callout info" style={{ marginBottom: 18 }}><Icon name="shield" /><div><strong>{data.isIllustrative ? "Illustrative Mora Market data" : "Workspace forecast"}</strong><p>{data.notice ?? "Forecasts support reserve planning only. Claim-level reversals remain deterministic and human-approved."}</p></div></div>
      <p className="sr-only" role="status" aria-atomic="true">{refreshMessage}</p>

      <section className="metric-strip" aria-label="Forecast overview">
        <div className="metric"><span className="metric-label">Available reserve</span><strong className="metric-value"><Money paise={summary.availableReservePaise} /></strong><span className="metric-note">{reserveSource}</span></div>
        <div className="metric"><span className="metric-label">Open commitment</span><strong className="metric-value"><Money paise={summary.knownOpenCommitmentPaise} /></strong><span className="metric-note">{openExposure.pricedClaimCount} priced claims · after dependable reversals</span></div>
        <div className="metric"><span className="metric-label">{horizon}-day stress requirement</span><strong className="metric-value"><Money paise={summary.totalStressRequirementPaise} /></strong><span className="metric-note">Open commitment + daily {usesModelQuantiles ? "upper estimates" : "high bounds"}</span></div>
        <div className="metric"><span className="metric-label">{summary.headroomPaise >= 0 ? "Reserve headroom" : "Reserve gap"}</span><strong className="metric-value"><Money paise={Math.abs(summary.headroomPaise)} sign={summary.headroomPaise >= 0} /></strong><span className={`metric-note ${summary.headroomPaise >= 0 ? "good" : ""}`}>Against {formatMoney(summary.availableReservePaise)} available reserve</span></div>
      </section>

      <div className="risk-layout">
        <Card className="forecast-card" title="Daily approved-refund exposure" description={`${data.isIllustrative ? "Synthetic history" : "Observed totals"} with forecast range; uncertainty widens with horizon.`} action={<div className="tabs" role="group" aria-label="Forecast horizon">{([7, 14, 30] as const).map((value) => <button key={value} className={`tab ${horizon === value ? "is-active" : ""}`} aria-pressed={horizon === value} onClick={() => changeHorizon(value)}>{value}d</button>)}</div>}>
          {error && <div className="callout warning" role="alert" style={{ marginBottom: 12 }}><Icon name="circle-alert" /><div><strong>Refresh paused</strong><p>{error}</p></div></div>}
          {loading && <div className="forecast-loading"><span className="spinner" /> Refreshing planning view…</div>}
          <div className={`forecast-chart ${loading ? "is-loading" : ""}`} aria-busy={loading} tabIndex={0} aria-label="Scrollable refund exposure chart">
            <div className="chart-legend" aria-hidden="true"><span><i className="legend-line history" />{data.isIllustrative ? "Synthetic history" : "Observed"}</span><span><i className="legend-line forecast" />{usesModelQuantiles ? "Middle estimate (P50)" : "Baseline forecast"}</span><span><i className="legend-band" />{usesModelQuantiles ? "Model range (P10–P90)" : "Low–high planning range"}</span></div>
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-labelledby="forecast-title forecast-description">
              <title id="forecast-title">Daily approved-refund exposure forecast</title>
              <desc id="forecast-description">{data.isIllustrative ? "Synthetic" : "Observed"} daily refund totals followed by a central forecast and {usesModelQuantiles ? "a ten-to-ninety percentile uncertainty band" : "heuristic low-to-high planning bounds"}. The complete plotted values follow this chart.</desc>
              {chart.yTicks.map((tick) => <g key={tick.value}><line className="chart-grid" x1={inset.left} x2={chartWidth - inset.right} y1={tick.y} y2={tick.y} /><text className="chart-label" x={inset.left - 10} y={tick.y + 4} textAnchor="end">{compactMoney(tick.value)}</text></g>)}
              <path className="chart-band" d={chart.bandPath} />
              <path className="chart-history" d={chart.historyPath} />
              <path className="chart-forecast" d={chart.forecastPath} />
              <line className="chart-divider" x1={chart.dividerX} x2={chart.dividerX} y1={inset.top} y2={chartHeight - inset.bottom} />
              <text className="chart-caption" x={chart.dividerX + 8} y={inset.top + 11}>Forecast</text>
              {chart.xTicks.map((tick) => <text className="chart-label" key={tick.label} x={tick.x} y={chartHeight - 11} textAnchor="middle">{tick.label}</text>)}
            </svg>
          </div>
          <details className="forecast-values">
            <summary>View all plotted values</summary>
            <div className="table-card" role="region" aria-label="Daily history and forecast values" tabIndex={0}><table className="data-table forecast-table">
              <caption className="sr-only">Fourteen days of refund history followed by the selected forecast horizon</caption>
              <thead><tr><th scope="col">Date</th><th scope="col">Series</th><th scope="col">{lowBoundLabel}</th><th scope="col">{usesModelQuantiles ? "P50" : "Central"}</th><th scope="col">{highBoundLabel}</th></tr></thead>
              <tbody>
                {data.history.slice(-14).map((point) => <tr key={`history-${point.date}`}><th scope="row">{shortDate(point.date)}</th><td>{data.isIllustrative ? "Synthetic history" : "Observed"}</td><td aria-label="Not applicable">—</td><td>{formatMoney(point.valuePaise)}</td><td aria-label="Not applicable">—</td></tr>)}
                {data.forecast.map((point) => <tr key={`forecast-${point.date}`}><th scope="row">{shortDate(point.date)}</th><td>Forecast</td><td>{formatMoney(point.p10Paise)}</td><td>{formatMoney(point.p50Paise)}</td><td>{formatMoney(point.p90Paise)}</td></tr>)}
              </tbody>
            </table></div>
          </details>
          <div className="forecast-source"><span><Icon name="activity" />{data.modelLabel}</span><span>History through {historyThrough ? shortDate(historyThrough) : "unavailable"} · refreshed {dateTime(data.generatedAt)}</span></div>
        </Card>

        <div className="risk-side">
          <Card title="Reserve decision" description="Current queue plus forecasted new refund demand.">
            <div className="risk-list">
              <RiskRow tone={summary.status === "covered" ? "good" : "warning"} title={summary.status === "covered" ? "Reserve covered" : "Top-up recommended"} detail={summary.status === "covered" ? `${formatMoney(summary.headroomPaise)} remains after the open queue and ${horizon}-day stress plan.` : `Add ${formatMoney(Math.abs(summary.headroomPaise))} to cover the open queue and planning range.`} />
              <RiskRow tone="neutral" title="Priced customer refunds" detail={`${formatMoney(openExposure.customerRefundPaise)} across ${openExposure.pricedClaimCount} open claims.`} />
              <RiskRow tone="good" title="Expected seller reversals" detail={`${formatMoney(openExposure.expectedSellerReversalPaise)} is deducted only where reversal is currently executable.`} />
              <RiskRow tone={openExposure.blockedAtRiskPaise > 0 ? "warning" : "neutral"} title="Blocked exposure" detail={`${formatMoney(openExposure.blockedAtRiskPaise)} is reserved in full because recovery is not dependable yet.`} />
              <RiskRow tone={openExposure.unpricedClaimCount > 0 ? "warning" : "neutral"} title="Unpriced claims" detail={`${openExposure.unpricedClaimCount} claim${openExposure.unpricedClaimCount === 1 ? "" : "s"} still require review and are not included in the amount above.`} />
            </div>
            <Link className="button secondary reserve-link" href="/claims"><Icon name="inbox" />Review open claims</Link>
          </Card>
          <Card title="Planning boundary">
            <div className="check-list">
              <div className="check-row"><span className="check-mark"><Icon name="check" /></span><span>Forecasts only aggregate refund cash demand</span></div>
              <div className="check-row"><span className="check-mark"><Icon name="check" /></span><span>Current open claims are added once, outside the forecast</span></div>
              <div className="check-row"><span className="check-mark"><Icon name="check" /></span><span>Lower, middle, and upper model estimates remain visible</span></div>
              <div className="check-row"><span className="check-mark"><Icon name="check" /></span><span>Per-claim money still comes from the paise engine</span></div>
              <div className="check-row"><span className="check-mark"><Icon name="check" /></span><span>Forecasts cannot approve or reprioritize a refund</span></div>
            </div>
            <p className="planning-definition">The demo forecast represents new refund authorizations after the history cutoff. The separate open commitment contains only today’s unresolved queue, so it is not counted twice.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RiskRow({ tone, title, detail }: { tone: "good" | "warning" | "neutral"; title: string; detail: string }) {
  return <div className="risk-row"><span className={`risk-indicator ${tone}`} /><div><strong>{title}</strong><p>{detail}</p></div></div>;
}

function buildChart(data: ForecastResponse) {
  const history = data.history.slice(-14);
  const all = [...history.map((point) => point.valuePaise), ...data.forecast.flatMap((point) => [point.p10Paise, point.p90Paise])];
  const max = Math.ceil(Math.max(...all) / 500_000) * 500_000;
  const min = Math.max(0, Math.floor(Math.min(...all) / 500_000) * 500_000 - 500_000);
  const combinedLength = history.length + data.forecast.length;
  const x = (index: number) => inset.left + index * ((chartWidth - inset.left - inset.right) / (combinedLength - 1));
  const y = (value: number) => inset.top + (max - value) * ((chartHeight - inset.top - inset.bottom) / Math.max(1, max - min));
  const historyPath = history.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.valuePaise).toFixed(1)}`).join(" ");
  const bridge = { date: history[history.length - 1].date, p10Paise: history[history.length - 1].valuePaise, p50Paise: history[history.length - 1].valuePaise, p90Paise: history[history.length - 1].valuePaise };
  const forecastWithBridge = [bridge, ...data.forecast];
  const forecastPath = forecastWithBridge.map((point, index) => `${index === 0 ? "M" : "L"}${x(history.length - 1 + index).toFixed(1)},${y(point.p50Paise).toFixed(1)}`).join(" ");
  const upper = forecastWithBridge.map((point, index) => `${index === 0 ? "M" : "L"}${x(history.length - 1 + index).toFixed(1)},${y(point.p90Paise).toFixed(1)}`).join(" ");
  const lower = [...forecastWithBridge].reverse().map((point, reverseIndex) => { const index = forecastWithBridge.length - 1 - reverseIndex; return `L${x(history.length - 1 + index).toFixed(1)},${y(point.p10Paise).toFixed(1)}`; }).join(" ");
  const ticks = Array.from({ length: 4 }, (_, index) => min + Math.round((max - min) * index / 3));
  const yTicks = ticks.map((value) => ({ value, y: y(value) }));
  const dates = [...history.map((point) => point.date), ...data.forecast.map((point) => point.date)];
  const xTickIndexes = [0, history.length - 1, combinedLength - 1];
  const xTicks = xTickIndexes.map((index) => ({ x: x(index), label: shortDate(dates[index]) }));
  return { historyPath, forecastPath, bandPath: `${upper} ${lower} Z`, dividerX: x(history.length - 1), yTicks, xTicks };
}

function compactMoney(paise: number) { return `₹${Math.round(paise / 100_000)}k`; }
function formatMoney(paise: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100); }
function shortDate(date: string) { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)); }
function dateTime(value: string) { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(value)); }
