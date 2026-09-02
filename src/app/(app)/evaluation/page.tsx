import type { Metadata } from "next";
import { Icon } from "@/components/icons";
import { Card, PageHeader, StatusPill } from "@/components/ui";
import { evaluateSyntheticBatch } from "@/evaluation/batch";
import { latestForecastBacktest } from "@/evaluation/forecast-backtest-snapshot";

export const metadata: Metadata = { title: "Controls & evidence" };

const suites = [
  { name: "Paise conservation", scope: "Discount allocation, shipping, quantities, rounding", target: "Target: 0 violations" },
  { name: "Execution safety", scope: "Duplicate requests, stale plans, unknown outcomes", target: "0 duplicate effects" },
  { name: "Extraction benchmark gate", scope: "Planned: sealed multilingual claims, ambiguity, injection", target: "₹0 wrong-seller FP" },
  { name: "Provider reconciliation", scope: "Timeouts, partial failures, out-of-order events", target: "100% safe recovery" },
];

function percent(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function EvaluationPage() {
  const report = evaluateSyntheticBatch();
  const throughput = report.recordsPerSecond === null
    ? "below timer resolution"
    : `${Math.round(report.recordsPerSecond).toLocaleString("en-IN")} records/s`;
  const p50Latency = report.latencyMs.p50 === null ? "unavailable" : `${report.latencyMs.p50.toFixed(3)} ms`;
  const p95Latency = report.latencyMs.p95 === null ? "unavailable" : `${report.latencyMs.p95.toFixed(3)} ms`;
  return (
    <div className="page page-narrow">
      <PageHeader eyebrow="Assurance" title="Controls & evidence" description="Inspect the safety checks, exception handling, and planning evidence behind ReturnSplit." />
      <div className="callout warning" style={{ marginBottom: 18 }}><Icon name="circle-alert" /><div><strong>Evaluation data is synthetic</strong><p>These checks verify deterministic behavior and seeded scenarios. Representative merchant claims and Test Mode evidence remain required.</p></div></div>
      <div className="metric-strip">
        <div className="metric"><span className="metric-label">Control cases</span><strong className="metric-value">{report.records}</strong><span className="metric-note">Generated scenario set</span></div>
        <div className="metric"><span className="metric-label">Expected outcomes</span><strong className="metric-value">{report.fixtureAssertionsPassed}/{report.records}</strong><span className="metric-note good">Scenario agreement</span></div>
        <div className="metric"><span className="metric-label">Unsafe automation</span><strong className="metric-value">{report.unsafeAutomations}</strong><span className="metric-note good">₹{report.wrongSellerPaise / 100} wrong-seller FP</span></div>
        <div className="metric"><span className="metric-label">Exceptions surfaced</span><strong className="metric-value">{report.exceptionRecords}</strong><span className="metric-note">Not hidden as matches</span></div>
      </div>
      <div style={{ marginBottom: 16 }}><Card title="Money-movement controls" description="Expected decisions are compared with the same paise engine used by the claim workbench across discounts, quantities, sellers, abstentions, and balance blocks." action={<a className="button secondary" href="/api/evaluation/batch" download><Icon name="file-text" />Download evidence</a>}>
        <div className="split-grid">
          <div className="check-list">
            <div className="check-row"><span className="check-mark"><Icon name="check" /></span><span>{report.automatedRecords} clear execute/no-reversal fixtures closed</span></div>
            <div className="check-row"><span className="check-mark"><Icon name="check" /></span><span>{report.exceptionRecords} ambiguous or unsafe records deferred</span></div>
            <div className="check-row"><span className="check-mark"><Icon name="check" /></span><span>0 unsafe executions and ₹0 wrong-seller overage</span></div>
            <div className="check-row"><span className="check-mark"><Icon name="activity" /></span><span>{report.records} in-process cases in {report.elapsedMs.toFixed(2)} ms · {throughput}</span></div>
          </div>
          <details className="evidence-details"><summary>Reproduce the engine run</summary><div className="code-block">pnpm eval:batch<br />p50_case_latency: {p50Latency}<br />p95_case_latency: {p95Latency}<br />scope: engine_only_no_network<br />production_claims: 0</div></details>
        </div>
        <details className="evidence-details">
          <summary>View all {report.exceptionRecords} exceptions</summary>
          <div className="table-card mobile-card-table-wrap" role="region" aria-label="Complete synthetic exception list">
            <table className="data-table mobile-card-table info-card-table"><caption className="sr-only">All exceptions from the synthetic batch replay</caption><thead><tr><th scope="col">Record</th><th scope="col">Scenario</th><th scope="col">Disposition</th><th scope="col">Reason</th></tr></thead><tbody>
              {report.exceptions.map((exception) => <tr key={exception.id}><th scope="row" data-label="Record"><span className="table-primary mono">{exception.id}</span></th><td data-label="Scenario">{exception.scenario.replaceAll("_", " ")}</td><td data-label="Disposition"><StatusPill tone={exception.disposition === "blocked" ? "blocked" : "review"}>{exception.disposition}</StatusPill></td><td data-label="Reason"><span className="mono">{exception.code}</span></td></tr>)}
            </tbody></table>
          </div>
        </details>
      </Card></div>
      <div style={{ marginBottom: 16 }}><Card title="Refund forecast evidence" description="A dated TimesFM run compared with two simple baselines. It measures aggregate cash-planning forecasts only." action={<a className="button secondary" href="/api/evaluation/forecast" download><Icon name="file-text" />Download evidence</a>}>
        <div className="callout info" style={{ marginBottom: 16 }}><Icon name="activity" /><div><strong>15 of 15 origins used TimesFM · 0 fallbacks</strong><p>Recorded 4 Sep 2026 on 56 synthetic daily totals. The integration is verified; production accuracy is not.</p></div></div>
        <div className="table-card" role="region" aria-label="TimesFM forecast backtest results" tabIndex={0}>
          <table className="data-table forecast-evidence-table">
            <caption className="sr-only">TimesFM WAPE and interval coverage by forecast horizon</caption>
            <thead><tr><th scope="col">Horizon</th><th scope="col">TimesFM WAPE</th><th scope="col">Seasonal baseline</th><th scope="col">Last-value baseline</th><th scope="col">P10–P90 coverage</th></tr></thead>
            <tbody>{latestForecastBacktest.horizons.map((result) => <tr key={result.days}><th scope="row">{result.days} days <span className="table-secondary">{result.observations} observations</span></th><td><span className="table-primary">{percent(result.wape)}</span></td><td>{percent(result.seasonalNaiveWape)}</td><td>{percent(result.lastValueWape)}</td><td>{percent(result.intervalCoverage)}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="split-grid" style={{ marginTop: 16 }}>
          <div className="check-list">
            <div className="check-row"><span className="check-mark"><Icon name="check" /></span><span>TimesFM beat both point baselines at every tested horizon</span></div>
            <div className="check-row"><span className="timeline-dot"><Icon name="clock" /></span><span>Representative merchant history and shadow calibration are still required</span></div>
          </div>
          <details className="evidence-details"><summary>Reproduce the forecast run</summary><div className="code-block">{latestForecastBacktest.command}<br />dataset_sha256: {latestForecastBacktest.datasetSha256.slice(0, 12)}…{latestForecastBacktest.datasetSha256.slice(-8)}<br />evidence: {latestForecastBacktest.evidenceStatus}<br />release: {latestForecastBacktest.releaseStatus}</div></details>
        </div>
      </Card></div>
      <div className="split-grid">
        <Card title="Release gates" description="A failed safety gate blocks execution, regardless of model score.">
          <div className="settings-list">{suites.map((suite) => <div className="settings-row" key={suite.name}><div><strong>{suite.name}</strong><p>{suite.scope}</p></div><StatusPill tone="neutral">{suite.target}</StatusPill></div>)}</div>
        </Card>
        <Card title="Decision boundary" description="Every case produces one explicit outcome before money can move.">
          <details className="evidence-details"><summary>View machine-readable contract</summary><div className="code-block">{`{
  disposition: "execute" | "no_reversal" | "abstain",
  returns: [{ orderLineId, quantity, reasonCode,
              liableParty, evidenceSpan }],
  reversalVector: { [transferId]: amountPaise },
  policyId,
  blockCodes
}`}</div></details>
          <div className="callout info" style={{ marginTop: 14 }}><Icon name="shield" /><div><strong>Abstention is a product outcome</strong><p>Ambiguous evidence is sent to a person. It is never recorded as a valid zero-liability decision.</p></div></div>
        </Card>
      </div>
      <div style={{ marginTop: 16 }}><Card title="Production readiness" description="Controls still required before ReturnSplit can process a live claim.">
        <div className="check-list">
          <div className="check-row"><span className="check-mark"><Icon name="check" /></span><span>Deterministic allocator and failure-state simulation are implemented</span></div>
          <div className="check-row"><span className="check-mark"><Icon name="check" /></span><span>Demo provider is clearly labeled and cannot move live money</span></div>
          <div className="check-row"><span className="timeline-dot"><Icon name="clock" /></span><span>Run against a sealed, independently authored multilingual challenge set</span></div>
          <div className="check-row"><span className="timeline-dot"><Icon name="clock" /></span><span>Validate with at least 100 de-identified, double-annotated marketplace claims</span></div>
          <div className="check-row"><span className="timeline-dot"><Icon name="clock" /></span><span>Capture a real Razorpay Test Mode reversal and webhook reconciliation trace</span></div>
        </div>
      </Card></div>
    </div>
  );
}
