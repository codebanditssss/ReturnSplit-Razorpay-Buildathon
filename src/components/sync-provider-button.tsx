"use client";

import { useState } from "react";
import { Icon } from "./icons";

export function SyncProviderButton() {
  const [state, setState] = useState<"idle" | "syncing" | "done" | "error">("idle");

  async function sync() {
    setState("syncing");
    try {
      const response = await fetch("/api/provider/health", { cache: "no-store" });
      if (!response.ok) throw new Error("Provider unavailable");
      setState("done");
    } catch {
      setState("error");
    }
  }

  const label = state === "syncing" ? "Checking configuration…" : state === "done" ? "Adapter configured" : state === "error" ? "Retry configuration check" : "Check adapter configuration";
  return <button className="button secondary" type="button" onClick={sync} disabled={state === "syncing"} aria-label={label} aria-live="polite"><Icon name={state === "done" ? "check" : "refresh"} /><span>{label}</span></button>;
}
