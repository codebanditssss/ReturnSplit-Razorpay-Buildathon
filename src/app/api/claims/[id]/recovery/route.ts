import { NextResponse } from "next/server";
import {
  toDemoEscalationReceipt,
  updateDemoRecoveryCase,
  type DemoRecoveryUpdateInput,
} from "@/server/demo-runtime";
import { MAX_MUTATION_BODY_BYTES, readBoundedJson, RequestBodyError } from "@/server/http-request";
import { isSameOriginMutation, mutationRequestId } from "@/server/mutation-request";

type RouteContext = { params: Promise<{ id: string }> };

function parseRecoveryUpdate(value: unknown): DemoRecoveryUpdateInput | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  if (
    typeof body.recoveredAmountPaise !== "number"
    || !Number.isSafeInteger(body.recoveredAmountPaise)
    || body.recoveredAmountPaise < 0
    || typeof body.writtenOffAmountPaise !== "number"
    || !Number.isSafeInteger(body.writtenOffAmountPaise)
    || body.writtenOffAmountPaise < 0
    || (body.responsibleParty !== "seller" && body.responsibleParty !== "courier" && body.responsibleParty !== "marketplace")
    || typeof body.note !== "string"
    || (body.status !== "open" && body.status !== "closed")
  ) {
    return undefined;
  }
  return {
    recoveredAmountPaise: body.recoveredAmountPaise,
    writtenOffAmountPaise: body.writtenOffAmountPaise,
    responsibleParty: body.responsibleParty,
    note: body.note,
    status: body.status,
  };
}

export async function POST(request: Request, { params }: RouteContext) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Cross-origin recovery updates are not accepted" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await readBoundedJson(request, MAX_MUTATION_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Recovery update body is not valid JSON" }, { status: 400 });
  }
  const input = parseRecoveryUpdate(body);
  if (!input) {
    return NextResponse.json({ error: "Recovery totals, responsible party, note, and status are required" }, { status: 400 });
  }

  const { id } = await params;
  try {
    const recoveryCase = updateDemoRecoveryCase(id, mutationRequestId(request, "recovery"), input);
    return NextResponse.json(toDemoEscalationReceipt(recoveryCase));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recovery case could not be updated";
    return NextResponse.json({ error: message }, { status: message === "Claim not found" ? 404 : 409 });
  }
}
