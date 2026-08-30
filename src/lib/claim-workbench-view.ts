import type {
  ActivityEvent,
  Claim,
  ClaimExecutionSummary,
  ClaimReview,
  ClaimStatus,
  Order,
  Policy,
  RefundPlan,
  ReviewFlag,
} from "./types";

export interface ClaimWorkbenchLine {
  id: string;
  title: string;
  variant?: string;
  quantity: number;
}

export interface ClaimWorkbenchPlan {
  calculationVersion: RefundPlan["calculationVersion"];
  calculatedAt: string;
  lineAllocations: ReadonlyArray<Pick<RefundPlan["lineAllocations"][number],
    "orderLineId" | "title" | "quantity" | "grossPaise" | "discountAllocationPaise" | "customerRefundPaise"
  >>;
  sellerReversals: ReadonlyArray<Pick<RefundPlan["sellerReversals"][number],
    "sellerName" | "transferId" | "amountPaise"
  > & { providerReference: string }>;
  shippingRefundPaise: number;
  customerRefundPaise: number;
  sellerFundedPaise: number;
  marketplaceFundedPaise: number;
}

export interface ClaimWorkbenchClaim {
  id: string;
  reference: string;
  status: ClaimStatus;
  statusLabel: string;
  submittedAt: string;
  approvedAt?: string;
  completedAt?: string;
  reasonLabel: string;
  claimText: string;
  customer: { name: string };
  returnedItems: ReadonlyArray<{
    id: string;
    claimedTitle: string;
    quantity: number;
    orderLineId?: string;
  }>;
  review: Pick<ClaimReview, "headline" | "explanation" | "liability" | "flags">;
  decision?: ClaimWorkbenchPlan;
  execution?: Pick<ClaimExecutionSummary,
    | "state"
    | "approvedBy"
    | "requestId"
    | "completedReversalTransferIds"
    | "canResume"
    | "requiresReconciliation"
    | "lastError"
    | "pendingOperation"
  >;
}

export interface ClaimWorkbenchOrder {
  reference: string;
  shippingPaise: number;
  lines: readonly ClaimWorkbenchLine[];
  paymentReference: string;
}

export interface ClaimWorkbenchPolicy {
  name: string;
  version: string;
  citation: string;
  effectiveFrom: string;
  summary: string;
}

export interface ClaimWorkbenchActivity {
  id: string;
  type: ActivityEvent["type"];
  occurredAt: string;
  actor: string;
  summary: string;
  requestId?: string;
}

export interface ClaimWorkbenchReceipt {
  completedAt: string;
  requestId: string;
  planFingerprint: string;
  refundId: string;
  reversals: Array<{ transferId: string; providerId: string; amountPaise: number }>;
}

export interface ClaimWorkbenchView {
  claim: ClaimWorkbenchClaim;
  order: ClaimWorkbenchOrder;
  policy: ClaimWorkbenchPolicy;
  reviewEvents: readonly ClaimWorkbenchActivity[];
}

export function maskProviderReference(value: string | undefined): string {
  if (!value) return "Not recorded";
  if (value.length <= 4) return "••••";
  const suffix = value.slice(-4);
  return `••••${suffix}`;
}

function toWorkbenchPlan(plan: RefundPlan): ClaimWorkbenchPlan {
  return {
    calculationVersion: plan.calculationVersion,
    calculatedAt: plan.calculatedAt,
    lineAllocations: plan.lineAllocations.map((line) => ({
      orderLineId: line.orderLineId,
      title: line.title,
      quantity: line.quantity,
      grossPaise: line.grossPaise,
      discountAllocationPaise: line.discountAllocationPaise,
      customerRefundPaise: line.customerRefundPaise,
    })),
    sellerReversals: plan.sellerReversals.map((reversal) => ({
      sellerName: reversal.sellerName,
      transferId: reversal.transferId,
      amountPaise: reversal.amountPaise,
      providerReference: maskProviderReference(reversal.providerTransferId),
    })),
    shippingRefundPaise: plan.shippingRefundPaise,
    customerRefundPaise: plan.customerRefundPaise,
    sellerFundedPaise: plan.sellerFundedPaise,
    marketplaceFundedPaise: plan.marketplaceFundedPaise,
  };
}

export function toClaimWorkbenchView(
  claim: Claim,
  order: Order,
  policy: Policy,
  reviewEvents: readonly ActivityEvent[],
): ClaimWorkbenchView {
  const returnedItems = claim.returnedItems.map((item) => ({
    id: item.id,
    claimedTitle: item.claimedTitle,
    quantity: item.quantity,
    ...(item.orderLineId ? { orderLineId: item.orderLineId } : {}),
  }));
  const execution = claim.execution
    ? {
        state: claim.execution.state,
        ...(claim.execution.approvedBy ? { approvedBy: claim.execution.approvedBy } : {}),
        ...(claim.execution.requestId ? { requestId: claim.execution.requestId } : {}),
        ...(claim.execution.completedReversalTransferIds
          ? { completedReversalTransferIds: [...claim.execution.completedReversalTransferIds] }
          : {}),
        ...(claim.execution.canResume !== undefined ? { canResume: claim.execution.canResume } : {}),
        ...(claim.execution.requiresReconciliation !== undefined
          ? { requiresReconciliation: claim.execution.requiresReconciliation }
          : {}),
        ...(claim.execution.lastError ? { lastError: claim.execution.lastError } : {}),
        ...(claim.execution.pendingOperation ? { pendingOperation: claim.execution.pendingOperation } : {}),
      }
    : undefined;

  return {
    claim: {
      id: claim.id,
      reference: claim.reference,
      status: claim.status,
      statusLabel: claim.statusLabel,
      submittedAt: claim.submittedAt,
      ...(claim.approvedAt ? { approvedAt: claim.approvedAt } : {}),
      ...(claim.completedAt ? { completedAt: claim.completedAt } : {}),
      reasonLabel: claim.reasonLabel,
      claimText: claim.claimText,
      customer: { name: claim.customer.name },
      returnedItems,
      review: {
        headline: claim.review.headline,
        explanation: claim.review.explanation,
        liability: claim.review.liability,
        flags: claim.review.flags.map((flag: ReviewFlag) => ({ ...flag })),
      },
      ...(claim.decision ? { decision: toWorkbenchPlan(claim.decision) } : {}),
      ...(execution ? { execution } : {}),
    },
    order: {
      reference: order.reference,
      shippingPaise: order.shippingPaise,
      lines: order.lines.map((line) => ({
        id: line.id,
        title: line.title,
        ...(line.variant ? { variant: line.variant } : {}),
        quantity: line.quantity,
      })),
      paymentReference: maskProviderReference(order.paymentId),
    },
    policy: {
      name: policy.name,
      version: policy.version,
      citation: policy.citation,
      effectiveFrom: policy.effectiveFrom,
      summary: policy.summary,
    },
    reviewEvents: reviewEvents.map((event) => ({
      id: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      actor: event.actor,
      summary: event.summary,
      ...(event.requestId ? { requestId: event.requestId } : {}),
    })),
  };
}

export function redactExecutionReceipt<T extends {
  refundId?: string;
  reversals: ReadonlyArray<{ transferId: string; providerId?: string; amountPaise: number }>;
}>(receipt: T): Omit<T, "refundId" | "reversals"> & {
  refundId: string;
  reversals: Array<{ transferId: string; providerId: string; amountPaise: number }>;
} {
  return {
    ...receipt,
    refundId: maskProviderReference(receipt.refundId),
    reversals: receipt.reversals.map((reversal) => ({
      transferId: reversal.transferId,
      providerId: maskProviderReference(reversal.providerId),
      amountPaise: reversal.amountPaise,
    })),
  };
}
