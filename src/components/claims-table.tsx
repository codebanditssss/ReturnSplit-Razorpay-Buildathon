"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { claimOperationPresentation, type ClaimOperationKind } from "@/lib/claim-operation-presentation";
import type { ClaimExecutionSummary, ClaimStatus, ISODateTime, LiabilityParty, Paise } from "@/lib/types";
import { Avatar } from "./avatar";
import { Icon } from "./icons";
import { Money, StatusPill } from "./ui";

export interface ClaimRecoveryRow {
  status: "open" | "closed";
  outstandingAmountPaise: Paise;
  responsibleParty: "unresolved" | "seller" | "courier" | "marketplace";
  dueAt: ISODateTime;
  ageHours: number;
  overdue: boolean;
}

export interface ClaimRow {
  id: string;
  reference: string;
  orderId: string;
  customerName: string;
  submittedAt: ISODateTime;
  itemSummary: string;
  reasonLabel: string;
  sellerNames: string;
  amountPaise?: Paise;
  liability: LiabilityParty;
  status: ClaimStatus;
  statusLabel: string;
  execution?: ClaimExecutionSummary;
  recovery?: ClaimRecoveryRow;
}

type Filter = "open" | "recovery" | "ready_for_approval" | "needs_review" | "processing" | "blocked" | "completed";

const operationPriority: Record<ClaimOperationKind, number> = {
  manual_intervention: 0,
  blocked: 0,
  reconcile_reversal: 1,
  reconcile_refund: 1,
  review: 2,
  retry_reversal: 3,
  retry_refund: 3,
  ready: 4,
  executing: 5,
  executing_reversal: 5,
  executing_refund: 5,
  completed: 6,
};

function queueStatus(claim: ClaimRow): Exclude<Filter, "open"> {
  if (claim.status === "completed" && claim.recovery?.status === "open") return "recovery";
  return claimOperationPresentation(claim).queueStatus;
}

function rowPriority(claim: ClaimRow): number {
  if (claim.status === "completed" && claim.recovery?.status === "open") return claim.recovery.overdue ? -1 : 2;
  return operationPriority[claimOperationPresentation(claim).kind];
}

export function ClaimsTable({ claims, providerLabel, asOf }: { claims: readonly ClaimRow[]; providerLabel: string; asOf: ISODateTime }) {
  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const matchingClaims = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return claims.filter((claim) => !normalized || [claim.reference, claim.orderId, claim.customerName, claim.sellerNames, claim.itemSummary, claim.reasonLabel]
      .some((field) => field.toLowerCase().includes(normalized)));
  }, [claims, query]);

  const counts = useMemo(() => {
    const next: Record<Filter, number> = {
      open: 0,
      ready_for_approval: 0,
      needs_review: 0,
      processing: 0,
      blocked: 0,
      recovery: 0,
      completed: 0,
    };
    for (const claim of matchingClaims) {
      const status = queueStatus(claim);
      next[status] += 1;
      if (status !== "completed") next.open += 1;
    }
    return next;
  }, [matchingClaims]);

  const visible = useMemo(() => {
    return matchingClaims.filter((claim) => {
      const status = queueStatus(claim);
      return filter === "open" ? status !== "completed" : status === filter;
    }).sort((left, right) => rowPriority(left) - rowPriority(right)
      || left.submittedAt.localeCompare(right.submittedAt));
  }, [filter, matchingClaims]);

  const tabs: Array<[Filter, string]> = [
    ["open", "Open"], ["blocked", "Blocked"], ["needs_review", "Review"], ["recovery", "Recovery"], ["ready_for_approval", "Ready"], ["processing", "Execution"], ["completed", "Completed"],
  ];
  const hasActiveFilter = filter !== "open" || query.trim().length > 0;

  return (
    <>
      <div className="toolbar">
        <div className="tabs" role="group" aria-label="Claim status filters">
          {tabs.map(([value, label]) => {
            const count = counts[value];
            return <button key={value} type="button" aria-label={`${label}, ${count} claim${count === 1 ? "" : "s"}`} aria-pressed={filter === value} className={`tab ${filter === value ? "is-active" : ""}`} onClick={() => setFilter(value)}>{label} ({count})</button>;
          })}
        </div>
        <div className="toolbar-actions">
          <label className="search-field"><Icon name="search" /><span className="sr-only">Search by claim, order, customer, seller, item, or reason</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Claim, order, customer, seller, or item" /></label>
          <button className="button secondary" type="button" aria-expanded={showFilters} aria-controls="queue-rules" onClick={() => setShowFilters((value) => !value)}><Icon name="filter" /> Queue order</button>
        </div>
      </div>
      {showFilters && <div id="queue-rules" className="callout info" style={{ marginBottom: 12 }}><Icon name="filter" /><div><strong>How the open queue is ordered</strong><p>Overdue recovery and blocked work come first, followed by reconciliation, review/recovery, retry, ready, and active execution. A completed customer refund stays open while recovery is outstanding. Environment: {providerLabel === "Demo" ? "Simulation" : providerLabel}.</p></div></div>}
      <p className="sr-only" role="status" aria-live="polite">{visible.length} claim{visible.length === 1 ? "" : "s"} shown.</p>
      <div className="table-card claims-table-card" role="region" aria-label="Claims queue">
        <table className="data-table claims-table">
          <caption className="sr-only">Claims awaiting review, post-refund recovery, and recently completed claims</caption>
          <thead><tr><th scope="col">Claim</th><th scope="col">Customer</th><th scope="col">Returned item</th><th scope="col">Refund</th><th scope="col">Immediate funding source</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {visible.map((claim) => {
              const operation = claimOperationPresentation(claim);
              const recovery = claim.status === "completed" && claim.recovery?.status === "open" ? claim.recovery : undefined;
              const actionLabel = recovery ? "Open recovery" : operation.kind === "completed" ? "View claim" : "Review";
              return <tr key={claim.id}>
                <th scope="row" className="claim-cell"><span className="table-primary">{claim.reference}</span><time className="table-secondary" dateTime={claim.submittedAt} title={`Age calculated as of ${formatDateTime(asOf)}`}>{formatAge(claim.submittedAt, asOf)} · {formatDate(claim.submittedAt)}</time></th>
                <td className="customer-cell" data-label="Customer"><div className="cust-identity"><Avatar name={claim.customerName} size={32} /><div className="cust-identity-copy"><span className="table-primary">{claim.customerName}</span><span className="table-secondary">{claim.orderId}</span></div></div></td>
                <td className="item-cell" data-label="Returned item"><span className="table-primary">{claim.itemSummary}</span><span className="table-secondary">{claim.reasonLabel}</span></td>
                <td className="refund-cell" data-label="Refund">{typeof claim.amountPaise === "number" ? <Money paise={claim.amountPaise} /> : <span className="table-secondary">Pending review</span>}</td>
                <td className="liability-cell" data-label="Immediate funding source">{liabilityLabel(claim.liability)}</td>
                <td className="status-cell" data-label="Status"><div className="operation-state">{recovery ? <><StatusPill tone={recovery.overdue ? "blocked" : "review"}>{recovery.overdue ? "Recovery overdue" : "Recovery open"}</StatusPill><span className="table-secondary operation-detail">Customer refund completed · <Money paise={recovery.outstandingAmountPaise} /> outstanding · {recovery.responsibleParty === "unresolved" ? "responsibility unresolved" : `${capitalize(recovery.responsibleParty)} responsible`} · due {formatDateTime(recovery.dueAt)}</span></> : <><StatusPill tone={operation.tone}>{operation.label}</StatusPill>{operation.detail && <span className="table-secondary operation-detail">{operation.detail}</span>}</>}</div></td>
                <td className="open-cell"><Link className="row-link" href={`/claims/${claim.reference}`} aria-label={`${actionLabel} ${claim.reference}`}>{actionLabel} <Icon name="chevron-right" /></Link></td>
              </tr>;
            })}
            {visible.length === 0 && <tr className="empty-row"><td colSpan={7}><div className="empty-state"><h2 className="state-title">{hasActiveFilter ? "No matching claims" : "You’re all caught up"}</h2><p>{hasActiveFilter ? "Clear a filter or try another search." : "No claims need a decision right now."}</p>{hasActiveFilter && <button className="button secondary" type="button" onClick={() => { setFilter("open"); setQuery(""); setShowFilters(false); }}>Clear filters</button>}</div></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function liabilityLabel(value: LiabilityParty) {
  if (value === "seller") return "Seller + marketplace";
  if (value === "marketplace") return "Mora Market";
  if (value === "courier") return "Mora Market advance";
  if (value === "customer") return "Customer";
  return "Unresolved";
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(value));
}

function formatAge(value: string, asOf: string) {
  const elapsedMinutes = Math.floor((new Date(asOf).getTime() - new Date(value).getTime()) / 60_000);
  if (!Number.isFinite(elapsedMinutes) || elapsedMinutes < 0) return "Age unavailable";
  if (elapsedMinutes < 1) return "Less than 1 minute old";
  if (elapsedMinutes < 60) return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} old`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 48) return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} old`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays === 1 ? "" : "s"} old`;
}
