import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { sha256, verifyRazorpaySignature } from "../src/server/webhook-security";

test("webhook signatures verify against current or previous rotation secret", () => {
  const body = new TextEncoder().encode('{"event":"refund.processed"}');
  const signature = createHmac("sha256", "previous-secret").update(body).digest("hex");
  assert.equal(verifyRazorpaySignature(body, signature, ["current-secret", "previous-secret"]), true);
  assert.equal(verifyRazorpaySignature(body, signature, ["current-secret"]), false);
});

test("webhook signature comparison rejects malformed and tampered values", () => {
  const body = new TextEncoder().encode('{"event":"refund.processed"}');
  const signature = createHmac("sha256", "secret").update(body).digest("hex");
  assert.equal(verifyRazorpaySignature(new TextEncoder().encode("tampered"), signature, ["secret"]), false);
  assert.equal(verifyRazorpaySignature(body, "not-hex", ["secret"]), false);
  assert.equal(sha256(body).length, 64);
});
