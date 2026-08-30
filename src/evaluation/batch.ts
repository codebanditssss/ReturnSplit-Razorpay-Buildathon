import { calculateRefundPlan } from "@/lib/refund-engine";
import type {
  CalculationIssue,
  Order,
  Policy,
  RefundCalculationInput,
  Seller,
} from "@/lib/types";

export type BatchDisposition = "execute" | "no_reversal" | "abstain" | "blocked";
export type BatchExceptionCode = "ambiguous_item" | "liability_unclear" | "insufficient_balance";

export interface BatchDecision {
  disposition: BatchDisposition;
  customerRefundPaise: number;
  reversalVector: Readonly<Record<string, number>>;
  exceptionCode?: BatchExceptionCode;
}

type BatchScenario =
  | "clear_seller_defect"
  | "discounted_partial_return"
  | "multi_seller_full_return"
  | "partial_quantity_return"
  | "shared_transfer_return"
  | "customer_remorse"
  | "ambiguous_item"
  | "liability_unclear"
  | "insufficient_balance";

export interface BatchRecord {
  id: string;
  groupId: string;
  locale: "en" | "hi" | "hinglish";
  scenario: BatchScenario;
  claimText: string;
  input: RefundCalculationInput;
  expected: BatchDecision;
}

export interface BatchReport {
  dataset: "returnsplit-engine-control-v2";
  kind: "synthetic_engine_replay";
  records: number;
  /** End-to-end wall-clock duration of this in-process replay. */
  elapsedMs: number;
  /** Derived from `records / elapsedMs`; `null` when elapsed time is zero. */
  recordsPerSecond: number | null;
  /** Wall-clock latency around each individual runner invocation. */
  latencyMs: {
    p50: number | null;
    p95: number | null;
  };
  fixtureAssertionsPassed: number;
  automatedRecords: number;
  exceptionRecords: number;
  unsafeAutomations: number;
  wrongSellerPaise: number;
  dispositionCounts: Record<BatchDisposition, number>;
  exceptions: Array<{ id: string; scenario: string; code: string; disposition: BatchDisposition }>;
}

type BatchRunner = (record: BatchRecord) => BatchDecision;

export interface BatchTimingSource {
  /** Returns a monotonic wall-clock timestamp in milliseconds. */
  now(): number;
}

const names = ["kurta", "sneakers", "lamp", "tote", "shirt", "vase", "scarf", "sling"] as const;
const locales = ["en", "hi", "hinglish"] as const;
const COMMISSION_BPS = 1_500;

const CONTROL_POLICY: Policy = {
  id: "policy_batch_v1",
  name: "Synthetic controller policy",
  version: "1.0",
  citation: "Synthetic controller policy v1.0 · §1",
  effectiveFrom: "2026-01-01",
  summary: "Seller funds net item value; marketplace returns commission.",
  rules: {
    marketplaceCommissionBps: COMMISSION_BPS,
    sellerLiableReasons: ["manufacturing_defect", "wrong_item", "not_as_described"],
    refundOutboundShippingOnPartialReturn: false,
    refundOutboundShippingOnFullReturn: true,
    customerRemorseRefundable: false,
  },
};

function fixtureText(locale: BatchRecord["locale"], scenario: BatchScenario, item: string): string {
  const text: Record<BatchScenario, Record<BatchRecord["locale"], string>> = {
    clear_seller_defect: {
      en: `The ${item} has a manufacturing defect; I am keeping the other item.`,
      hi: `${item} में निर्माण की खराबी है; बाकी सामान मैं रख रहा/रही हूँ।`,
      hinglish: `${item} mein manufacturing defect hai; baaki item rakh raha/rahi hoon.`,
    },
    discounted_partial_return: {
      en: `The discounted ${item} arrived defective; only this item is being returned.`,
      hi: `छूट वाला ${item} खराब आया; केवल यही सामान लौटाना है।`,
      hinglish: `Discount wala ${item} defective aaya; sirf ye item return karna hai.`,
    },
    multi_seller_full_return: {
      en: "Both items from different sellers are defective; return the complete order.",
      hi: "अलग विक्रेताओं के दोनों सामान खराब हैं; पूरा ऑर्डर लौटाना है।",
      hinglish: "Dono sellers ke items defective hain; poora order return karna hai.",
    },
    partial_quantity_return: {
      en: `One of the two ${item} units is defective; keep the other unit.`,
      hi: `दो ${item} में से एक खराब है; दूसरी इकाई रखनी है।`,
      hinglish: `Do ${item} units mein se ek defective hai; doosra rakhna hai.`,
    },
    shared_transfer_return: {
      en: `Both ${item} variants from the same seller are defective.`,
      hi: `एक ही विक्रेता के दोनों ${item} प्रकार खराब हैं।`,
      hinglish: `Same seller ke dono ${item} variants defective hain.`,
    },
    customer_remorse: {
      en: `The ${item} is fine, but I changed my mind.`,
      hi: `${item} ठीक है, लेकिन मैंने अपना मन बदल लिया।`,
      hinglish: `${item} theek hai, bas maine mind change kar liya.`,
    },
    ambiguous_item: {
      en: "One of the two similar items is damaged; the label is missing.",
      hi: "दो मिलती-जुलती चीज़ों में से एक खराब है; लेबल नहीं है।",
      hinglish: "Do similar items mein se ek damaged hai; label missing hai.",
    },
    liability_unclear: {
      en: "The parcel was crushed and the inner packing was thin.",
      hi: "पार्सल दबा हुआ मिला और अंदर की पैकिंग पतली थी।",
      hinglish: "Parcel crushed mila aur andar ki packing patli thi.",
    },
    insufficient_balance: {
      en: `The ${item} is defective after a prior partial reversal.`,
      hi: `पहले आंशिक रिवर्सल के बाद ${item} में खराबी मिली।`,
      hinglish: `Pehle partial reversal ke baad ${item} defective mila.`,
    },
  };
  return text[scenario][locale];
}

/** Independent fixture oracle for 15% commission, using exact half-up rounding. */
function sellerFunded(amountPaise: number): number {
  return Number(
    (BigInt(amountPaise) * BigInt(8_500) * BigInt(2) + BigInt(10_000)) /
      BigInt(20_000),
  );
}

function createSellers(index: number): readonly Seller[] {
  return [
    { id: `seller_batch_${index}_a`, name: `Seller ${index}A`, linkedAccountId: `acc_batch_${index}_a` },
    { id: `seller_batch_${index}_b`, name: `Seller ${index}B`, linkedAccountId: `acc_batch_${index}_b` },
  ];
}

function createOrder(
  index: number,
  sellers: readonly Seller[],
  lines: Order["lines"],
  transferAmounts: Readonly<Record<string, number>>,
  options: { shippingPaise?: number; discountPaise?: number; reversedPaise?: number } = {},
): Order {
  const merchandiseSubtotalPaise = lines.reduce((sum, line) => sum + line.unitPricePaise * line.quantity, 0);
  const shippingPaise = options.shippingPaise ?? 0;
  const orderDiscountPaise = options.discountPaise ?? 0;
  const transferIds = [...new Set(lines.map((line) => line.transferId))];
  return {
    id: `ORDER-${index}`,
    reference: `ORDER-${index}`,
    customer: { id: `customer_${index}`, name: `Customer ${index}`, email: `customer-${index}@example.invalid` },
    paymentId: `pay_batch_${index}`,
    placedAt: "2026-08-01T09:00:00.000Z",
    capturedAt: "2026-08-01T09:01:00.000Z",
    capturedPaymentPaise: merchandiseSubtotalPaise + shippingPaise - orderDiscountPaise,
    refundedPaymentPaise: 0,
    merchandiseSubtotalPaise,
    shippingPaise,
    orderDiscountPaise,
    policyId: CONTROL_POLICY.id,
    lines,
    transfers: transferIds.map((transferId) => {
      const line = lines.find((candidate) => candidate.transferId === transferId)!;
      const reversedAmountPaise = options.reversedPaise ?? 0;
      return {
        id: transferId,
        providerTransferId: `provider_${transferId}`,
        sellerId: line.sellerId,
        linkedAccountId: sellers.find((seller) => seller.id === line.sellerId)!.linkedAccountId,
        originalAmountPaise: transferAmounts[transferId],
        reversedAmountPaise,
        status: reversedAmountPaise > 0 ? "partially_reversed" as const : "processed" as const,
        createdAt: "2026-08-01T09:02:00.000Z",
      };
    }),
  };
}

function returnedItem(
  claimId: string,
  line: Order["lines"][number],
  quantity: number,
): RefundCalculationInput["claim"]["returnedItems"][number] {
  return {
    id: `${claimId}_return_${line.id}`,
    claimedTitle: line.title,
    quantity,
    orderLineId: line.id,
    matchConfidence: 0.99,
    evidenceQuote: "Synthetic evidence placeholder",
  };
}

function executeDecision(line: Order["lines"][number], customerRefundPaise: number): BatchDecision {
  return {
    disposition: "execute",
    customerRefundPaise,
    reversalVector: { [`provider_${line.transferId}`]: sellerFunded(customerRefundPaise) },
  };
}

function makeRecord(index: number): BatchRecord {
  const number = index + 1;
  const id = `SYN-${String(number).padStart(3, "0")}`;
  const locale = locales[index % locales.length];
  const item = names[index % names.length];
  const family = index % 8;
  const basePaise = 80_000 + Math.floor(index / 8) * 7_000;
  const sellers = createSellers(number);
  const lineA = { id: `line_${number}_a`, title: `${item} A`, quantity: 1, unitPricePaise: basePaise, sellerId: sellers[0].id, transferId: `trf_batch_${number}_a` };
  const lineB = { id: `line_${number}_b`, title: `${item} B`, quantity: 1, unitPricePaise: basePaise + 20_000, sellerId: sellers[1].id, transferId: `trf_batch_${number}_b` };

  let scenario: BatchScenario;
  let order: Order;
  let returnedItems: RefundCalculationInput["claim"]["returnedItems"];
  let reason: RefundCalculationInput["claim"]["reason"] = "manufacturing_defect";
  let liability: RefundCalculationInput["claim"]["review"]["liability"] = "seller";
  let expected: BatchDecision;

  if (family === 0) {
    scenario = "clear_seller_defect";
    order = createOrder(number, sellers, [lineA, lineB], {
      [lineA.transferId]: sellerFunded(lineA.unitPricePaise),
      [lineB.transferId]: sellerFunded(lineB.unitPricePaise),
    }, { shippingPaise: 9_900 });
    returnedItems = [returnedItem(id, lineA, 1)];
    expected = executeDecision(lineA, lineA.unitPricePaise);
  } else if (family === 1) {
    scenario = "discounted_partial_return";
    const discountedLineB = { ...lineB, unitPricePaise: basePaise };
    const netLinePaise = basePaise - 10_000;
    order = createOrder(number, sellers, [lineA, discountedLineB], {
      [lineA.transferId]: sellerFunded(netLinePaise),
      [lineB.transferId]: sellerFunded(netLinePaise),
    }, { discountPaise: 20_000 });
    returnedItems = [returnedItem(id, lineA, 1)];
    expected = executeDecision(lineA, netLinePaise);
  } else if (family === 2) {
    scenario = "multi_seller_full_return";
    order = createOrder(number, sellers, [lineA, lineB], {
      [lineA.transferId]: sellerFunded(lineA.unitPricePaise),
      [lineB.transferId]: sellerFunded(lineB.unitPricePaise),
    }, { shippingPaise: 9_900 });
    returnedItems = [returnedItem(id, lineA, 1), returnedItem(id, lineB, 1)];
    expected = {
      disposition: "execute",
      customerRefundPaise: lineA.unitPricePaise + lineB.unitPricePaise + order.shippingPaise,
      reversalVector: {
        [`provider_${lineA.transferId}`]: sellerFunded(lineA.unitPricePaise),
        [`provider_${lineB.transferId}`]: sellerFunded(lineB.unitPricePaise),
      },
    };
  } else if (family === 3) {
    scenario = "partial_quantity_return";
    const quantityLine = { ...lineA, quantity: 2 };
    order = createOrder(number, sellers, [quantityLine], { [lineA.transferId]: sellerFunded(basePaise * 2) }, { shippingPaise: 9_900 });
    returnedItems = [returnedItem(id, quantityLine, 1)];
    expected = executeDecision(lineA, basePaise);
  } else if (family === 4) {
    scenario = "shared_transfer_return";
    const sharedLineB = { ...lineB, sellerId: lineA.sellerId, transferId: lineA.transferId };
    const refundPaise = lineA.unitPricePaise + sharedLineB.unitPricePaise;
    order = createOrder(number, sellers, [lineA, sharedLineB], { [lineA.transferId]: sellerFunded(refundPaise) });
    returnedItems = [returnedItem(id, lineA, 1), returnedItem(id, sharedLineB, 1)];
    expected = executeDecision(lineA, refundPaise);
  } else if (family === 5) {
    scenario = "customer_remorse";
    reason = "customer_remorse";
    liability = "customer";
    order = createOrder(number, sellers, [lineA], { [lineA.transferId]: sellerFunded(lineA.unitPricePaise) });
    returnedItems = [returnedItem(id, lineA, 1)];
    expected = { disposition: "no_reversal", customerRefundPaise: 0, reversalVector: {} };
  } else if (family === 6) {
    scenario = "ambiguous_item";
    const similarLine = { ...lineB, title: lineA.title };
    order = createOrder(number, sellers, [lineA, similarLine], {
      [lineA.transferId]: sellerFunded(lineA.unitPricePaise),
      [lineB.transferId]: sellerFunded(similarLine.unitPricePaise),
    });
    returnedItems = [{ id: `${id}_return_1`, claimedTitle: lineA.title, quantity: 1, matchConfidence: 0.5, evidenceQuote: "Synthetic evidence placeholder" }];
    expected = { disposition: "abstain", customerRefundPaise: 0, reversalVector: {}, exceptionCode: "ambiguous_item" };
  } else if (index % 16 === 7) {
    scenario = "liability_unclear";
    reason = "courier_damage";
    liability = "unresolved";
    order = createOrder(number, sellers, [lineA], { [lineA.transferId]: sellerFunded(lineA.unitPricePaise) });
    returnedItems = [returnedItem(id, lineA, 1)];
    expected = { disposition: "abstain", customerRefundPaise: 0, reversalVector: {}, exceptionCode: "liability_unclear" };
  } else {
    scenario = "insufficient_balance";
    const fundedPaise = sellerFunded(lineA.unitPricePaise);
    order = createOrder(number, sellers, [lineA], { [lineA.transferId]: fundedPaise }, { reversedPaise: fundedPaise - 1 });
    returnedItems = [returnedItem(id, lineA, 1)];
    expected = {
      disposition: "blocked",
      customerRefundPaise: lineA.unitPricePaise,
      reversalVector: { [`provider_${lineA.transferId}`]: fundedPaise },
      exceptionCode: "insufficient_balance",
    };
  }

  const claimText = fixtureText(locale, scenario, item);
  return {
    id,
    groupId: `group_${Math.floor(index / 4) + 1}`,
    locale,
    scenario,
    claimText,
    input: {
      claim: {
        id,
        reason,
        returnedItems: returnedItems.map((returned) => ({ ...returned, evidenceQuote: claimText })),
        review: { liability },
      },
      order,
      policy: CONTROL_POLICY,
      sellers,
      calculatedAt: "2026-09-04T00:00:00.000Z",
    },
    expected,
  };
}

/**
 * Builds 64 synthetic finance-control inputs with independent expected labels.
 * Claim text is metadata: this replay starts after extraction and does not
 * claim multilingual model accuracy.
 */
export function buildSyntheticBatch(): readonly BatchRecord[] {
  return Array.from({ length: 64 }, (_, index) => makeRecord(index));
}

function normalizeException(issues: readonly CalculationIssue[]): BatchExceptionCode | undefined {
  if (issues.some((entry) => entry.code === "ambiguous_item")) return "ambiguous_item";
  if (issues.some((entry) => entry.code === "liability_unresolved")) return "liability_unclear";
  if (issues.some((entry) => entry.code === "reversal_exceeds_remaining")) return "insufficient_balance";
  return undefined;
}

/** Runs the same deterministic paise engine used by the product workbench. */
export function runSyntheticControl(record: BatchRecord): BatchDecision {
  const result = calculateRefundPlan(record.input);
  if (result.status === "ready") {
    return {
      disposition: result.plan.sellerReversals.length > 0 ? "execute" : "no_reversal",
      customerRefundPaise: result.plan.customerRefundPaise,
      reversalVector: Object.fromEntries(result.plan.sellerReversals.map((reversal) => [reversal.providerTransferId, reversal.amountPaise])),
    };
  }

  if (result.status === "needs_review" && result.issues.every((entry) => entry.code === "reason_not_refundable")) {
    return { disposition: "no_reversal", customerRefundPaise: 0, reversalVector: {} };
  }

  return {
    disposition: result.status === "blocked" ? "blocked" : "abstain",
    customerRefundPaise: result.status === "blocked" ? result.plan?.customerRefundPaise ?? 0 : 0,
    reversalVector: result.status === "blocked" && result.plan
      ? Object.fromEntries(result.plan.sellerReversals.map((reversal) => [reversal.providerTransferId, reversal.amountPaise]))
      : {},
    exceptionCode: normalizeException(result.issues),
  };
}

function equalVectors(left: Readonly<Record<string, number>>, right: Readonly<Record<string, number>>): boolean {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.every((key) => (left[key] ?? 0) === (right[key] ?? 0));
}

function elapsedBetween(startMs: number, endMs: number): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new Error("Batch timing source must return finite, monotonic millisecond values");
  }
  return endMs - startMs;
}

/** Nearest-rank percentile, suitable for an observed latency sample. */
function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(quantile * sorted.length) - 1];
}

function roundMetric(value: number | null, digits: number): number | null {
  if (value === null) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

const WALL_CLOCK: BatchTimingSource = {
  now: () => performance.now(),
};

export function evaluateSyntheticBatch(
  records = buildSyntheticBatch(),
  runner: BatchRunner = runSyntheticControl,
  timing: BatchTimingSource = WALL_CLOCK,
): BatchReport {
  const batchStartedAtMs = timing.now();
  let fixtureAssertionsPassed = 0;
  let automatedRecords = 0;
  let unsafeAutomations = 0;
  let wrongSellerPaise = 0;
  const dispositionCounts: Record<BatchDisposition, number> = { execute: 0, no_reversal: 0, abstain: 0, blocked: 0 };
  const exceptions: BatchReport["exceptions"] = [];
  const recordLatenciesMs: number[] = [];

  for (const record of records) {
    const recordStartedAtMs = timing.now();
    const output = runner(record);
    recordLatenciesMs.push(elapsedBetween(recordStartedAtMs, timing.now()));
    dispositionCounts[output.disposition] += 1;
    const exact = record.expected.disposition === output.disposition
      && record.expected.customerRefundPaise === output.customerRefundPaise
      && record.expected.exceptionCode === output.exceptionCode
      && equalVectors(record.expected.reversalVector, output.reversalVector);
    if (exact) fixtureAssertionsPassed += 1;
    if (output.disposition === "execute" || output.disposition === "no_reversal") automatedRecords += 1;
    if ((record.expected.disposition === "abstain" || record.expected.disposition === "blocked") && output.disposition === "execute") unsafeAutomations += 1;
    const keys = new Set([...Object.keys(record.expected.reversalVector), ...Object.keys(output.reversalVector)]);
    for (const key of keys) {
      wrongSellerPaise += Math.max((output.reversalVector[key] ?? 0) - (record.expected.reversalVector[key] ?? 0), 0);
    }
    if (output.exceptionCode) exceptions.push({ id: record.id, scenario: record.scenario, code: output.exceptionCode, disposition: output.disposition });
  }

  const elapsedMs = elapsedBetween(batchStartedAtMs, timing.now());

  return {
    dataset: "returnsplit-engine-control-v2",
    kind: "synthetic_engine_replay",
    records: records.length,
    elapsedMs: roundMetric(elapsedMs, 3) ?? 0,
    recordsPerSecond: roundMetric(elapsedMs > 0 ? records.length * 1_000 / elapsedMs : null, 2),
    latencyMs: {
      p50: roundMetric(percentile(recordLatenciesMs, 0.5), 3),
      p95: roundMetric(percentile(recordLatenciesMs, 0.95), 3),
    },
    fixtureAssertionsPassed,
    automatedRecords,
    exceptionRecords: exceptions.length,
    unsafeAutomations,
    wrongSellerPaise,
    dispositionCounts,
    exceptions,
  };
}
