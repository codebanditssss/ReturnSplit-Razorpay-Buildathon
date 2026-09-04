import { NextResponse } from "next/server";
import { MAX_MUTATION_BODY_BYTES, readBoundedJson, RequestBodyError } from "@/server/http-request";
import { isSameOriginMutation, mutationRequestId } from "@/server/mutation-request";
import { resolveDemoClaimReview, type DemoReviewDecision } from "@/server/demo-runtime";

type RouteContext = { params: Promise<{ id: string }> };

function parseDecision(value: unknown): DemoReviewDecision | undefined {
  if (!value || typeof value !== "object") return undefined;
  const body = value as Record<string, unknown>;
  if (body.kind === "item_match" && typeof body.returnedItemId === "string" && typeof body.orderLineId === "string") {
    return { kind: "item_match", returnedItemId: body.returnedItemId, orderLineId: body.orderLineId };
  }
  if (body.kind === "liability" && (body.liability === "seller" || body.liability === "marketplace")) {
    return { kind: "liability", liability: body.liability };
  }
  return undefined;
}

export async function POST(request: Request, { params }: RouteContext) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Cross-origin review decisions are not accepted" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await readBoundedJson(request, MAX_MUTATION_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Review decision body is not valid JSON" }, { status: 400 });
  }
  const decision = parseDecision(body);
  if (!decision) return NextResponse.json({ error: "Review decision is missing or invalid" }, { status: 400 });

  const { id } = await params;
  try {
    const resolution = resolveDemoClaimReview(id, decision, mutationRequestId(request, "review"));
    return NextResponse.json({
      claimId: resolution.claim.id,
      status: resolution.claim.status,
      statusLabel: resolution.claim.statusLabel,
      planFingerprint: resolution.planFingerprint,
      sellerReversalCount: resolution.claim.decision?.sellerReversals.length ?? 0,
      customerRefundPaise: resolution.claim.decision?.customerRefundPaise,
      eventId: resolution.event.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review could not be saved";
    return NextResponse.json({ error: message }, { status: message === "Claim not found" ? 404 : 409 });
  }
}
