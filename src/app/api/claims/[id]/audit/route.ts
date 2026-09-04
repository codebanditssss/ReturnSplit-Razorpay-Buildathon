import { activityEvents, getOrderById, getPolicyById } from "@/lib/data";
import { buildClaimAuditBundle } from "@/lib/claim-audit-bundle";
import {
  getDemoClaimCompletion,
  getDemoClaimView,
  getDemoEscalation,
  getDemoRuntime,
  getDemoSessionActivity,
  getProviderIdentity,
} from "@/server/demo-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
  const { id } = await params;
  const claim = await getDemoClaimView(id);
  if (!claim) return Response.json({ error: "Claim not found" }, { status: 404 });

  const order = getOrderById(claim.orderId);
  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
  const policy = getPolicyById(order.policyId);
  if (!policy) return Response.json({ error: "Policy not found" }, { status: 409 });

  const saga = await getDemoRuntime().store.findByClaimId(claim.id);
  const completion = getDemoClaimCompletion(claim.id);
  const escalation = getDemoEscalation(claim.id);
  const bundle = buildClaimAuditBundle({
    claim,
    order,
    policy,
    provider: getProviderIdentity(),
    activity: [...activityEvents, ...getDemoSessionActivity()],
    ...(saga ? { saga } : {}),
    ...(completion ? { completion } : {}),
    ...(escalation ? { escalation } : {}),
  });
  const safeReference = claim.reference.replace(/[^a-zA-Z0-9_-]/g, "_");

  return new Response(`${JSON.stringify(bundle, null, 2)}\n`, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `attachment; filename="${safeReference}-audit.json"`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
