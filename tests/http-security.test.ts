import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "../next.config";
import { POST as escalateClaim } from "../src/app/api/claims/[id]/escalate/route";
import { POST as updateRecovery } from "../src/app/api/claims/[id]/recovery/route";
import { POST as resetDemo } from "../src/app/api/demo/reset/route";
import { POST as receiveRazorpayWebhook } from "../src/app/api/webhooks/razorpay/route";
import {
  MAX_MUTATION_BODY_BYTES,
  MAX_WEBHOOK_BODY_BYTES,
  readBoundedJson,
  RequestBodyError,
} from "../src/server/http-request";
import { isSameOriginMutation } from "../src/server/mutation-request";

function postRequest(url: string, origin: string, body: string, contentType = "application/json") {
  return new Request(url, {
    method: "POST",
    headers: { origin, "content-type": contentType },
    body,
  });
}

test("mutation origin validation uses the exact configured origin instead of Host", () => {
  const priorOrigin = process.env.RETURNSPLIT_APP_ORIGIN;
  try {
    process.env.RETURNSPLIT_APP_ORIGIN = "https://returns.example";
    assert.equal(isSameOriginMutation(new Request("http://internal:3000/api/demo/reset", {
      method: "POST",
      headers: { host: "attacker.example", origin: "https://returns.example" },
    })), true);
    assert.equal(isSameOriginMutation(new Request("https://returns.example/api/demo/reset", {
      method: "POST",
      headers: { host: "returns.example", origin: "http://returns.example" },
    })), false);
    assert.equal(isSameOriginMutation(new Request("https://returns.example/api/demo/reset", {
      method: "POST",
      headers: { host: "returns.example", origin: "https://returns.example.evil.test" },
    })), false);
    assert.equal(isSameOriginMutation(new Request("https://returns.example/api/demo/reset", {
      method: "POST",
      headers: { host: "returns.example", origin: "https://returns.example/path" },
    })), false);
    process.env.RETURNSPLIT_APP_ORIGIN = "https://returns.example/allowed-path/..";
    assert.equal(isSameOriginMutation(new Request("https://returns.example/api/demo/reset", {
      method: "POST",
      headers: { origin: "https://returns.example" },
    })), false);
  } finally {
    if (priorOrigin === undefined) delete process.env.RETURNSPLIT_APP_ORIGIN;
    else process.env.RETURNSPLIT_APP_ORIGIN = priorOrigin;
  }
});

test("bounded JSON parsing rejects oversized streams and malformed JSON", async () => {
  await assert.rejects(
    readBoundedJson(postRequest("http://localhost/api/test", "http://localhost", "x".repeat(33)), 32),
    (error: unknown) => error instanceof RequestBodyError && error.status === 413,
  );
  await assert.rejects(
    readBoundedJson(postRequest("http://localhost/api/test", "http://localhost", "{"), 32),
    (error: unknown) => error instanceof RequestBodyError && error.status === 400,
  );
});

test("mutation and webhook routes return 413 without accepting oversized bodies", async () => {
  const resetResponse = await resetDemo(postRequest(
    "http://localhost/api/demo/reset",
    "http://localhost",
    JSON.stringify({ padding: "x".repeat(MAX_MUTATION_BODY_BYTES) }),
  ));
  assert.equal(resetResponse.status, 413);

  const escalationResponse = await escalateClaim(postRequest(
    "http://localhost/api/claims/RET-260903-038/escalate",
    "http://localhost",
    JSON.stringify({ kind: "evidence_request", rationale: "x".repeat(MAX_MUTATION_BODY_BYTES) }),
  ), { params: Promise.resolve({ id: "RET-260903-038" }) });
  assert.equal(escalationResponse.status, 413);

  const recoveryResponse = await updateRecovery(postRequest(
    "http://localhost/api/claims/RET-260903-035/recovery",
    "http://localhost",
    JSON.stringify({
      recoveredAmountPaise: 0,
      writtenOffAmountPaise: 0,
      responsibleParty: "courier",
      note: "x".repeat(MAX_MUTATION_BODY_BYTES),
      status: "open",
    }),
  ), { params: Promise.resolve({ id: "RET-260903-035" }) });
  assert.equal(recoveryResponse.status, 413);

  const webhookResponse = await receiveRazorpayWebhook(postRequest(
    "http://localhost/api/webhooks/razorpay",
    "https://api.razorpay.com",
    JSON.stringify({ padding: "x".repeat(MAX_WEBHOOK_BODY_BYTES) }),
  ));
  assert.equal(webhookResponse.status, 413);
});

test("recovery mutations reject requests without a verifiable same-origin context", async () => {
  const response = await updateRecovery(new Request("http://localhost/api/claims/RET-260903-035/recovery", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      recoveredAmountPaise: 0,
      writtenOffAmountPaise: 0,
      responsibleParty: "courier",
      note: "A sufficiently long recovery note.",
      status: "open",
    }),
  }), { params: Promise.resolve({ id: "RET-260903-035" }) });
  assert.equal(response.status, 403);
});

test("global responses receive browser hardening and APIs are non-cacheable", async () => {
  assert.equal(nextConfig.poweredByHeader, false);
  assert.ok(nextConfig.headers);
  const rules = await nextConfig.headers();
  const globalHeaders = new Map(rules[0].headers.map(({ key, value }) => [key.toLowerCase(), value]));
  const apiHeaders = new Map(rules[1].headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(globalHeaders.get("x-content-type-options"), "nosniff");
  assert.equal(globalHeaders.get("x-frame-options"), "DENY");
  assert.match(globalHeaders.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(apiHeaders.get("cache-control"), "private, no-store, max-age=0");
});
