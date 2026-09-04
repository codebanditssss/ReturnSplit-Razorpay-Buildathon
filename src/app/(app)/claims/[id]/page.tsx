import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClaimWorkbench } from "@/components/claim-workbench";
import { redactExecutionReceipt, toClaimWorkbenchView } from "@/lib/claim-workbench-view";
import { activityEvents, getOrderById, getPolicyById } from "@/lib/data";
import { refundPlanFingerprint } from "@/lib/execution-saga";
import { getDemoClaimCompletion, getDemoClaimView, getDemoEscalation, getDemoSessionActivity, getProviderIdentity } from "@/server/demo-runtime";

export const dynamic = "force-dynamic";

type ClaimPageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: ClaimPageProps): Promise<Metadata> {
  const { id } = await params;
  const claim = await getDemoClaimView(id);
  return { title: claim ? `Return claim ${claim.reference}` : "Claim not found" };
}

export default async function ClaimPage({ params }: ClaimPageProps) {
  const { id } = await params;
  const claim = await getDemoClaimView(id);
  if (!claim) notFound();
  const order = getOrderById(claim.orderId);
  if (!order) notFound();
  const policy = getPolicyById(order.policyId);
  if (!policy) notFound();
  const completion = getDemoClaimCompletion(claim.id);
  const provider = getProviderIdentity();
  const reviewEvents = [...activityEvents, ...getDemoSessionActivity()].filter((event) => event.claimId === claim.id);
  const view = toClaimWorkbenchView(claim, order, policy, reviewEvents);
  return <ClaimWorkbench
    claim={view.claim}
    order={view.order}
    policy={view.policy}
    planFingerprint={claim.decision ? refundPlanFingerprint(claim.decision) : undefined}
    initialReceipt={completion ? redactExecutionReceipt(completion) : undefined}
    initialEscalation={getDemoEscalation(claim.id)}
    reviewEvents={view.reviewEvents}
    providerMode={provider.mode}
    providerLabel={provider.label}
  />;
}
