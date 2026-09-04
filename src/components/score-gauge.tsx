import { Icon } from "./icons";

export function ScoreGauge({
  ratio,
  valueText,
  grade,
  label,
  caption,
  tone = "good",
}: {
  ratio: number;
  valueText: string;
  grade: string;
  label: string;
  caption: string;
  tone?: "good" | "warning";
}) {
  const percentage = Math.max(0, ratio * 100);
  const scaleMaximum = Math.max(125, Math.ceil(percentage / 25) * 25);
  const fillPercentage = Math.min(100, percentage / scaleMaximum * 100);
  const targetPercentage = 100 / scaleMaximum * 100;

  return (
    <div className={`coverage-summary ${tone}`}>
      <div className="coverage-heading">
        <div>
          <span className="coverage-label">{label}</span>
          <div className="coverage-value-row">
            <strong className="coverage-value">{valueText}</strong>
            <span className="coverage-state"><Icon name={tone === "good" ? "circle-check" : "circle-alert"} />{grade}</span>
          </div>
        </div>
        <span className="coverage-target">Target 100%</span>
      </div>

      <div
        className="coverage-meter"
        role="meter"
        aria-label={`${label}: ${valueText}, ${grade}`}
        aria-valuemin={0}
        aria-valuemax={scaleMaximum}
        aria-valuenow={Math.round(percentage)}
      >
        <span className="coverage-fill" style={{ width: `${fillPercentage}%` }} />
        <span className="coverage-target-mark" style={{ left: `${targetPercentage}%` }} />
      </div>
      <div className="coverage-scale" aria-hidden="true">
        <span>0%</span>
        <span style={{ left: `${targetPercentage}%` }}>100%</span>
        <span>{scaleMaximum}%</span>
      </div>

      <p className="coverage-caption">{caption}</p>
    </div>
  );
}
