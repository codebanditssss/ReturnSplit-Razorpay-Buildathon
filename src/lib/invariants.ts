import { allocatePaiseProRata, isPaise, multiplyRatioHalfUp, sumPaise } from "./money";
import type { CalculationIssue, Order, Policy, RefundPlan } from "./types";

function blocked(
  code: CalculationIssue["code"],
  message: string,
  path?: string,
): CalculationIssue {
  return { code, severity: "blocked", message, ...(path ? { path } : {}) };
}

export function policyWasActiveForOrder(policy: Policy, order: Order): boolean {
  const orderDate = order.placedAt.slice(0, 10);
  return orderDate >= policy.effectiveFrom && (!policy.effectiveTo || orderDate <= policy.effectiveTo);
}

export function validateOrderAccounting(order: Order): readonly CalculationIssue[] {
  const issues: CalculationIssue[] = [];
  const moneyEntries = [
    ["capturedPaymentPaise", order.capturedPaymentPaise],
    ["refundedPaymentPaise", order.refundedPaymentPaise],
    ["merchandiseSubtotalPaise", order.merchandiseSubtotalPaise],
    ["shippingPaise", order.shippingPaise],
    ["orderDiscountPaise", order.orderDiscountPaise],
  ] as const;
  for (const [path, value] of moneyEntries) {
    if (!isPaise(value)) issues.push(blocked("invalid_money", `${path} must be integer paise`, path));
  }

  let calculatedMerchandise = 0;
  const lineIds = new Set<string>();
  for (const [index, line] of order.lines.entries()) {
    if (!line.id || lineIds.has(line.id)) {
      issues.push(blocked("order_total_mismatch", `Order line ID ${line.id || "(empty)"} must be non-empty and unique`, `lines.${index}.id`));
    }
    lineIds.add(line.id);
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      issues.push(blocked("invalid_quantity", `Order line ${line.id} has an invalid quantity`, `lines.${index}.quantity`));
      continue;
    }
    if (!isPaise(line.unitPricePaise)) {
      issues.push(blocked("invalid_money", `Order line ${line.id} price must be integer paise`, `lines.${index}.unitPricePaise`));
      continue;
    }
    const subtotal = line.quantity * line.unitPricePaise;
    if (!Number.isSafeInteger(subtotal)) {
      issues.push(blocked("invalid_money", `Order line ${line.id} subtotal exceeds the safe paise range`, `lines.${index}`));
      continue;
    }
    calculatedMerchandise += subtotal;
  }

  if (!Number.isSafeInteger(calculatedMerchandise)) {
    issues.push(blocked("invalid_money", "Order merchandise total exceeds the safe paise range", "lines"));
  } else if (calculatedMerchandise !== order.merchandiseSubtotalPaise) {
    issues.push(
      blocked(
        "order_total_mismatch",
        `Order merchandise subtotal is ${order.merchandiseSubtotalPaise}, but its lines sum to ${calculatedMerchandise} paise`,
        "merchandiseSubtotalPaise",
      ),
    );
  }

  const expectedCaptured = order.merchandiseSubtotalPaise + order.shippingPaise - order.orderDiscountPaise;
  if (!Number.isSafeInteger(expectedCaptured) || expectedCaptured < 0) {
    issues.push(blocked("invalid_money", "Calculated captured payment is outside the safe paise range"));
  } else if (expectedCaptured !== order.capturedPaymentPaise) {
    issues.push(
      blocked(
        "order_total_mismatch",
        `Captured payment is ${order.capturedPaymentPaise}, but merchandise + shipping - discount is ${expectedCaptured} paise`,
        "capturedPaymentPaise",
      ),
    );
  }
  if (order.refundedPaymentPaise > order.capturedPaymentPaise) {
    issues.push(blocked("refund_exceeds_remaining_payment", "Recorded refunds exceed the captured payment"));
  }
  if (order.orderDiscountPaise > order.merchandiseSubtotalPaise) {
    issues.push(blocked("order_total_mismatch", "Order discount exceeds the merchandise amount it is allocated across"));
  }

  const transferIds = new Set<string>();
  const providerTransferIds = new Set<string>();
  for (const [index, transfer] of order.transfers.entries()) {
    if (!transfer.id || transferIds.has(transfer.id)) {
      issues.push(blocked("transfer_not_found", `Transfer ID ${transfer.id || "(empty)"} must be non-empty and unique`, `transfers.${index}.id`));
    }
    transferIds.add(transfer.id);
    if (!transfer.providerTransferId || providerTransferIds.has(transfer.providerTransferId)) {
      issues.push(blocked("transfer_not_found", `Provider transfer ID ${transfer.providerTransferId || "(empty)"} must be non-empty and unique`, `transfers.${index}.providerTransferId`));
    }
    providerTransferIds.add(transfer.providerTransferId);
    if (!isPaise(transfer.originalAmountPaise) || !isPaise(transfer.reversedAmountPaise)) {
      issues.push(blocked("invalid_money", `Transfer ${transfer.id} amounts must be integer paise`, `transfers.${index}`));
    } else if (transfer.reversedAmountPaise > transfer.originalAmountPaise) {
      issues.push(blocked("reversal_exceeds_remaining", `Transfer ${transfer.id} is over-reversed`, `transfers.${index}`));
    }
  }

  const transfersById = new Map(order.transfers.map((transfer) => [transfer.id, transfer]));
  for (const [index, line] of order.lines.entries()) {
    const transfer = transfersById.get(line.transferId);
    if (!transfer) {
      issues.push(blocked("transfer_not_found", `Order line ${line.id} does not map to an order transfer`, `lines.${index}.transferId`));
    } else if (transfer.sellerId !== line.sellerId) {
      issues.push(blocked("transfer_not_found", `Order line ${line.id} and transfer ${transfer.id} belong to different sellers`, `lines.${index}.sellerId`));
    }
  }
  return issues;
}

export function validateRefundPlan(plan: RefundPlan, order: Order, policy: Policy): readonly CalculationIssue[] {
  const orderIssues = validateOrderAccounting(order);
  const issues: CalculationIssue[] = [...orderIssues];
  if (plan.orderId !== order.id || plan.paymentId !== order.paymentId) {
    issues.push(blocked("order_total_mismatch", "Refund plan is bound to a different order or payment"));
  }
  if (plan.policySnapshot.id !== order.policyId || policy.id !== order.policyId) {
    issues.push(blocked("policy_mismatch", "Refund plan policy does not match the version frozen on the order"));
  }
  if (
    plan.currency !== "INR" ||
    plan.providerSnapshot.capturedPaymentPaise !== order.capturedPaymentPaise ||
    plan.providerSnapshot.previouslyRefundedPaise !== order.refundedPaymentPaise ||
    plan.providerSnapshot.remainingRefundablePaise !== order.capturedPaymentPaise - order.refundedPaymentPaise
  ) {
    issues.push(blocked("refund_exceeds_remaining_payment", "Refund plan uses a stale or invalid payment snapshot"));
  }

  const rules = plan.policySnapshot.rules;
  if (
    !rules ||
    !Number.isSafeInteger(rules.marketplaceCommissionBps) ||
    rules.marketplaceCommissionBps < 0 ||
    rules.marketplaceCommissionBps > 10_000 ||
    !Array.isArray(rules.sellerLiableReasons) ||
    typeof rules.refundOutboundShippingOnPartialReturn !== "boolean" ||
    typeof rules.refundOutboundShippingOnFullReturn !== "boolean" ||
    typeof rules.customerRemorseRefundable !== "boolean"
  ) {
    issues.push(blocked("policy_mismatch", "Refund plan does not contain a complete, valid policy rule snapshot"));
    return issues;
  }
  const canonicalRules = policy.rules;
  if (
    plan.policySnapshot.id !== policy.id ||
    plan.policySnapshot.version !== policy.version ||
    plan.policySnapshot.citation !== policy.citation ||
    plan.policySnapshot.effectiveFrom !== policy.effectiveFrom ||
    plan.policySnapshot.effectiveTo !== policy.effectiveTo ||
    rules.marketplaceCommissionBps !== canonicalRules.marketplaceCommissionBps ||
    rules.refundOutboundShippingOnPartialReturn !== canonicalRules.refundOutboundShippingOnPartialReturn ||
    rules.refundOutboundShippingOnFullReturn !== canonicalRules.refundOutboundShippingOnFullReturn ||
    rules.customerRemorseRefundable !== canonicalRules.customerRemorseRefundable ||
    [...rules.sellerLiableReasons].sort().join("\u0000") !== [...canonicalRules.sellerLiableReasons].sort().join("\u0000")
  ) {
    issues.push(blocked("policy_mismatch", "Refund plan policy snapshot does not match the server's frozen policy version"));
  }
  const orderDate = order.placedAt.slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(plan.policySnapshot.effectiveFrom) ||
    (plan.policySnapshot.effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(plan.policySnapshot.effectiveTo)) ||
    orderDate < plan.policySnapshot.effectiveFrom ||
    (plan.policySnapshot.effectiveTo !== undefined && orderDate > plan.policySnapshot.effectiveTo)
  ) {
    issues.push(blocked("policy_not_active", "Refund plan policy snapshot was not active on the order date"));
  }
  if (!plan.policySnapshot.version.trim() || !plan.policySnapshot.citation.trim()) {
    issues.push(blocked("policy_mismatch", "Refund plan policy version and citation are required"));
  }
  if (plan.calculationVersion !== "returnsplit-paise-v2") {
    issues.push(blocked("plan_semantics_mismatch", "Refund plan calculation version is unsupported"));
  }

  if (plan.decisionBasis.reason === "unknown") {
    issues.push(blocked("plan_semantics_mismatch", "An executable refund plan cannot use an unknown return reason"));
  }
  if (
    plan.decisionBasis.liability === "unresolved" ||
    plan.decisionBasis.liability === "courier" ||
    plan.decisionBasis.liability === "customer"
  ) {
    issues.push(blocked("plan_semantics_mismatch", `Liability ${plan.decisionBasis.liability} cannot produce this executable refund plan`));
  }
  if (plan.decisionBasis.reason === "customer_remorse" && !rules.customerRemorseRefundable) {
    issues.push(blocked("plan_semantics_mismatch", "The bound policy does not permit a customer-remorse refund"));
  }
  if (
    plan.decisionBasis.liability === "seller" &&
    !rules.sellerLiableReasons.includes(plan.decisionBasis.reason)
  ) {
    issues.push(blocked("plan_semantics_mismatch", "The bound policy does not assign this return reason to the seller"));
  }
  if (
    plan.decisionBasis.liability === "marketplace" &&
    rules.sellerLiableReasons.includes(plan.decisionBasis.reason)
  ) {
    issues.push(blocked("plan_semantics_mismatch", "The refund plan shifts a seller-liable reason to the marketplace without a supported override"));
  }

  const planMoney = [
    plan.shippingRefundPaise,
    plan.customerRefundPaise,
    plan.sellerFundedPaise,
    plan.marketplaceFundedPaise,
    plan.providerSnapshot.capturedPaymentPaise,
    plan.providerSnapshot.previouslyRefundedPaise,
    plan.providerSnapshot.remainingRefundablePaise,
    ...plan.lineAllocations.flatMap((line) => [line.grossPaise, line.discountAllocationPaise, line.customerRefundPaise]),
    ...plan.sellerReversals.flatMap((reversal) => [reversal.amountPaise, reversal.remainingReversiblePaise]),
  ];
  if (!planMoney.every(isPaise)) {
    issues.push(blocked("invalid_money", "Every refund plan amount must be non-negative integer paise"));
    return issues;
  }

  if (orderIssues.length > 0) return issues;

  const orderLinesById = new Map(order.lines.map((line) => [line.id, line]));
  const decisionItemsByLine = new Map<string, RefundPlan["decisionBasis"]["returnedItems"][number]>();
  const invalidDecisionLineIds = new Set<string>();
  for (const [index, returned] of plan.decisionBasis.returnedItems.entries()) {
    const line = orderLinesById.get(returned.orderLineId);
    if (!line) {
      issues.push(blocked("line_not_found", `Decision item ${returned.orderLineId} does not exist on the order`, `decisionBasis.returnedItems.${index}.orderLineId`));
      continue;
    }
    if (decisionItemsByLine.has(returned.orderLineId)) {
      issues.push(blocked("duplicate_returned_item", `Decision item ${returned.orderLineId} appears more than once`));
      continue;
    }
    decisionItemsByLine.set(returned.orderLineId, returned);
    if (!Number.isSafeInteger(returned.quantity) || returned.quantity <= 0 || returned.quantity > line.quantity) {
      issues.push(blocked("invalid_quantity", `Decision quantity for ${line.id} is outside the ordered quantity`, `decisionBasis.returnedItems.${index}.quantity`));
      invalidDecisionLineIds.add(line.id);
    }
    if (returned.orderLineQuantity !== line.quantity) {
      issues.push(blocked("plan_semantics_mismatch", `Decision item ${line.id} uses a stale ordered quantity`, `decisionBasis.returnedItems.${index}.orderLineQuantity`));
    }
    if (!/^[a-f0-9]{64}$/.test(returned.evidenceHash)) {
      issues.push(blocked("plan_semantics_mismatch", `Decision item ${line.id} is not bound to a SHA-256 evidence hash`, `decisionBasis.returnedItems.${index}.evidenceHash`));
    }
  }
  if (decisionItemsByLine.size === 0) {
    issues.push(blocked("empty_return", "An executable refund plan must contain at least one returned order line"));
  }

  const allocationByLine = new Map<string, RefundPlan["lineAllocations"][number]>();
  for (const [index, allocation] of plan.lineAllocations.entries()) {
    if (allocationByLine.has(allocation.orderLineId)) {
      issues.push(blocked("plan_semantics_mismatch", `Refund plan contains duplicate allocations for ${allocation.orderLineId}`, `lineAllocations.${index}`));
      continue;
    }
    allocationByLine.set(allocation.orderLineId, allocation);
  }

  const discountByLine = new Map(
    allocatePaiseProRata(
      order.orderDiscountPaise,
      order.lines.map((line) => ({ id: line.id, weight: line.unitPricePaise * line.quantity })),
    ).map((allocation) => [allocation.id, allocation.amountPaise]),
  );
  const expectedLineRefundByTransfer = new Map<string, number>();
  let expectedCustomerFromLines = 0;
  for (const [lineId, returned] of decisionItemsByLine) {
    const line = orderLinesById.get(lineId)!;
    const allocation = allocationByLine.get(lineId);
    if (!allocation) {
      issues.push(blocked("plan_semantics_mismatch", `Refund plan is missing the allocation for ${line.id}`));
      continue;
    }
    if (invalidDecisionLineIds.has(lineId)) continue;
    const grossLinePaise = line.unitPricePaise * line.quantity;
    const netLinePaise = grossLinePaise - (discountByLine.get(line.id) ?? 0);
    const expectedCustomerRefundPaise = multiplyRatioHalfUp(netLinePaise, returned.quantity, line.quantity);
    const expectedGrossPaise = line.unitPricePaise * returned.quantity;
    const expectedDiscountPaise = expectedGrossPaise - expectedCustomerRefundPaise;
    if (
      allocation.title !== line.title ||
      allocation.sellerId !== line.sellerId ||
      allocation.transferId !== line.transferId ||
      allocation.quantity !== returned.quantity ||
      allocation.grossPaise !== expectedGrossPaise ||
      allocation.discountAllocationPaise !== expectedDiscountPaise ||
      allocation.customerRefundPaise !== expectedCustomerRefundPaise
    ) {
      issues.push(blocked("plan_semantics_mismatch", `Refund allocation for ${line.id} does not match the order, quantity, and bound policy math`, `lineAllocations.${line.id}`));
    }
    expectedCustomerFromLines += expectedCustomerRefundPaise;
    expectedLineRefundByTransfer.set(
      line.transferId,
      (expectedLineRefundByTransfer.get(line.transferId) ?? 0) + expectedCustomerRefundPaise,
    );
  }
  for (const allocation of plan.lineAllocations) {
    if (!decisionItemsByLine.has(allocation.orderLineId)) {
      issues.push(blocked("plan_semantics_mismatch", `Refund allocation ${allocation.orderLineId} is not present in the approved decision basis`));
    }
  }

  const isFullReturn = order.lines.every((line) => decisionItemsByLine.get(line.id)?.quantity === line.quantity);
  const expectedShippingRefundPaise = isFullReturn
    ? rules.refundOutboundShippingOnFullReturn ? order.shippingPaise : 0
    : rules.refundOutboundShippingOnPartialReturn ? order.shippingPaise : 0;
  if (plan.shippingRefundPaise !== expectedShippingRefundPaise) {
    issues.push(blocked("plan_semantics_mismatch", "Shipping refund does not match the bound policy rules"));
  }
  const expectedCustomerRefundPaise = expectedCustomerFromLines + expectedShippingRefundPaise;
  if (plan.customerRefundPaise !== expectedCustomerRefundPaise) {
    issues.push(blocked("plan_semantics_mismatch", "Customer refund does not match the exact returned-line and shipping calculation"));
  }

  const expectedReversals = new Map<string, {
    sellerId: string;
    providerTransferId: string;
    amountPaise: number;
    remainingReversiblePaise: number;
    reason: string;
  }>();
  if (plan.decisionBasis.liability === "seller") {
    for (const [transferId, refundablePaise] of expectedLineRefundByTransfer) {
      const transfer = order.transfers.find((entry) => entry.id === transferId)!;
      expectedReversals.set(transferId, {
        sellerId: transfer.sellerId,
        providerTransferId: transfer.providerTransferId,
        amountPaise: multiplyRatioHalfUp(refundablePaise, 10_000 - rules.marketplaceCommissionBps, 10_000),
        remainingReversiblePaise: transfer.originalAmountPaise - transfer.reversedAmountPaise,
        reason: `${plan.policySnapshot.citation}: seller funds net item value less returned marketplace commission`,
      });
    }
  }

  const reversalByTransfer = new Map<string, RefundPlan["sellerReversals"][number]>();
  for (const [index, reversal] of plan.sellerReversals.entries()) {
    if (reversalByTransfer.has(reversal.transferId)) {
      issues.push(blocked("plan_semantics_mismatch", `Refund plan contains duplicate reversals for ${reversal.transferId}`, `sellerReversals.${index}`));
      continue;
    }
    reversalByTransfer.set(reversal.transferId, reversal);
    const expected = expectedReversals.get(reversal.transferId);
    if (!expected) {
      issues.push(blocked("plan_semantics_mismatch", `Seller reversal ${reversal.transferId} is not required by the decision basis`));
      continue;
    }
    if (
      reversal.sellerId !== expected.sellerId ||
      reversal.providerTransferId !== expected.providerTransferId ||
      reversal.amountPaise !== expected.amountPaise ||
      reversal.remainingReversiblePaise !== expected.remainingReversiblePaise ||
      reversal.reason !== expected.reason
    ) {
      issues.push(blocked("plan_semantics_mismatch", `Seller reversal ${reversal.transferId} does not match the bound order and policy calculation`));
    }
  }
  for (const transferId of expectedReversals.keys()) {
    if (!reversalByTransfer.has(transferId)) {
      issues.push(blocked("plan_semantics_mismatch", `Refund plan is missing the required seller reversal for ${transferId}`));
    }
  }

  const customerFromLines = sumPaise(plan.lineAllocations.map((line) => line.customerRefundPaise));
  if (customerFromLines + plan.shippingRefundPaise !== plan.customerRefundPaise) {
    issues.push(blocked("reconciliation_mismatch", "Line refunds plus shipping do not equal the customer refund"));
  }

  const sellerFromReversals = sumPaise(plan.sellerReversals.map((reversal) => reversal.amountPaise));
  if (sellerFromReversals !== plan.sellerFundedPaise) {
    issues.push(blocked("reconciliation_mismatch", "Seller reversals do not equal the seller-funded total"));
  }
  if (plan.sellerFundedPaise + plan.marketplaceFundedPaise !== plan.customerRefundPaise) {
    issues.push(blocked("reconciliation_mismatch", "Seller and marketplace funding do not equal the customer refund"));
  }
  const expectedSellerFundedPaise = sumPaise([...expectedReversals.values()].map((reversal) => reversal.amountPaise));
  if (
    plan.sellerFundedPaise !== expectedSellerFundedPaise ||
    plan.marketplaceFundedPaise !== expectedCustomerRefundPaise - expectedSellerFundedPaise
  ) {
    issues.push(blocked("plan_semantics_mismatch", "Funding totals do not match the exact reversal calculation required by the bound policy"));
  }

  if (plan.customerRefundPaise > order.capturedPaymentPaise - order.refundedPaymentPaise) {
    issues.push(blocked("refund_exceeds_remaining_payment", "Refund exceeds the payment's remaining refundable balance"));
  }

  const reversalTotals = new Map<string, number>();
  for (const reversal of plan.sellerReversals) {
    reversalTotals.set(reversal.transferId, (reversalTotals.get(reversal.transferId) ?? 0) + reversal.amountPaise);
    const transfer = order.transfers.find((entry) => entry.id === reversal.transferId);
    if (!transfer || transfer.providerTransferId !== reversal.providerTransferId || transfer.sellerId !== reversal.sellerId) {
      issues.push(blocked("transfer_not_found", `Reversal ${reversal.transferId} does not match an order transfer`));
      continue;
    }
    const actualRemaining = transfer.originalAmountPaise - transfer.reversedAmountPaise;
    if (reversal.remainingReversiblePaise !== actualRemaining) {
      issues.push(blocked("reversal_exceeds_remaining", `${reversal.sellerName} reversal uses a stale transfer balance`));
    }
  }
  for (const [transferId, amountPaise] of reversalTotals) {
    const transfer = order.transfers.find((entry) => entry.id === transferId);
    if (!transfer) continue;
    const actualRemaining = transfer.originalAmountPaise - transfer.reversedAmountPaise;
    if (amountPaise > actualRemaining) {
      const sellerName = plan.sellerReversals.find((entry) => entry.transferId === transferId)?.sellerName ?? "Seller";
      issues.push(
        blocked(
          "reversal_exceeds_remaining",
          `${sellerName} reversal exceeds the transfer's remaining reversible balance`,
          `sellerReversals.${transferId}`,
        ),
      );
    }
  }
  return issues;
}
