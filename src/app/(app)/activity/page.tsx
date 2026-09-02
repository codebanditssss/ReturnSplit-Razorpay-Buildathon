import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { PageHeader, StatusPill, type StatusTone } from "@/components/ui";
import { activityEvents } from "@/lib/data";
import type { ActivityEvent } from "@/lib/types";
import { getDemoExecutionActivity, getDemoSessionActivity } from "@/server/demo-runtime";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

const eventPresentation: Record<ActivityEvent["type"], { title: string; label: string; tone: StatusTone }> = {
  claim_received: { title: "Return claim received", label: "Logged", tone: "neutral" },
  item_extracted: { title: "Item extraction reviewed", label: "Abstained", tone: "review" },
  calculation_created: { title: "Refund plan calculated", label: "Ready", tone: "ready" },
  approval_recorded: { title: "Plan approved", label: "Approved", tone: "ready" },
  transfer_reversed: { title: "Seller transfer reversed", label: "Confirmed", tone: "completed" },
  refund_created: { title: "Refund completed", label: "Completed", tone: "completed" },
  provider_failure: { title: "Execution paused safely", label: "Retry safe", tone: "info" },
  provider_snapshot_checked: { title: "Provider balances checked", label: "Verified", tone: "completed" },
  execution_started: { title: "Execution step submitted", label: "In progress", tone: "info" },
  reconciliation_pending: { title: "Provider result needs reconciliation", label: "Paused", tone: "review" },
  duplicate_event_ignored: { title: "Duplicate webhook ignored", label: "No action", tone: "neutral" },
  manual_review_requested: { title: "Manual review requested", label: "Waiting", tone: "review" },
  recovery_updated: { title: "Recovery case updated", label: "Recorded", tone: "info" },
};

function presentationFor(event: ActivityEvent): { title: string; label: string; tone: StatusTone } {
  if (event.type === "provider_failure" && event.metadata?.retryable === false) {
    return { title: "Execution stopped safely", label: "Manual action", tone: "blocked" };
  }
  if (event.type === "provider_snapshot_checked") {
    const providerOutcome = event.metadata?.outcome;
    if (providerOutcome === "mismatch" || event.outcome === "danger") {
      return { title: "Provider balances changed", label: "Mismatch", tone: "blocked" };
    }
    if (providerOutcome === "unknown" || event.outcome === "warning") {
      return { title: "Provider balance check inconclusive", label: "Unknown", tone: "review" };
    }
    if (providerOutcome !== "verified" && event.outcome !== "success") {
      return { title: "Provider balances checked", label: "Checked", tone: "info" };
    }
  }
  if (event.type === "recovery_updated") {
    if (event.outcome === "success") return { title: "Recovery case updated", label: "Closed", tone: "completed" };
    if (event.outcome === "warning" || event.outcome === "danger") return { title: "Recovery case updated", label: "Attention", tone: "review" };
  }
  return eventPresentation[event.type];
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export default async function ActivityPage() {
  const events = [...activityEvents, ...getDemoSessionActivity(), ...await getDemoExecutionActivity()]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

  return (
    <div className="page">
      <PageHeader title="Activity" description="Review decisions, execution steps, and provider outcomes for this workspace." />
      <div className="table-card mobile-card-table-wrap" role="region" aria-label="Audit activity">
        <table className="data-table mobile-card-table activity-table">
          <caption className="sr-only">Decisions and provider events</caption>
          <thead><tr><th scope="col">Event</th><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Result</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>{events.map((event) => {
            const presentation = presentationFor(event);
            return <tr key={event.id}>
              <th scope="row" data-label="Event"><span className="table-primary">{presentation.title}</span><span className="table-secondary">{event.claimId ? `${event.claimId} · ` : ""}{event.summary}</span>{event.requestId && <span className="table-secondary mono">Request {event.requestId}</span>}</th>
              <td data-label="Time"><span className="table-primary mono">{timeLabel(event.occurredAt)}</span><span className="table-secondary">{dateLabel(event.occurredAt)}</span></td>
              <td data-label="Actor">{event.actor}</td><td data-label="Result"><StatusPill tone={presentation.tone}>{presentation.label}</StatusPill></td>
              <td data-label="Open">{event.claimId && <Link className="row-link" href={`/claims/${event.claimId}`} aria-label={`Open claim ${event.claimId}`}>Open claim <Icon name="chevron-right" /></Link>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </div>
  );
}
