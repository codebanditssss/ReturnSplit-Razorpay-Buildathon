"use client";

import Link from "next/link";
import { useState } from "react";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const [showReference, setShowReference] = useState(false);

  async function copyReference() {
    if (!error.digest) return;
    try {
      await navigator.clipboard.writeText(error.digest);
      setShowReference(false);
      setCopyStatus("Error reference copied.");
    } catch {
      setShowReference(true);
      setCopyStatus("Copy failed. The error reference is shown below.");
    }
  }

  return (
    <div className="page page-narrow">
      <div className="card">
        <div className="empty-state">
          <h1 className="state-title">This view could not be loaded</h1>
          <p role="alert">Please try again. No payment action was taken.</p>
          <div className="state-actions">
            <button className="button" type="button" onClick={() => retry()}>Try again</button>
            <Link className="button secondary" href="/claims">Back to claims</Link>
            {error.digest && <button className="button ghost" type="button" onClick={() => void copyReference()}>Copy error reference</button>}
          </div>
          <p className={showReference ? "error-reference" : "sr-only"} role="status" aria-live="polite">
            {showReference ? <>Error reference: <code>{error.digest}</code></> : copyStatus}
          </p>
        </div>
      </div>
    </div>
  );
}
