import { NextResponse } from "next/server";
import { getProviderIdentity, resetDemoRuntime } from "@/server/demo-runtime";
import { isJsonContentType, MAX_MUTATION_BODY_BYTES, readBoundedBody, readBoundedJson, RequestBodyError } from "@/server/http-request";
import { isSameOriginMutation } from "@/server/mutation-request";

const scenarios = {
  golden_path: "/claims/RET-260903-031",
  item_review: "/claims/RET-260903-033",
  liability_review: "/claims/RET-260903-035",
  blocked_reconciliation: "/claims/RET-260903-038",
  retry_recovery: "/claims/RET-260903-041",
} as const;

type Scenario = keyof typeof scenarios;

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Cross-origin reset requests are not accepted" }, { status: 403 });
  }
  if (getProviderIdentity().mode !== "demo") {
    return NextResponse.json({ error: "Demo reset is unavailable while Razorpay Test Mode is selected" }, { status: 409 });
  }
  let scenario: Scenario = "golden_path";
  try {
    if (isJsonContentType(request)) {
      const body = await readBoundedJson(request, MAX_MUTATION_BODY_BYTES) as { scenario?: unknown };
      if (typeof body.scenario === "string" && body.scenario in scenarios) scenario = body.scenario as Scenario;
      else if (body.scenario !== undefined) return NextResponse.json({ error: "Unknown demo scenario" }, { status: 400 });
    } else {
      const body = await readBoundedBody(request, MAX_MUTATION_BODY_BYTES);
      if (body.byteLength > 0) {
        return NextResponse.json({ error: "Request body must use application/json" }, { status: 415 });
      }
    }
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Reset body is not valid JSON" }, { status: 400 });
  }
  resetDemoRuntime();
  return NextResponse.json({ ok: true, scenario, startPath: scenarios[scenario] });
}
