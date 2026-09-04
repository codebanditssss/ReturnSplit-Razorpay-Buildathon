import type { Metadata } from "next";
import { ClaimsTable, type ClaimRow } from "@/components/claims-table";
import { Money, PageHeader } from "@/components/ui";
import { SyncProviderButton } from "@/components/sync-provider-button";
import { claimOperationPresentation } from "@/lib/claim-operation-presentation";
import { getDemoClaimsView, getProviderIdentity } from "@/server/demo-runtime";

export const metadata: Metadata = { title: "Claims" };
export const dynamic = "force-dynamic";

export default async function ClaimsPage() {
  const currentClaims = await getDemoClaimsView();
  const asOf = new Date().toISOString();
  const provider = getProviderIdentity();
  const open = currentClaims.filter((claim) => claim.status !== "completed");
  const exposure = open.reduce((sum, claim) => sum + (claim.decision?.marketplaceFundedPaise ?? 0), 0);
  const ready = open.filter((claim) => claim.status === "ready_for_approval").length;
  const attention = open.filter((claim) => {
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
  }));

  return (
    <div className="page">
      <PageHeader title="Claims" description="Review who funds each approved return before money moves." actions={<SyncProviderButton />} />
      <section className="metric-strip" aria-label="Queue overview">
        <div className="metric"><span className="metric-label">Open claims</span><strong className="metric-value">{open.length}</strong><span className="metric-note">Across 4 return states</span></div>
        <div className="metric"><span className="metric-label">Ready to approve</span><strong className="metric-value">{ready}</strong><span className="metric-note good">Calculation ready · balance check pending</span></div>
        <div className="metric"><span className="metric-label">Needs attention</span><strong className="metric-value">{attention}</strong><span className="metric-note">Review, retry, or reconciliation</span></div>
        <div className="metric"><span className="metric-label">Platform contribution</span><strong className="metric-value"><Money paise={exposure} /></strong><span className="metric-note">Across calculated open claims</span></div>
      </section>
      <ClaimsTable claims={rows} providerLabel={provider.mode === "demo" ? "Simulation" : "Razorpay Test Mode"} asOf={asOf} />
    </div>
  );
}
