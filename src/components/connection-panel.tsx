"use client";

import { useState } from "react";
import { Icon } from "./icons";
import { StatusPill } from "./ui";

type ProviderMode = "demo" | "razorpay_test";

export function ConnectionPanel({ initialMode, initialLabel }: { initialMode: ProviderMode; initialLabel: string }) {
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<ProviderMode>(initialMode);
  const [label, setLabel] = useState(initialLabel);

  async function testConnection() {
    setChecking(true);
    setError(false);
    try {
      const response = await fetch("/api/provider/health", { cache: "no-store" });
      if (!response.ok) throw new Error("Provider health check failed");
      const result = await response.json() as { ok?: boolean; mode?: string; label?: string };
      if (!result.ok || (result.mode !== "demo" && result.mode !== "razorpay_test") || typeof result.label !== "string") throw new Error("Unexpected provider response");
      setMode(result.mode);
      setLabel(result.label);
      setChecked(true);
    } catch {
      setError(true);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="settings-list">
      <div className="settings-row">
        <div>
          <span className="provider-logo">Razorpay Route</span>
          <p role="status" aria-live="polite" aria-atomic="true">{error ? "The configured provider adapter did not respond. No operation was attempted." : checked ? mode === "demo" ? "Simulator checked just now and is ready." : "Test Mode adapter configuration is loaded; this check does not call Razorpay." : mode === "demo" ? "Connected to a local simulator with Razorpay-shaped responses." : `${label} is selected. Seeded demo IDs are barred from external requests.`}</p>
        </div>
        <StatusPill tone="active">{mode === "demo" ? "Demo mode" : "Test Mode"}</StatusPill>
      </div>
      <div className="settings-row">
        <div><strong>Environment</strong><p>Credentials are server-only and never exposed to the browser.</p></div>
        <span className="mono">{mode === "demo" ? "demo_india_01" : "razorpay_test"}</span>
      </div>
      <div className="settings-row">
        <div><strong>Webhook verification</strong><p>HMAC rotation and replay behavior are contract-tested; no live delivery telemetry is connected.</p></div>
        <StatusPill tone="neutral">Tested</StatusPill>
      </div>
      <div className="settings-row">
        <div><strong>Live reconciliation</strong><p>Requires a durable provider-sync worker before production use.</p></div>
        <span className="table-secondary">Not connected</span>
      </div>
      <div className="settings-row">
        <div><strong>Configuration check</strong><p>Confirms the selected server-side adapter is available. Test Mode credentials are not probed.</p></div>
        <button className="button secondary" type="button" onClick={testConnection} disabled={checking}>
          {checking ? <span className="spinner" style={{ borderColor: "#b9c0bc", borderTopColor: "#176247" }} /> : <Icon name="refresh" />}
          {checking ? "Checking…" : mode === "demo" ? "Check simulator" : "Check configuration"}
        </button>
      </div>
    </div>
  );
}
