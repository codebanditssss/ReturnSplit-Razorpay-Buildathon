import type { Metadata } from "next";
import { ClaimsTable, type ClaimRow } from "@/components/claims-table";
import { Money, PageHeader } from "@/components/ui";
import { Mascot } from "@/components/mascot";
import { Icon } from "@/components/icons";
import { SyncProviderButton } from "@/components/sync-provider-button";
import { claimOperationPresentation } from "@/lib/claim-operation-presentation";
import {
  getDemoClaimsView,
  getDemoRecoveryCase,
  getProviderIdentity,
  toDemoEscalationReceipt,
  type DemoRecoveryReceipt,
} from "@/server/demo-runtime";

export const metadata: Metadata = { title: "Claims" };
export const dynamic = "force-dynamic";

export default async function ClaimsPage() {
  const currentClaims = await getDemoClaimsView();
  const asOfDate = new Date();
  const asOf = asOfDate.toISOString();
  const provider = getProviderIdentity();
  const recoveryByClaim = new Map<string, DemoRecoveryReceipt>();
  for (const claim of currentClaims) {
    const recoveryCase = getDemoRecoveryCase(claim.id);
    if (recoveryCase) {
      const receipt = toDemoEscalationReceipt(recoveryCase, asOfDate);
      if (receipt.kind === "recovery") recoveryByClaim.set(claim.id, receipt);
    }
  }
  const open = currentClaims.filter((claim) => claim.status !== "completed" || recoveryByClaim.get(claim.id)?.status === "open");
  const exposure = open.reduce((sum, claim) => {
    const recovery = recoveryByClaim.get(claim.id);
    return sum + (recovery?.status === "open"
      ? recovery.outstandingAmountPaise
      : claim.decision?.marketplaceFundedPaise ?? 0);
  }, 0);
  const ready = open.filter((claim) => claim.status === "ready_for_approval").length;
  const attention = open.filter((claim) => {
    if (claim.status === "completed" && recoveryByClaim.get(claim.id)?.status === "open") return true;
    const operation = claimOperationPresentation(claim);
    const healthyProcessing = operation.kind === "executing"
      || operation.kind === "executing_reversal"
      || operation.kind === "executing_refund";
    return operation.queueStatus === "needs_review"
      || operation.queueStatus === "blocked"
      || (operation.queueStatus === "processing" && !healthyProcessing);
  }).length;
  const rows: ClaimRow[] = currentClaims.map((claim) => ({
    id: claim.id,
    reference: claim.reference,
    orderId: claim.orderId,
    customerName: claim.customer.name,
    submittedAt: claim.submittedAt,
    itemSummary: claim.itemSummary,
    reasonLabel: claim.reasonLabel,
    sellerNames: claim.decision?.sellerReversals.map((reversal) => reversal.sellerName).join(" ") ?? "",
    ...(typeof claim.amountPaise === "number" ? { amountPaise: claim.amountPaise } : {}),
    liability: claim.review.liability,
    status: claim.status,
    statusLabel: claim.statusLabel,
    ...(claim.execution ? { execution: claim.execution } : {}),
    ...(() => {
      const recovery = recoveryByClaim.get(claim.id);
      return recovery ? {
        recovery: {
          status: recovery.status,
          outstandingAmountPaise: recovery.outstandingAmountPaise,
          responsibleParty: recovery.responsibleParty,
          dueAt: recovery.dueAt,
          ageHours: recovery.ageHours,
          overdue: recovery.overdue,
        },
      } : {};
    })(),
  }));

  const balanced = attention === 0;

  return (
    <div className="page">
      <PageHeader title="Claims" description="Review who funds each approved return before money moves." actions={<SyncProviderButton />} />
      <section className="welcome-card" aria-label="Queue summary">
        <div className="welcome-copy">
          <p className="eyebrow">Operator overview</p>
          <h2>{balanced ? "Every open work item is balanced." : `${attention} work item${attention === 1 ? "" : "s"} need${attention === 1 ? "s" : ""} attention.`}</h2>
          <p>
            <strong>{ready}</strong> ready to approve · <strong>{open.length}</strong> open across claims and post-refund recovery.
            Reversals stay behind human approval - nothing moves until you say so.
          </p>
        </div>
        <div className="welcome-mascot"><Mascot /></div>
      </section>
      <section className="metric-strip" aria-label="Queue overview">
        <div className="metric"><div className="metric-head"><span className="metric-label">Open work</span><span className="metric-ico"><Icon name="inbox" /></span></div><strong className="metric-value">{open.length}</strong><span className="metric-note">Claims and post-refund recovery</span></div>
        <div className="metric"><div className="metric-head"><span className="metric-label">Ready to approve</span><span className="metric-ico"><Icon name="circle-check" /></span></div><strong className="metric-value">{ready}</strong><span className="metric-note good">Calculation ready · balance check pending</span></div>
        <div className="metric"><div className="metric-head"><span className="metric-label">Needs attention</span><span className="metric-ico"><Icon name="circle-alert" /></span></div><strong className="metric-value">{attention}</strong><span className="metric-note">Review, retry, reconciliation, or recovery</span></div>
        <div className="metric"><div className="metric-head"><span className="metric-label">Platform exposure</span><span className="metric-ico"><Icon name="shield" /></span></div><strong className="metric-value"><Money paise={exposure} /></strong><span className="metric-note">Commitments plus outstanding recovery</span></div>
      </section>
      <ClaimsTable claims={rows} providerLabel={provider.mode === "demo" ? "Simulation" : "Razorpay Test Mode"} asOf={asOf} />
    </div>
  );
}
