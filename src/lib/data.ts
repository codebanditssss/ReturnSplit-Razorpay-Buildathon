import { calculateRefundPlan } from "./refund-engine";
import type {
  ActivityEvent,
  Claim,
  ClaimReview,
  Customer,
  Order,
  Policy,
  RefundPlan,
  ReturnedItem,
  Seller,
} from "./types";

export { formatPaise } from "./money";
export type { Claim, Order, Policy, ActivityEvent } from "./types";

export const sellers: readonly Seller[] = [
  { id: "seller_aavya", name: "Aavya Textiles", linkedAccountId: "acc_demo_aavya" },
  { id: "seller_noya", name: "Noya Footwear", linkedAccountId: "acc_demo_noya" },
  { id: "seller_loom", name: "The Loom Room", linkedAccountId: "acc_demo_loom" },
  { id: "seller_kaia", name: "Kaia Home", linkedAccountId: "acc_demo_kaia" },
  { id: "seller_mitti", name: "Mitti Studio", linkedAccountId: "acc_demo_mitti" },
  { id: "seller_field", name: "Field Notes", linkedAccountId: "acc_demo_field" },
] as const;

export const policies: readonly Policy[] = [
  {
    id: "policy_mora_supplier_v3_2",
    name: "Mora Supplier Terms",
    version: "3.2",
    citation: "Mora Supplier Terms v3.2 · §7.3",
    effectiveFrom: "2026-07-01",
    summary: "Manufacturing defects are funded by the seller at net settled item value; transit damage requires a separate funding and recovery decision. Outbound shipping is not refunded on a partial return.",
    rules: {
      marketplaceCommissionBps: 1500,
      sellerLiableReasons: ["manufacturing_defect", "wrong_item", "not_as_described"],
      refundOutboundShippingOnPartialReturn: false,
      refundOutboundShippingOnFullReturn: true,
      customerRemorseRefundable: false,
    },
  },
  {
    id: "policy_mora_supplier_v3_1",
    name: "Mora Supplier Terms",
    version: "3.1",
    citation: "Mora Supplier Terms v3.1 · §7.2",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-06-30",
    summary: "Superseded supplier return policy retained for order-date auditability.",
    rules: {
      marketplaceCommissionBps: 1400,
      sellerLiableReasons: ["manufacturing_defect", "wrong_item", "not_as_described"],
      refundOutboundShippingOnPartialReturn: false,
      refundOutboundShippingOnFullReturn: false,
      customerRemorseRefundable: false,
    },
  },
] as const;

const maya: Customer = { id: "cus_maya_rao", name: "Maya Rao", email: "maya.rao@example.com" };
const arjun: Customer = { id: "cus_arjun_mehta", name: "Arjun Mehta", email: "arjun.mehta@example.com" };
const leena: Customer = { id: "cus_leena_das", name: "Leena Das", email: "leena.das@example.com" };
const kabir: Customer = { id: "cus_kabir_sen", name: "Kabir Sen", email: "kabir.sen@example.com" };
const sana: Customer = { id: "cus_sana_khan", name: "Sana Khan", email: "sana.khan@example.com" };
const rohan: Customer = { id: "cus_rohan_shah", name: "Rohan Shah", email: "rohan.shah@example.com" };

export const orders: readonly Order[] = [
  {
    id: "MM-18472",
    reference: "MM-18472",
    customer: maya,
    paymentId: "pay_Q8m2Fw9Kx7Ld3P",
    placedAt: "2026-08-29T10:22:00.000Z",
    capturedAt: "2026-08-29T10:23:11.000Z",
    capturedPaymentPaise: 419700,
    refundedPaymentPaise: 0,
    merchandiseSubtotalPaise: 439800,
    shippingPaise: 9900,
    orderDiscountPaise: 30000,
    policyId: "policy_mora_supplier_v3_2",
    lines: [
      { id: "line_mm18472_kurta", title: "Indigo handblock kurta", variant: "Size M", quantity: 1, unitPricePaise: 249900, sellerId: "seller_aavya", transferId: "trf_mm18472_aavya" },
      { id: "line_mm18472_shoes", title: "Everyday sneakers", variant: "Size 6", quantity: 1, unitPricePaise: 189900, sellerId: "seller_noya", transferId: "trf_mm18472_noya" },
    ],
    transfers: [
      { id: "trf_mm18472_aavya", providerTransferId: "trf_demo_Q8aavya", sellerId: "seller_aavya", linkedAccountId: "acc_demo_aavya", originalAmountPaise: 197926, reversedAmountPaise: 0, status: "processed", createdAt: "2026-08-29T10:24:00.000Z" },
      { id: "trf_mm18472_noya", providerTransferId: "trf_demo_Q8noya", sellerId: "seller_noya", linkedAccountId: "acc_demo_noya", originalAmountPaise: 150404, reversedAmountPaise: 0, status: "processed", createdAt: "2026-08-29T10:24:00.000Z" },
    ],
  },
  {
    id: "MM-18489",
    reference: "MM-18489",
    customer: arjun,
    paymentId: "pay_demo_ambiguous",
    placedAt: "2026-08-30T08:10:00.000Z",
    capturedAt: "2026-08-30T08:11:00.000Z",
    capturedPaymentPaise: 359800,
    refundedPaymentPaise: 0,
    merchandiseSubtotalPaise: 359800,
    shippingPaise: 0,
    orderDiscountPaise: 0,
    policyId: "policy_mora_supplier_v3_2",
    lines: [
      { id: "line_mm18489_sand", title: "Linen camp shirt", variant: "Sand · M", quantity: 1, unitPricePaise: 179900, sellerId: "seller_loom", transferId: "trf_mm18489_loom" },
      { id: "line_mm18489_stone", title: "Linen camp shirt", variant: "Stone · M", quantity: 1, unitPricePaise: 179900, sellerId: "seller_loom", transferId: "trf_mm18489_loom" },
    ],
    transfers: [
      { id: "trf_mm18489_loom", providerTransferId: "trf_demo_ambiguous", sellerId: "seller_loom", linkedAccountId: "acc_demo_loom", originalAmountPaise: 305830, reversedAmountPaise: 0, status: "processed", createdAt: "2026-08-30T08:12:00.000Z" },
    ],
  },
  {
    id: "MM-18501",
    reference: "MM-18501",
    customer: leena,
    paymentId: "pay_demo_courier",
    placedAt: "2026-08-30T12:40:00.000Z",
    capturedAt: "2026-08-30T12:41:00.000Z",
    capturedPaymentPaise: 289800,
    refundedPaymentPaise: 0,
    merchandiseSubtotalPaise: 279900,
    shippingPaise: 9900,
    orderDiscountPaise: 0,
    policyId: "policy_mora_supplier_v3_2",
    lines: [
      { id: "line_mm18501_lamp", title: "Fluted ceramic lamp", variant: "Chalk", quantity: 1, unitPricePaise: 279900, sellerId: "seller_kaia", transferId: "trf_mm18501_kaia" },
    ],
    transfers: [
      { id: "trf_mm18501_kaia", providerTransferId: "trf_demo_courier", sellerId: "seller_kaia", linkedAccountId: "acc_demo_kaia", originalAmountPaise: 237915, reversedAmountPaise: 0, status: "processed", createdAt: "2026-08-30T12:42:00.000Z" },
    ],
  },
  {
    id: "MM-18518",
    reference: "MM-18518",
    customer: kabir,
    paymentId: "pay_demo_blocked",
    placedAt: "2026-08-31T07:50:00.000Z",
    capturedAt: "2026-08-31T07:51:00.000Z",
    capturedPaymentPaise: 99900,
    refundedPaymentPaise: 0,
    merchandiseSubtotalPaise: 99900,
    shippingPaise: 0,
    orderDiscountPaise: 0,
    policyId: "policy_mora_supplier_v3_2",
    lines: [
      { id: "line_mm18518_vase", title: "Speckled clay vase", quantity: 1, unitPricePaise: 99900, sellerId: "seller_mitti", transferId: "trf_mm18518_mitti" },
    ],
    transfers: [
      { id: "trf_mm18518_mitti", providerTransferId: "trf_demo_blocked", sellerId: "seller_mitti", linkedAccountId: "acc_demo_mitti", originalAmountPaise: 84915, reversedAmountPaise: 80000, status: "partially_reversed", createdAt: "2026-08-31T07:52:00.000Z" },
    ],
  },
  {
    id: "MM-18394",
    reference: "MM-18394",
    customer: sana,
    paymentId: "pay_demo_completed",
    placedAt: "2026-08-24T09:05:00.000Z",
    capturedAt: "2026-08-24T09:06:00.000Z",
    capturedPaymentPaise: 149900,
    refundedPaymentPaise: 149900,
    merchandiseSubtotalPaise: 159900,
    shippingPaise: 0,
    orderDiscountPaise: 10000,
    policyId: "policy_mora_supplier_v3_2",
    lines: [
      { id: "line_mm18394_tote", title: "Canvas market tote", variant: "Olive", quantity: 1, unitPricePaise: 159900, sellerId: "seller_field", transferId: "trf_mm18394_field" },
    ],
    transfers: [
      { id: "trf_mm18394_field", providerTransferId: "trf_demo_completed", sellerId: "seller_field", linkedAccountId: "acc_demo_field", originalAmountPaise: 127415, reversedAmountPaise: 127415, status: "fully_reversed", createdAt: "2026-08-24T09:07:00.000Z" },
    ],
  },
  {
    id: "MM-18527",
    reference: "MM-18527",
    customer: rohan,
    paymentId: "pay_demo_retry",
    placedAt: "2026-09-01T13:20:00.000Z",
    capturedAt: "2026-09-01T13:21:00.000Z",
    capturedPaymentPaise: 219800,
    refundedPaymentPaise: 0,
    merchandiseSubtotalPaise: 219800,
    shippingPaise: 0,
    orderDiscountPaise: 0,
    policyId: "policy_mora_supplier_v3_2",
    lines: [
      { id: "line_mm18527_scarf", title: "Handwoven cotton scarf", variant: "Indigo", quantity: 1, unitPricePaise: 119900, sellerId: "seller_aavya", transferId: "trf_mm18527_aavya" },
      { id: "line_mm18527_sling", title: "Mini canvas sling", variant: "Moss", quantity: 1, unitPricePaise: 99900, sellerId: "seller_field", transferId: "trf_mm18527_field" },
    ],
    transfers: [
      { id: "trf_mm18527_aavya", providerTransferId: "trf_demo_retry_a", sellerId: "seller_aavya", linkedAccountId: "acc_demo_aavya", originalAmountPaise: 101915, reversedAmountPaise: 101915, status: "fully_reversed", createdAt: "2026-09-01T13:22:00.000Z" },
      { id: "trf_mm18527_field", providerTransferId: "trf_demo_retry_b", sellerId: "seller_field", linkedAccountId: "acc_demo_field", originalAmountPaise: 84915, reversedAmountPaise: 0, status: "processed", createdAt: "2026-09-01T13:22:00.000Z" },
    ],
  },
] as const;

const activePolicy = policies[0];

function orderSummary(order: Order) {
  return { id: order.id, reference: order.reference, paymentId: order.paymentId, paidPaise: order.capturedPaymentPaise };
}

function readyReview(overrides: Partial<ClaimReview> = {}): ClaimReview {
  return {
    state: "ready",
    headline: "Policy match is clear",
    explanation: "The item, liability and frozen policy agree. Review the exact paise movement before approval.",
    extractionConfidence: 0.98,
    liability: "seller",
    policyId: activePolicy.id,
    policyCitation: activePolicy.citation,
    flags: [],
    evidence: [],
    requiresHumanApproval: true,
    ...overrides,
  };
}

function item(id: string, claimedTitle: string, orderLineId: string | undefined, evidenceQuote: string, matchConfidence = 0.98): ReturnedItem {
  return { id, claimedTitle, quantity: 1, ...(orderLineId ? { orderLineId } : {}), matchConfidence, evidenceQuote };
}

function planFor(
  claim: Pick<Claim, "id" | "reason" | "returnedItems" | "review">,
  order: Order,
  calculatedAt = "2026-09-03T10:32:00.000Z",
): RefundPlan {
  // Completed seeds use their pre-execution order snapshot, reconstructed below.
  const calculationOrder = order.refundedPaymentPaise > 0 || order.transfers.some((transfer) => transfer.reversedAmountPaise > 0)
    ? {
        ...order,
        refundedPaymentPaise: 0,
        transfers: order.transfers.map((transfer) => ({ ...transfer, reversedAmountPaise: 0, status: "processed" as const })),
      }
    : order;
  const result = calculateRefundPlan({ claim, order: calculationOrder, policy: activePolicy, sellers, calculatedAt });
  if (result.status === "needs_review" || !result.plan) throw new Error(`Seed plan for ${claim.id} was not calculable`);
  return result.plan;
}

const goldenOrder = orders[0];
const goldenItems = [item("returned_ret031_1", "Indigo handblock kurta, size M", "line_mm18472_kurta", "The blue kurta arrived with a torn seam near the sleeve.", 0.99)];
const goldenReview = readyReview({
  headline: "Seller-funded manufacturing defect",
  explanation: "The torn seam maps to the kurta and §7.3 assigns the net settled item value to Aavya Textiles. Outbound shipping stays with the customer on this partial return.",
  evidence: [
    { source: "claim", label: "Customer statement", quote: "The blue kurta arrived with a torn seam near the sleeve. I’m keeping the shoes." },
    { source: "policy", label: "Mora Supplier Terms v3.2 · §7.3", quote: "Manufacturing defect: seller funds net settled item value; marketplace returns commission; outbound shipping is not refunded on partial return." },
  ],
});
const goldenPlan = planFor({ id: "RET-260903-031", reason: "manufacturing_defect", returnedItems: goldenItems, review: goldenReview }, goldenOrder);

const completedReview = readyReview({ state: "completed", headline: "Refund completed", explanation: "The seller transfer was reversed before the payment refund was created." });
const completedItems = [item("returned_ret024_1", "Canvas market tote", "line_mm18394_tote", "The tote stitching opened on first use.")];
const completedPlan = planFor(
  { id: "RET-260831-024", reason: "manufacturing_defect", returnedItems: completedItems, review: completedReview },
  orders[4],
  "2026-08-31T06:18:00.000Z",
);

const retryReview = readyReview({
  state: "processing",
  headline: "One reversal needs a safe retry",
  explanation: "Aavya’s reversal succeeded. Field Notes returned a retryable error; no customer refund has been sent yet.",
  flags: [{ code: "provider_failure", tone: "warning", label: "Partial execution", detail: "Retry resumes the existing saga and skips the completed Aavya reversal." }],
});
const retryItems = [
  item("returned_ret041_1", "Handwoven cotton scarf", "line_mm18527_scarf", "Both items have broken fasteners."),
  item("returned_ret041_2", "Mini canvas sling", "line_mm18527_sling", "Both items have broken fasteners."),
];
const retryPlan = planFor(
  { id: "RET-260903-041", reason: "manufacturing_defect", returnedItems: retryItems, review: retryReview },
  orders[5],
  "2026-09-03T10:29:00.000Z",
);

const blockedItems = [item("returned_ret038_1", "Speckled clay vase", "line_mm18518_vase", "The vase arrived cracked through the base.")];
const blockedReview = readyReview({
  state: "blocked",
  headline: "Transfer balance is insufficient",
  explanation: "A prior partial reversal leaves only ₹49.15 available. Provider state must be reconciled before approval.",
  flags: [{ code: "insufficient_reversible_balance", tone: "danger", label: "Approval blocked", detail: "Required seller reversal exceeds the remaining Route transfer balance." }],
});
const blockedResult = calculateRefundPlan({
  claim: { id: "RET-260903-038", reason: "manufacturing_defect", returnedItems: blockedItems, review: blockedReview },
  order: orders[3],
  policy: activePolicy,
  sellers,
  calculatedAt: "2026-09-03T09:20:00.000Z",
});
const blockedPlan = blockedResult.status === "blocked" ? blockedResult.plan : undefined;

export const claims: readonly Claim[] = [
  {
    id: "RET-260903-031",
    reference: "RET-260903-031",
    orderId: goldenOrder.id,
    order: orderSummary(goldenOrder),
    customer: maya,
    status: "ready_for_approval",
    statusLabel: "Ready for approval",
    submittedAt: "2026-09-03T09:42:00.000Z",
    reason: "manufacturing_defect",
    reasonLabel: "Manufacturing defect",
    claimText: "The blue kurta arrived with a torn seam near the sleeve. I’m keeping the shoes.",
    itemSummary: "Indigo handblock kurta · Size M",
    returnedItems: goldenItems,
    amountPaise: goldenPlan.customerRefundPaise,
    review: goldenReview,
    decision: goldenPlan,
  },
  {
    id: "RET-260903-033",
    reference: "RET-260903-033",
    orderId: orders[1].id,
    order: orderSummary(orders[1]),
    customer: arjun,
    status: "needs_review",
    statusLabel: "Needs item match",
    submittedAt: "2026-09-03T08:18:00.000Z",
    reason: "manufacturing_defect",
    reasonLabel: "Manufacturing defect",
    claimText: "The linen shirt has a split cuff. I ordered two colours but can’t tell which name is on the site.",
    itemSummary: "Linen camp shirt · colour unclear",
    returnedItems: [item("returned_ret033_1", "Linen camp shirt", undefined, "I ordered two colours but can’t tell which name is on the site.", 0.51)],
    review: readyReview({
      state: "needs_review",
      headline: "Choose which linen shirt was returned",
      explanation: "The order contains Sand and Stone variants with the same product name. The item could not be matched safely.",
      extractionConfidence: 0.51,
      flags: [{ code: "ambiguous_item", tone: "warning", label: "Item match required", detail: "Two order lines are equally plausible." }],
      evidence: [{ source: "claim", label: "Customer statement", quote: "I ordered two colours but can’t tell which name is on the site." }],
    }),
  },
  {
    id: "RET-260903-035",
    reference: "RET-260903-035",
    orderId: orders[2].id,
    order: orderSummary(orders[2]),
    customer: leena,
    status: "needs_review",
    statusLabel: "Liability review",
    submittedAt: "2026-09-03T08:52:00.000Z",
    reason: "courier_damage",
    reasonLabel: "Damage in transit",
    claimText: "The outer box was crushed and the ceramic lamp is broken. The inner wrap also looks thin.",
    itemSummary: "Fluted ceramic lamp · Chalk",
    returnedItems: [item("returned_ret035_1", "Fluted ceramic lamp", "line_mm18501_lamp", "The outer box was crushed and the ceramic lamp is broken.", 0.99)],
    review: readyReview({
      state: "needs_review",
      headline: "Choose who fronts this refund",
      explanation: "The claim points to transit damage and possibly inadequate seller packaging. Mora Market can refund the customer now while recovery is reviewed separately.",
      extractionConfidence: 0.91,
      liability: "unresolved",
      flags: [{ code: "liability_unclear", tone: "warning", label: "Funding decision required", detail: "Choose whether Mora Market should front the customer refund while recovery is reviewed." }],
      evidence: [{ source: "claim", label: "Customer statement", quote: "The outer box was crushed… The inner wrap also looks thin." }],
    }),
  },
  {
    id: "RET-260903-038",
    reference: "RET-260903-038",
    orderId: orders[3].id,
    order: orderSummary(orders[3]),
    customer: kabir,
    status: "blocked",
    statusLabel: "Blocked",
    submittedAt: "2026-09-03T09:12:00.000Z",
    reason: "manufacturing_defect",
    reasonLabel: "Manufacturing defect",
    claimText: "The vase arrived cracked through the base.",
    itemSummary: "Speckled clay vase",
    returnedItems: blockedItems,
    amountPaise: blockedPlan?.customerRefundPaise,
    review: blockedReview,
    decision: blockedPlan,
  },
  {
    id: "RET-260831-024",
    reference: "RET-260831-024",
    orderId: orders[4].id,
    order: orderSummary(orders[4]),
    customer: sana,
    status: "completed",
    statusLabel: "Completed",
    submittedAt: "2026-08-31T06:02:00.000Z",
    approvedAt: "2026-08-31T06:20:00.000Z",
    completedAt: "2026-08-31T06:20:04.000Z",
    reason: "manufacturing_defect",
    reasonLabel: "Manufacturing defect",
    claimText: "The tote stitching opened on first use.",
    itemSummary: "Canvas market tote · Olive",
    returnedItems: completedItems,
    amountPaise: completedPlan.customerRefundPaise,
    review: completedReview,
    decision: completedPlan,
    execution: { sagaId: "saga_RET-260831-024", state: "completed", approvedBy: "Neha Kapoor", approvedAt: "2026-08-31T06:20:00.000Z", completedAt: "2026-08-31T06:20:04.000Z", requestId: "req_01J6K2F8S" },
  },
  {
    id: "RET-260903-041",
    reference: "RET-260903-041",
    orderId: orders[5].id,
    order: orderSummary(orders[5]),
    customer: rohan,
    status: "processing",
    statusLabel: "Retry available",
    submittedAt: "2026-09-03T10:03:00.000Z",
    approvedAt: "2026-09-03T10:31:00.000Z",
    reason: "manufacturing_defect",
    reasonLabel: "Manufacturing defect",
    claimText: "Both items have broken fasteners.",
    itemSummary: "2 items · 2 sellers",
    returnedItems: retryItems,
    amountPaise: retryPlan.customerRefundPaise,
    review: retryReview,
    decision: retryPlan,
    execution: { sagaId: "saga_RET-260903-041", state: "failed", approvedBy: "Neha Kapoor", approvedAt: "2026-09-03T10:31:00.000Z", requestId: "req_01J6R3M4T", completedReversalTransferIds: ["trf_mm18527_aavya"], canResume: true, lastError: "Field Notes reversal failed and can be retried safely.", pendingOperation: "transfer_reversal" },
  },
] as const;

export const activityEvents: readonly ActivityEvent[] = [
  { id: "evt_101", type: "calculation_created", outcome: "info", claimId: "RET-260903-031", orderId: "MM-18472", occurredAt: "2026-09-03T09:42:06.000Z", actor: "ReturnSplit engine", summary: "Calculated ₹2,328.54 customer refund with exact paise reconciliation", requestId: "req_01J6R1A8P" },
  { id: "evt_102", type: "item_extracted", outcome: "warning", claimId: "RET-260903-033", orderId: "MM-18489", occurredAt: "2026-09-03T08:18:03.000Z", actor: "Evidence extractor", summary: "Abstained: two linen shirt variants are equally plausible", requestId: "req_01J6QZ82B" },
  { id: "evt_103", type: "manual_review_requested", outcome: "warning", claimId: "RET-260903-035", orderId: "MM-18501", occurredAt: "2026-09-03T08:52:05.000Z", actor: "Policy matcher", summary: "Requested courier-versus-seller liability review", requestId: "req_01J6R03DK" },
  { id: "evt_104", type: "transfer_reversed", outcome: "success", claimId: "RET-260903-041", orderId: "MM-18527", occurredAt: "2026-09-03T10:31:03.000Z", actor: "ReturnSplit executor", summary: "Reversed ₹1,019.15 from Aavya Textiles", requestId: "req_01J6R3M4T" },
  { id: "evt_105", type: "provider_failure", outcome: "danger", claimId: "RET-260903-041", orderId: "MM-18527", occurredAt: "2026-09-03T10:31:04.000Z", actor: "ReturnSplit executor", summary: "Field Notes reversal failed; refund remains unsent and retry is safe", requestId: "req_01J6R3M4T" },
  { id: "evt_105b", type: "transfer_reversed", outcome: "success", claimId: "RET-260831-024", orderId: "MM-18394", occurredAt: "2026-08-31T06:20:02.000Z", actor: "ReturnSplit executor", summary: "Seller transfer reversal confirmed before customer refund", requestId: "req_01J6K2F8S" },
  { id: "evt_106", type: "refund_created", outcome: "success", claimId: "RET-260831-024", orderId: "MM-18394", occurredAt: "2026-08-31T06:20:04.000Z", actor: "ReturnSplit executor", summary: "Refunded ₹1,499.00 after the required reversal succeeded", requestId: "req_01J6K2F8S" },
  { id: "evt_107", type: "duplicate_event_ignored", outcome: "info", claimId: "RET-260831-024", orderId: "MM-18394", occurredAt: "2026-08-31T06:20:07.000Z", actor: "Webhook ingest", summary: "Ignored duplicate refund.processed webhook", requestId: "req_01J6K2GCQ", metadata: { providerEventId: "event_demo_rfnd_024", idempotent: true } },
] as const;

/** Alias kept terse for activity-page consumers. */
export const activity = activityEvents;

export function getClaimById(id: string): Claim | undefined {
  return claims.find((claim) => claim.id === id || claim.reference === id);
}

export function getOrderById(id: string): Order | undefined {
  return orders.find((order) => order.id === id || order.reference === id);
}

export function getPolicyById(id: string): Policy | undefined {
  return policies.find((policy) => policy.id === id);
}
