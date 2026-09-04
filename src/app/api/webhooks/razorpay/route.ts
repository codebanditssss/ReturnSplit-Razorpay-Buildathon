import { getDemoRuntime } from "@/server/demo-runtime";
import { isJsonContentType, MAX_WEBHOOK_BODY_BYTES, readBoundedBody, RequestBodyError } from "@/server/http-request";
import { sha256, verifyRazorpaySignature } from "@/server/webhook-security";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!isJsonContentType(request)) {
    return Response.json({ error: "Webhook must use application/json" }, { status: 415 });
  }

  let rawBody: Uint8Array;
  try {
    rawBody = await readBoundedBody(request, MAX_WEBHOOK_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Webhook body could not be read" }, { status: 400 });
  }

  const signature = request.headers.get("x-razorpay-signature") ?? "";
  const eventId = request.headers.get("x-razorpay-event-id")?.trim() ?? "";
  const secrets = [process.env.RAZORPAY_WEBHOOK_SECRET_CURRENT, process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS]
    .filter((value): value is string => Boolean(value));
  if (!eventId || !verifyRazorpaySignature(rawBody, signature, secrets)) {
    return Response.json({ error: "Invalid webhook" }, { status: 401 });
  }

  let eventType = "unknown";
  try {
    const parsed = JSON.parse(new TextDecoder().decode(rawBody)) as { event?: unknown };
    if (typeof parsed.event === "string" && parsed.event.length <= 100) eventType = parsed.event;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { provider, webhookInbox } = getDemoRuntime();
  const result = webhookInbox.admit({
    providerEventId: `${provider.mode}:${eventId}`,
    eventType,
    bodyFingerprint: `sha256:${sha256(rawBody)}`,
    receivedAt: new Date().toISOString(),
    signatureVerified: true,
  });

  if (result.outcome === "id_conflict") {
    return Response.json({ error: "Event ID payload conflict" }, { status: 409 });
  }
  return Response.json({ accepted: result.outcome === "accepted", duplicate: result.outcome === "duplicate" }, { status: result.outcome === "accepted" ? 202 : 200 });
}
