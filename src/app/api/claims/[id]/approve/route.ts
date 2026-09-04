import { NextResponse } from "next/server";
import { maskProviderReference } from "@/lib/claim-workbench-view";
import { getOrderById, getPolicyById } from "@/lib/data";
import { executeApprovedRefund, refundPlanFingerprint } from "@/lib/execution-saga";
import { getDemoPreflight, getDemoRuntime, getDemoWorkflowClaim, recordDemoClaimCompletion } from "@/server/demo-runtime";
import { MAX_MUTATION_BODY_BYTES, readBoundedJson, RequestBodyError } from "@/server/http-request";
import { isSameOriginMutation, mutationRequestId } from "@/server/mutation-request";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Cross-origin approval requests are not accepted" }, { status: 403 });
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
    return NextResponse.json({ error: "Approval body is not valid JSON" }, { status: 400 });
  }
  if (!expectedPlanFingerprint) {
    return NextResponse.json({ error: "The reviewed plan fingerprint is required" }, { status: 400 });
  }

  const { id } = await params;
  const claim = getDemoWorkflowClaim(id);
  if (!claim?.decision) return NextResponse.json({ error: "This claim has no executable plan" }, { status: 409 });
  if (claim.status !== "ready_for_approval" && claim.status !== "processing") {
    return NextResponse.json({ error: "This claim is not executable" }, { status: 409 });
  }
  const actualPlanFingerprint = refundPlanFingerprint(claim.decision);
  if (expectedPlanFingerprint !== actualPlanFingerprint) {
    return NextResponse.json({ error: "The claim changed after it was reviewed. Reload and approve the new plan." }, { status: 409 });
  }
  const order = getOrderById(claim.orderId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const policy = getPolicyById(order.policyId);
  if (!policy) return NextResponse.json({ error: "The order's frozen policy was not found" }, { status: 409 });

  const { provider, demoProvider, store } = getDemoRuntime();
  if (provider.mode === "razorpay_test" && (order.paymentId.includes("demo") || claim.decision.sellerReversals.some((reversal) => reversal.providerTransferId.includes("demo")))) {
    return NextResponse.json({ error: "Seeded demo payment IDs cannot be sent to Razorpay Test Mode. Import matching Test Mode fixtures first." }, { status: 409 });
  }
  try {
    const existingSaga = await store.findByClaimId(claim.id);
    if (!existingSaga && claim.status === "ready_for_approval") {
      const preflight = getDemoPreflight(claim.id);
      const expiresAt = preflight ? Date.parse(preflight.expiresAt) : Number.NaN;
      if (
        !preflight
        || preflight.outcome !== "verified"
        || preflight.planFingerprint !== actualPlanFingerprint
        || preflight.providerMode !== provider.mode
        || !Number.isFinite(expiresAt)
        || expiresAt <= Date.now()
      ) {
        return NextResponse.json({ error: "A current verified provider balance check is required before approval." }, { status: 409 });
      }
    }
    const executionOrder = claim.status === "processing"
      ? {
          ...order,
          refundedPaymentPaise: 0,
          transfers: order.transfers.map((transfer) => ({ ...transfer, reversedAmountPaise: 0, status: "processed" as const })),
        }
      : order;
    if (claim.status === "processing" && !existingSaga) {
      if (!demoProvider) throw new Error("The seeded retry scenario is available only with the demo provider");
      const failedTransfer = claim.decision.sellerReversals.find((reversal) => reversal.sellerName === "Field Notes");
      if (!failedTransfer) throw new Error("Retry fixture has no remaining reversal");
      demoProvider.queueFault(`saga_${claim.id}:reversal:${failedTransfer.transferId}`, "fail_retryable");
      const seeded = await executeApprovedRefund({
        plan: claim.decision,
        order: executionOrder,
        policy,
        provider,
        store,
        approval: {
          actorId: "demo_operator_neha",
          actorName: "Neha Kapoor",
          requestId: claim.execution?.requestId ?? `seed_${claim.id}`,
          approvedAt: claim.approvedAt,
        },
      });
      if (seeded.state !== "failed") throw new Error("Could not reconstruct the retry-safe demo state");
    }
    const saga = await executeApprovedRefund({
      plan: claim.decision,
      order: executionOrder,
      policy,
      provider,
      store,
      approval: {
        actorId: "demo_operator_khushi",
        actorName: "Khushi Diwan",
        requestId: mutationRequestId(request, "approve"),
      },
    });
    if (saga.state === "completed") {
      recordDemoClaimCompletion(claim.id, {
        approvedAt: saga.approval.approvedAt,
        completedAt: saga.completedAt ?? new Date().toISOString(),
        requestId: saga.lastRequestId,
        planFingerprint: saga.planFingerprint,
        refundId: saga.refund.providerId ?? "unknown",
        reversals: saga.reversals.map((step) => ({ transferId: step.transferId, providerId: step.providerId ?? "unknown", amountPaise: step.amountPaise })),
      });
    }
    const incompleteStep = [...saga.reversals, saga.refund].find((step) => step.status !== "succeeded");
    const canResume = incompleteStep?.status === "retryable_failure";
    const requiresReconciliation = saga.state === "reversal_result_unknown" || saga.state === "refund_result_unknown";
    const action = saga.state === "completed"
      ? "completed"
      : requiresReconciliation
        ? "reconcile"
        : canResume
          ? "retry"
          : saga.state === "failed"
            ? "manual_intervention"
            : "in_progress";
    const message = action === "reconcile"
      ? "The provider result is not final. Check provider state again before continuing."
      : action === "retry"
        ? "The provider rejected this step temporarily. Confirmed operations will be skipped on retry."
        : action === "manual_intervention"
          ? "The provider rejected this operation. Automatic execution is stopped."
          : action === "in_progress"
            ? "The approved money movement is still in progress."
            : undefined;
    return NextResponse.json({
      claimId: claim.id,
      sagaId: saga.id,
      state: saga.state,
      providerMode: saga.providerMode,
      planFingerprint: saga.planFingerprint,
      reversalCount: saga.reversals.filter((step) => step.status === "succeeded").length,
      refundStatus: saga.refund.status,
      auditEvents: saga.audit.length,
      completedAt: saga.completedAt,
      requestId: saga.lastRequestId,
      refundId: maskProviderReference(saga.refund.providerId),
      reversals: saga.reversals.map((step) => ({ transferId: step.transferId, providerId: maskProviderReference(step.providerId), amountPaise: step.amountPaise })),
      action,
      canResume,
      requiresReconciliation,
      lastError: incompleteStep?.errorMessage,
      message,
    }, { status: saga.state === "completed" ? 200 : requiresReconciliation || action === "in_progress" ? 202 : 409 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Execution failed safely" }, { status: 409 });
  }
}
