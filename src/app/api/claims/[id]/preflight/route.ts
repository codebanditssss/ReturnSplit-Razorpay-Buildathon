import { NextResponse } from "next/server";
import { getOrderById } from "@/lib/data";
import { refundPlanFingerprint, verifyRefundPlanProviderSnapshot } from "@/lib/execution-saga";
import { getDemoRuntime, getDemoWorkflowClaim, recordDemoClaimPreflight } from "@/server/demo-runtime";
import { MAX_MUTATION_BODY_BYTES, readBoundedJson, RequestBodyError } from "@/server/http-request";
import { isSameOriginMutation, mutationRequestId } from "@/server/mutation-request";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Cross-origin provider checks are not accepted" }, { status: 403 });
  }

  let expectedPlanFingerprint: string | undefined;
  try {
    const body = await readBoundedJson(request, MAX_MUTATION_BODY_BYTES) as { expectedPlanFingerprint?: unknown };
    if (typeof body.expectedPlanFingerprint === "string" && /^[a-f0-9]{64}$/.test(body.expectedPlanFingerprint)) {
      expectedPlanFingerprint = body.expectedPlanFingerprint;
    }
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Provider-check body is not valid JSON" }, { status: 400 });
  }
  if (!expectedPlanFingerprint) {
    return NextResponse.json({ error: "The reviewed plan fingerprint is required" }, { status: 400 });
  }

  const { id } = await params;
  const claim = getDemoWorkflowClaim(id);
  if (!claim?.decision || claim.status !== "ready_for_approval") {
    return NextResponse.json({ error: "This claim has no plan awaiting approval" }, { status: 409 });
  }
  if (refundPlanFingerprint(claim.decision) !== expectedPlanFingerprint) {
    return NextResponse.json({ error: "The claim changed after it was reviewed. Reload before checking balances." }, { status: 409 });
  }
  const order = getOrderById(claim.orderId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const { provider } = getDemoRuntime();
  if (provider.mode === "razorpay_test" && (claim.decision.paymentId.includes("demo") || claim.decision.sellerReversals.some((reversal) => reversal.providerTransferId.includes("demo")))) {
    return NextResponse.json({ error: "Seeded demo IDs cannot be checked against Razorpay Test Mode." }, { status: 409 });
  }

  const result = await verifyRefundPlanProviderSnapshot(claim.decision, order, provider);
  const record = recordDemoClaimPreflight({
    claimId: claim.id,
    planFingerprint: expectedPlanFingerprint,
    result,
    requestId: mutationRequestId(request, "preflight"),
  });
  if (result.outcome === "verified") {
    return NextResponse.json({
      status: "verified",
      checkedAt: record.checkedAt,
      expiresAt: record.expiresAt,
      providerMode: provider.mode,
      expectedPaymentRemainingPaise: record.expectedPaymentRemainingPaise,
      expectedTransferRemainingPaise: record.expectedTransferRemainingPaise,
    });
  }
  return NextResponse.json(
    { status: result.outcome, checkedAt: record.checkedAt, expiresAt: record.expiresAt, error: result.message },
    { status: result.outcome === "mismatch" ? 409 : 503 },
  );
}
