import assert from "node:assert/strict";
import test from "node:test";

import { createRazorpayTestProvider, DemoRouteProvider } from "../src/lib/provider";

test("demo provider verifies the exact payment and transfer balances bound to a plan", async () => {
  const provider = new DemoRouteProvider({ payments: { pay_1: 900 }, transfers: { trf_1: 300 } });
  const verified = await provider.verifyRefundCapacity({
    paymentId: "pay_1",
    expectedCapturedPaymentPaise: 900,
    expectedRefundedPaymentPaise: 0,
    expectedRemainingRefundablePaise: 900,
    transfers: [{
      providerTransferId: "trf_1",
      expectedSourcePaymentId: "pay_1",
      expectedLinkedAccountId: "acc_1",
      expectedOriginalAmountPaise: 300,
      expectedReversedAmountPaise: 0,
      expectedRemainingReversiblePaise: 300,
    }],
  });
  assert.deepEqual(verified, { outcome: "verified" });

  await provider.reverseTransfer({ providerTransferId: "trf_1", amountPaise: 1, receipt: "external_change", idempotencyKey: "external_change", notes: {} });
  const stale = await provider.verifyRefundCapacity({
    paymentId: "pay_1",
    expectedCapturedPaymentPaise: 900,
    expectedRefundedPaymentPaise: 0,
    expectedRemainingRefundablePaise: 900,
    transfers: [{
      providerTransferId: "trf_1",
      expectedSourcePaymentId: "pay_1",
      expectedLinkedAccountId: "acc_1",
      expectedOriginalAmountPaise: 300,
      expectedReversedAmountPaise: 0,
      expectedRemainingReversiblePaise: 300,
    }],
  });
  assert.equal(stale.outcome, "mismatch");
});

test("test adapter refreshes authoritative payment and transfer balances", async () => {
  const calls: string[] = [];
  const provider = createRazorpayTestProvider({
    keyId: "rzp_test_example",
    keySecret: "secret",
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const body = url.includes("/payments/")
        ? { id: "pay_1", entity: "payment", amount: 1_000, amount_refunded: 100, currency: "INR", captured: true }
        : { id: "trf_1", entity: "transfer", source: "pay_1", recipient: "acc_1", amount: 500, amount_reversed: 200, currency: "INR", status: "partially_reversed" };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch,
  });

  const verified = await provider.verifyRefundCapacity({
    paymentId: "pay_1",
    expectedCapturedPaymentPaise: 1_000,
    expectedRefundedPaymentPaise: 100,
    expectedRemainingRefundablePaise: 900,
    transfers: [{
      providerTransferId: "trf_1",
      expectedSourcePaymentId: "pay_1",
      expectedLinkedAccountId: "acc_1",
      expectedOriginalAmountPaise: 500,
      expectedReversedAmountPaise: 200,
      expectedRemainingReversiblePaise: 300,
    }],
  });
  assert.deepEqual(verified, { outcome: "verified" });
  assert.deepEqual(calls.map((url) => new URL(url).pathname), ["/v1/payments/pay_1", "/v1/transfers/trf_1"]);

  const stale = await provider.verifyRefundCapacity({
    paymentId: "pay_1",
    expectedCapturedPaymentPaise: 999,
    expectedRefundedPaymentPaise: 100,
    expectedRemainingRefundablePaise: 899,
    transfers: [],
  });
  assert.equal(stale.outcome, "mismatch");
});

test("test adapter rejects snapshots whose components or routing identity changed", async () => {
  const paymentDriftProvider = createRazorpayTestProvider({
    keyId: "rzp_test_example",
    keySecret: "secret",
    fetchImpl: (async () => new Response(JSON.stringify({
      id: "pay_1",
      entity: "payment",
      amount: 1_100,
      amount_refunded: 200,
      currency: "INR",
      captured: true,
    }), { status: 200 })) as typeof fetch,
  });
  const paymentDrift = await paymentDriftProvider.verifyRefundCapacity({
    paymentId: "pay_1",
    expectedCapturedPaymentPaise: 1_000,
    expectedRefundedPaymentPaise: 100,
    expectedRemainingRefundablePaise: 900,
    transfers: [],
  });
  assert.equal(paymentDrift.outcome, "mismatch");

  const transferDriftProvider = createRazorpayTestProvider({
    keyId: "rzp_test_example",
    keySecret: "secret",
    fetchImpl: (async (input: RequestInfo | URL) => {
      const body = String(input).includes("/payments/")
        ? { id: "pay_1", entity: "payment", amount: 1_000, amount_refunded: 100, currency: "INR", captured: true }
        : {
            id: "trf_1",
            entity: "transfer",
            source: "pay_wrong",
            recipient: "acc_wrong",
            amount: 600,
            amount_reversed: 300,
            currency: "INR",
            status: "failed",
          };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch,
  });
  const transferDrift = await transferDriftProvider.verifyRefundCapacity({
    paymentId: "pay_1",
    expectedCapturedPaymentPaise: 1_000,
    expectedRefundedPaymentPaise: 100,
    expectedRemainingRefundablePaise: 900,
    transfers: [{
      providerTransferId: "trf_1",
      expectedSourcePaymentId: "pay_1",
      expectedLinkedAccountId: "acc_1",
      expectedOriginalAmountPaise: 500,
      expectedReversedAmountPaise: 200,
      expectedRemainingReversiblePaise: 300,
    }],
  });
  assert.equal(transferDrift.outcome, "unknown");
});

test("test adapter uses the documented refund idempotency header only for refunds", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const requestBody = JSON.parse(String(init?.body)) as { amount: number; receipt?: string; notes?: Record<string, string> };
    const body = url.includes("/transfers/")
      ? { id: "rvrsl_1", entity: "reversal", transfer_id: "trf_1", amount: requestBody.amount, currency: "INR" }
      : { id: "rfnd_1", entity: "refund", payment_id: "pay_1", amount: requestBody.amount, currency: "INR", receipt: requestBody.receipt, status: "processed" };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const provider = createRazorpayTestProvider({ keyId: "rzp_test_example", keySecret: "secret", fetchImpl: fakeFetch });

  await provider.reverseTransfer({
    providerTransferId: "trf_1",
    amountPaise: 100,
    receipt: "rs_reverse",
    idempotencyKey: "reverse-key",
    notes: {},
  });
  await provider.createRefund({
    paymentId: "pay_1",
    amountPaise: 100,
    receipt: "rs_refund",
    idempotencyKey: "refund-key",
    notes: {},
  });

  assert.equal(new Headers(calls[0].init?.headers).get("X-Refund-Idempotency"), null);
  assert.equal(new Headers(calls[1].init?.headers).get("X-Refund-Idempotency"), "refund-key");
});

test("test adapter treats network and server errors as unknown outcomes", async () => {
  const provider = createRazorpayTestProvider({
    keyId: "rzp_test_example",
    keySecret: "secret",
    fetchImpl: (async () => new Response(JSON.stringify({ error: { description: "internal" } }), { status: 500 })) as typeof fetch,
  });
  const result = await provider.createRefund({
    paymentId: "pay_1",
    amountPaise: 100,
    receipt: "rs_refund",
    idempotencyKey: "refund-key",
    notes: {},
  });
  assert.equal(result.outcome, "unknown");
});

test("test adapter bounds provider calls and preserves unknown mutation finality on timeout", async () => {
  let observedSignal: AbortSignal | undefined;
  const provider = createRazorpayTestProvider({
    keyId: "rzp_test_example",
    keySecret: "secret",
    requestTimeoutMs: 20,
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    }) as typeof fetch,
  });

  const result = await provider.createRefund({
    paymentId: "pay_1",
    amountPaise: 100,
    receipt: "rs_refund",
    idempotencyKey: "refund-timeout-key",
    notes: {},
  });

  assert.equal(result.outcome, "unknown");
  if (result.outcome === "unknown") assert.match(result.message, /timed out.*finality is unknown/i);
  assert.equal(observedSignal?.aborted, true);
});

test("test adapter fails closed when a mutation is not final or does not match the request", async () => {
  const responses = [
    { id: "rvrsl_pending", entity: "reversal", transfer_id: "trf_1", amount: 100, currency: "INR", status: "pending" },
    { id: "rfnd_pending", entity: "refund", payment_id: "pay_1", amount: 100, currency: "INR", receipt: "rs_refund", status: "pending" },
    { id: "rfnd_wrong", entity: "refund", payment_id: "pay_1", amount: 101, currency: "INR", receipt: "rs_refund", status: "processed" },
  ];
  const provider = createRazorpayTestProvider({
    keyId: "rzp_test_example",
    keySecret: "secret",
    fetchImpl: (async () => new Response(JSON.stringify(responses.shift()), { status: 200 })) as typeof fetch,
  });
  const reversal = await provider.reverseTransfer({ providerTransferId: "trf_1", amountPaise: 100, receipt: "rs_reverse", idempotencyKey: "reverse-key", notes: {} });
  const pendingRefund = await provider.createRefund({ paymentId: "pay_1", amountPaise: 100, receipt: "rs_refund", idempotencyKey: "refund-key-1", notes: {} });
  const mismatchedRefund = await provider.createRefund({ paymentId: "pay_1", amountPaise: 100, receipt: "rs_refund", idempotencyKey: "refund-key-2", notes: {} });
  assert.equal(reversal.outcome, "unknown");
  assert.equal(pendingRefund.outcome, "unknown");
  assert.equal(mismatchedRefund.outcome, "unknown");
});

test("test adapter paginates reconciliation and binds a result to immutable fields", async () => {
  const urls: string[] = [];
  const decoys = Array.from({ length: 100 }, (_, index) => ({
    id: `rfnd_decoy_${index}`,
    entity: "refund",
    payment_id: "pay_1",
    amount: 100,
    currency: "INR",
    receipt: `other_${index}`,
    status: "processed",
  }));
  const provider = createRazorpayTestProvider({
    keyId: "rzp_test_example",
    keySecret: "secret",
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      const items = url.includes("skip=0") ? decoys : [{
        id: "rfnd_match",
        entity: "refund",
        payment_id: "pay_1",
        amount: 100,
        currency: "INR",
        receipt: "rs_refund",
        status: "processed",
      }];
      return new Response(JSON.stringify({ entity: "collection", items }), { status: 200 });
    }) as typeof fetch,
  });
  const result = await provider.reconcileRefund({ paymentId: "pay_1", amountPaise: 100, receipt: "rs_refund" });
  assert.equal(result.outcome, "succeeded");
  assert.equal(urls.length, 2);
  assert.match(urls[1], /count=100&skip=100$/);
});

test("test adapter does not accept a receipt collision with a different amount", async () => {
  const provider = createRazorpayTestProvider({
    keyId: "rzp_test_example",
    keySecret: "secret",
    fetchImpl: (async () => new Response(JSON.stringify({ items: [{
      id: "rfnd_collision",
      entity: "refund",
      payment_id: "pay_1",
      amount: 999,
      currency: "INR",
      receipt: "rs_refund",
      status: "processed",
    }] }), { status: 200 })) as typeof fetch,
  });
  const result = await provider.reconcileRefund({ paymentId: "pay_1", amountPaise: 100, receipt: "rs_refund" });
  assert.equal(result.outcome, "unknown");
});

test("this build rejects live Razorpay credentials", () => {
  assert.throws(
    () => createRazorpayTestProvider({ keyId: "rzp_live_example", keySecret: "secret" }),
    /only Razorpay Test Mode/,
  );
});
