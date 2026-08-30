import assert from "node:assert/strict";
import test from "node:test";

import { POST as approveClaim } from "../src/app/api/claims/[id]/approve/route";
import { POST as resetDemo } from "../src/app/api/demo/reset/route";
import { getDemoClaimView, getProviderIdentity, resetDemoRuntime } from "../src/server/demo-runtime";
import { refundPlanFingerprint } from "../src/lib/execution-saga";

test("the runtime can select Test Mode while barring seeded demo IDs from external requests", async () => {
  const previousMode = process.env.RETURNSPLIT_PROVIDER_MODE;
  const previousKeyId = process.env.RAZORPAY_KEY_ID;
  const previousSecret = process.env.RAZORPAY_KEY_SECRET;
  try {
    process.env.RETURNSPLIT_PROVIDER_MODE = "razorpay_test";
    process.env.RAZORPAY_KEY_ID = "rzp_test_runtime_contract";
    process.env.RAZORPAY_KEY_SECRET = "not-a-real-secret";
    resetDemoRuntime();
    assert.deepEqual(getProviderIdentity(), { mode: "razorpay_test", label: "Razorpay Test Mode", isLive: false });

    const id = "RET-260903-031";
    const claim = await getDemoClaimView(id);
    assert.ok(claim?.decision);
    const response = await approveClaim(new Request(`http://localhost/api/claims/${id}/approve`, {
      method: "POST",
      headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ expectedPlanFingerprint: refundPlanFingerprint(claim.decision) }),
    }), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 409);
    assert.match((await response.json() as { error: string }).error, /demo payment IDs cannot be sent/i);

    const resetResponse = await resetDemo(new Request("http://localhost/api/demo/reset", {
      method: "POST",
      headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ scenario: "golden_path" }),
    }));
    assert.equal(resetResponse.status, 409);
    assert.match((await resetResponse.json() as { error: string }).error, /unavailable.*Test Mode/i);
  } finally {
    if (previousMode === undefined) delete process.env.RETURNSPLIT_PROVIDER_MODE;
    else process.env.RETURNSPLIT_PROVIDER_MODE = previousMode;
    if (previousKeyId === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = previousKeyId;
    if (previousSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = previousSecret;
    resetDemoRuntime();
  }
});
