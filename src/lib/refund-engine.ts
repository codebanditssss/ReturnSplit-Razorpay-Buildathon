import { createHash } from "node:crypto";
import { allocatePaiseProRata, isPaise, multiplyRatioHalfUp, sumPaise } from "./money";
import { policyWasActiveForOrder, validateOrderAccounting, validateRefundPlan } from "./invariants";
import type {
  CalculationIssue,
  LineRefundAllocation,
  RefundCalculationInput,
  RefundCalculationResult,
  RefundPlan,
  SellerReversal,
} from "./types";

function issue(
  code: CalculationIssue["code"],
  severity: CalculationIssue["severity"],
  message: string,
  path?: string,
): CalculationIssue {
  return { code, severity, message, ...(path ? { path } : {}) };
}

function classify(issues: readonly CalculationIssue[]): "needs_review" | "blocked" {
  return issues.some((entry) => entry.severity === "blocked") ? "blocked" : "needs_review";
}

export function calculateRefundPlan(input: RefundCalculationInput): RefundCalculationResult {
  const { claim, order, policy, sellers } = input;
  const preflight: CalculationIssue[] = [...validateOrderAccounting(order)];

  if (order.policyId !== policy.id) {
    preflight.push(issue("policy_mismatch", "blocked", "The supplied policy is not the version frozen on this order"));
  }
  if (!policyWasActiveForOrder(policy, order)) {
    preflight.push(issue("policy_not_active", "blocked", "The frozen policy was not active on the order date"));
  }
  if (!Number.isSafeInteger(policy.rules.marketplaceCommissionBps) || policy.rules.marketplaceCommissionBps < 0 || policy.rules.marketplaceCommissionBps > 10_000) {
    preflight.push(issue("invalid_money", "blocked", "Marketplace commission must be between 0 and 10,000 basis points"));
  }
  if (claim.returnedItems.length === 0) {
    preflight.push(issue("empty_return", "review", "No returned item was identified"));
  }
  if (claim.reason === "unknown") {
    preflight.push(issue("liability_unresolved", "review", "Return reason must be resolved before calculating money movement"));
  }
  if (claim.review.liability === "customer") {
    preflight.push(issue("reason_not_refundable", "review", "A customer-funded outcome does not create a refund plan"));
  }
  if (claim.review.liability === "unresolved" || claim.review.liability === "courier") {
    preflight.push(issue("liability_unresolved", "review", "Funding liability must be resolved before calculating money movement"));
  }
  if (claim.reason === "customer_remorse" && !policy.rules.customerRemorseRefundable) {
    preflight.push(issue("reason_not_refundable", "review", "Customer-remorse returns are not refundable under this policy"));
  }
  if (claim.review.liability === "seller" && !policy.rules.sellerLiableReasons.includes(claim.reason)) {
    preflight.push(issue("liability_unresolved", "review", "This reason is not mapped to seller liability by the frozen policy"));
  }
  if (claim.review.liability === "marketplace" && policy.rules.sellerLiableReasons.includes(claim.reason)) {
    preflight.push(issue("liability_unresolved", "review", "The frozen policy assigns this reason to the seller; a separate override workflow is required to shift funding"));
  }

  const orderLinesById = new Map(order.lines.map((line) => [line.id, line]));
  const seenLineIds = new Set<string>();
  for (const [index, returned] of claim.returnedItems.entries()) {
    if (!returned.orderLineId) {
      preflight.push(issue("ambiguous_item", "review", `Returned item “${returned.claimedTitle}” is not mapped to an order line`, `returnedItems.${index}`));
      continue;
    }
    const line = orderLinesById.get(returned.orderLineId);
    if (!line) {
      preflight.push(issue("line_not_found", "blocked", `Order line ${returned.orderLineId} does not exist`, `returnedItems.${index}.orderLineId`));
      continue;
    }
    if (seenLineIds.has(line.id)) {
      preflight.push(issue("duplicate_returned_item", "blocked", `Order line ${line.id} appears more than once in this claim`));
    }
    seenLineIds.add(line.id);
    if (!Number.isSafeInteger(returned.quantity) || returned.quantity <= 0) {
      preflight.push(issue("invalid_quantity", "blocked", `Returned quantity for ${line.title} must be a positive integer`));
    } else if (returned.quantity > line.quantity) {
      preflight.push(issue("quantity_exceeds_order", "blocked", `Returned quantity for ${line.title} exceeds the order quantity`));
    }
  }

  if (preflight.length > 0) {
    const status = classify(preflight);
    return status === "blocked" ? { status, issues: preflight } : { status, issues: preflight };
  }

  const grossByLine = order.lines.map((line) => ({
    id: line.id,
    weight: line.unitPricePaise * line.quantity,
  }));
  if (grossByLine.some(({ weight }) => !isPaise(weight))) {
    return {
      status: "blocked",
      issues: [issue("invalid_money", "blocked", "An order line subtotal exceeds the supported integer-paise range")],
    };
  }
  const discounts = new Map(
    allocatePaiseProRata(order.orderDiscountPaise, grossByLine).map((allocation) => [allocation.id, allocation.amountPaise]),
  );

  const lineAllocations: LineRefundAllocation[] = claim.returnedItems.map((returned) => {
    const line = orderLinesById.get(returned.orderLineId as string)!;
    const grossLinePaise = line.unitPricePaise * line.quantity;
    const netLinePaise = grossLinePaise - (discounts.get(line.id) ?? 0);
    const customerRefundPaise = multiplyRatioHalfUp(netLinePaise, returned.quantity, line.quantity);
    return {
      orderLineId: line.id,
      title: line.title,
      sellerId: line.sellerId,
      transferId: line.transferId,
      quantity: returned.quantity,
      grossPaise: line.unitPricePaise * returned.quantity,
      discountAllocationPaise: line.unitPricePaise * returned.quantity - customerRefundPaise,
      customerRefundPaise,
    };
  });

  const returnedQuantity = lineAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
  const orderedQuantity = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  const isFullReturn = returnedQuantity === orderedQuantity;
  const shippingRefundPaise = isFullReturn
    ? policy.rules.refundOutboundShippingOnFullReturn
      ? order.shippingPaise
      : 0
    : policy.rules.refundOutboundShippingOnPartialReturn
      ? order.shippingPaise
      : 0;

  const lineRefundByTransfer = new Map<string, number>();
  for (const allocation of lineAllocations) {
    lineRefundByTransfer.set(
      allocation.transferId,
      (lineRefundByTransfer.get(allocation.transferId) ?? 0) + allocation.customerRefundPaise,
    );
  }

  const sellerById = new Map(sellers.map((seller) => [seller.id, seller]));
  const transferById = new Map(order.transfers.map((transfer) => [transfer.id, transfer]));
  const calculationIssues: CalculationIssue[] = [];
  const sellerReversals: SellerReversal[] = [];
  if (claim.review.liability === "seller") {
    for (const [transferId, refundablePaise] of lineRefundByTransfer) {
      const transfer = transferById.get(transferId);
      const allocation = lineAllocations.find((entry) => entry.transferId === transferId)!;
      const seller = sellerById.get(allocation.sellerId);
      if (!transfer || !seller) {
        calculationIssues.push(issue("transfer_not_found", "blocked", `No Route transfer is mapped for ${allocation.title}`));
        continue;
      }
      if (transfer.sellerId !== allocation.sellerId || transfer.linkedAccountId !== seller.linkedAccountId) {
        calculationIssues.push(issue("transfer_not_found", "blocked", `Route transfer ownership does not match ${seller.name}`));
        continue;
      }
      const amountPaise = multiplyRatioHalfUp(
        refundablePaise,
        10_000 - policy.rules.marketplaceCommissionBps,
        10_000,
      );
      sellerReversals.push({
        sellerId: seller.id,
        sellerName: seller.name,
        transferId: transfer.id,
        providerTransferId: transfer.providerTransferId,
        amountPaise,
        remainingReversiblePaise: transfer.originalAmountPaise - transfer.reversedAmountPaise,
        reason: `${policy.citation}: seller funds net item value less returned marketplace commission`,
      });
    }
  }

  const customerRefundPaise = sumPaise([
    ...lineAllocations.map((allocation) => allocation.customerRefundPaise),
    shippingRefundPaise,
  ]);
  const sellerFundedPaise = sumPaise(sellerReversals.map((reversal) => reversal.amountPaise));
  const plan: RefundPlan = {
    claimId: claim.id,
    orderId: order.id,
    paymentId: order.paymentId,
    currency: "INR",
    decisionBasis: {
      reason: claim.reason,
      liability: claim.review.liability,
      returnedItems: claim.returnedItems.map((returned) => ({
        orderLineId: returned.orderLineId as string,
        orderLineQuantity: orderLinesById.get(returned.orderLineId as string)!.quantity,
        quantity: returned.quantity,
        evidenceHash: createHash("sha256").update(returned.evidenceQuote, "utf8").digest("hex"),
      })),
    },
    providerSnapshot: {
      capturedPaymentPaise: order.capturedPaymentPaise,
      previouslyRefundedPaise: order.refundedPaymentPaise,
      remainingRefundablePaise: order.capturedPaymentPaise - order.refundedPaymentPaise,
    },
    policySnapshot: {
      id: policy.id,
      version: policy.version,
      citation: policy.citation,
      effectiveFrom: policy.effectiveFrom,
      ...(policy.effectiveTo ? { effectiveTo: policy.effectiveTo } : {}),
      rules: {
        marketplaceCommissionBps: policy.rules.marketplaceCommissionBps,
        sellerLiableReasons: [...policy.rules.sellerLiableReasons],
        refundOutboundShippingOnPartialReturn: policy.rules.refundOutboundShippingOnPartialReturn,
        refundOutboundShippingOnFullReturn: policy.rules.refundOutboundShippingOnFullReturn,
        customerRemorseRefundable: policy.rules.customerRemorseRefundable,
      },
    },
    lineAllocations,
    sellerReversals,
    shippingRefundPaise,
    customerRefundPaise,
    sellerFundedPaise,
    marketplaceFundedPaise: customerRefundPaise - sellerFundedPaise,
    calculatedAt: input.calculatedAt ?? new Date().toISOString(),
    calculationVersion: "returnsplit-paise-v2",
  };

  calculationIssues.push(...validateRefundPlan(plan, order, policy));
  if (calculationIssues.length > 0) return { status: "blocked", issues: calculationIssues, plan };
  return { status: "ready", plan, issues: [] };
}
