/* Circular 270-degree arc gauge (Dynamics 365 "Lead Score" ref, retinted to brand).
   Self-contained inline styling so it never depends on shared CSS. */
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
  const CX = 70;
  const CY = 70;
  const R = 54;
  const C = 2 * Math.PI * R;
  const sweep = 0.75; // 270 degrees, gap at the bottom
  const track = C * sweep;
  const clamped = Math.max(0, Math.min(1, ratio));
  const fill = track * clamped;
  const color = tone === "good" ? "#176247" : "#925816";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <div style={{ position: "relative", width: 140, height: 140, flex: "0 0 auto" }}>
        <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label={`${label}: ${valueText}, ${grade}`}>
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#e4e9e4" strokeWidth={11} strokeLinecap="round"
            strokeDasharray={`${track} ${C - track}`} transform={`rotate(135 ${CX} ${CY})`} />
          <circle cx={CX} cy={CY} r={R} fill="none" stroke={color} strokeWidth={11} strokeLinecap="round"
            strokeDasharray={`${fill} ${C - fill}`} transform={`rotate(135 ${CX} ${CY})`}
            style={{ transition: "stroke-dasharray .8s cubic-bezier(.34,1.2,.5,1)" }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
          <div>
            <div style={{ fontSize: 30, fontWeight: 720, letterSpacing: "-.03em", lineHeight: 1, color: "#17201c", fontVariantNumeric: "tabular-nums" }}>{valueText}</div>
            <div style={{ marginTop: 5, fontSize: 11, fontWeight: 650, letterSpacing: ".02em", color }}>{grade}</div>
          </div>
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#57615b" }}>{label}</div>
        <p style={{ margin: "6px 0 0", fontSize: 12.5, lineHeight: 1.5, color: "#66716b" }}>{caption}</p>
      </div>
    </div>
  );
}
