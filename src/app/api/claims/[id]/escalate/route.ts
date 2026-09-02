import { NextResponse } from "next/server";
import { escalateDemoClaim, toDemoEscalationReceipt, type DemoEscalationInput } from "@/server/demo-runtime";
import { MAX_MUTATION_BODY_BYTES, readBoundedJson, RequestBodyError } from "@/server/http-request";
import { isSameOriginMutation, mutationRequestId } from "@/server/mutation-request";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Cross-origin escalation requests are not accepted" }, { status: 403 });
  }
  let input: DemoEscalationInput = {};
  if (request.body) {
    try {
      const body = await readBoundedJson(request, MAX_MUTATION_BODY_BYTES) as Record<string, unknown>;
      if (body.kind !== "evidence_request" || typeof body.rationale !== "string") {
        return NextResponse.json({ error: "Evidence requests require a written rationale" }, { status: 400 });
      }
      input = { kind: "evidence_request", rationale: body.rationale };
    } catch (error) {
      if (error instanceof RequestBodyError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      return NextResponse.json({ error: "Escalation body could not be read" }, { status: 400 });
    }
  }
  const { id } = await params;
  try {
    const escalation = await escalateDemoClaim(id, mutationRequestId(request, "escalate"), input);
    return NextResponse.json(toDemoEscalationReceipt(escalation));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Escalation could not be created";
    return NextResponse.json({ error: message }, { status: message === "Claim not found" ? 404 : 409 });
  }
}
