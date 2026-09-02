"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./icons";

const scenarios = [
  { id: "golden_path", title: "Golden approval", detail: "One seller reversal followed by a customer refund." },
  { id: "item_review", title: "Ambiguous item", detail: "Resolve a two-variant item match and recalculate." },
  { id: "liability_review", title: "Liability decision", detail: "Assign who fronts a courier-damage refund." },
  { id: "blocked_reconciliation", title: "Blocked balance", detail: "Escalate an insufficient transfer balance." },
  { id: "retry_recovery", title: "Safe retry", detail: "Resume after one of two reversals has succeeded." },
] as const;

export function DemoScenarios() {
  const router = useRouter();
  const [launching, setLaunching] = useState<string>();
  const [error, setError] = useState("");

  async function launch(scenario: string) {
    setLaunching(scenario);
    setError("");
    try {
      const response = await fetch("/api/demo/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario }),
      });
      const body = await response.json() as { startPath?: string; error?: string };
      if (!response.ok || !body.startPath) throw new Error(body.error ?? "The demo could not be reset");
      router.push(body.startPath);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The demo could not be reset");
      setLaunching(undefined);
    }
  }

  return (
    <div className="settings-list">
      {scenarios.map((scenario) => <div className="settings-row" key={scenario.id}>
        <div><strong>{scenario.title}</strong><p>{scenario.detail}</p></div>
        <button className="button secondary" disabled={Boolean(launching)} onClick={() => void launch(scenario.id)}>
          <Icon name={launching === scenario.id ? "refresh" : "arrow-right"} />
          {launching === scenario.id ? "Resetting…" : "Launch"}
        </button>
      </div>)}
      {error && <div className="callout danger" role="alert"><Icon name="circle-alert" /><div><strong>Reset failed</strong><p>{error}</p></div></div>}
    </div>
  );
}
