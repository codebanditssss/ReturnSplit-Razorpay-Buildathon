import assert from "node:assert/strict";
import test from "node:test";

import { allocatePaiseProRata, formatPaise, multiplyRatioHalfUp, sumPaise } from "../src/lib/money";

test("allocates the golden discount exactly with largest remainders", () => {
  const result = allocatePaiseProRata(30_000, [
    { id: "kurta", weight: 249_900 },
    { id: "shoes", weight: 189_900 },
  ]);
  assert.deepEqual(result, [
    { id: "kurta", amountPaise: 17_046 },
    { id: "shoes", amountPaise: 12_954 },
  ]);
  assert.equal(sumPaise(result.map((entry) => entry.amountPaise)), 30_000);
});

test("uses stable IDs to break equal remainder ties", () => {
  const result = allocatePaiseProRata(1, [
    { id: "b", weight: 1 },
    { id: "a", weight: 1 },
  ]);
  assert.deepEqual(result, [
    { id: "b", amountPaise: 0 },
    { id: "a", amountPaise: 1 },
  ]);
});

test("half-up basis-point multiplication stays in integer paise", () => {
  assert.equal(multiplyRatioHalfUp(232_854, 8_500, 10_000), 197_926);
  assert.equal(formatPaise(232_854), "₹2,328.54");
});

test("10,000 randomized allocation and funding trials reconcile exactly", () => {
  let state = 0x1357_9bdf;
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };

  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    const count = (next() % 8) + 1;
    const weights = Array.from({ length: count }, (_, index) => ({
      id: `line_${index}`,
      weight: (next() % 1_000_000) + 1,
    }));
    const total = next() % 10_000_000;
    const result = allocatePaiseProRata(total, weights);
    assert.equal(result.length, weights.length);
    assert.equal(sumPaise(result.map((entry) => entry.amountPaise)), total);
    assert.ok(result.every((entry) => Number.isSafeInteger(entry.amountPaise) && entry.amountPaise >= 0));
    assert.deepEqual(result, allocatePaiseProRata(total, weights));

    const commissionBps = next() % 10_001;
    const sellerFunded = multiplyRatioHalfUp(total, 10_000 - commissionBps, 10_000);
    const marketplaceFunded = total - sellerFunded;
    assert.ok(sellerFunded >= 0 && marketplaceFunded >= 0);
    assert.equal(sellerFunded + marketplaceFunded, total);
  }
});
