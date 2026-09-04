/**
 * Monetary values in the domain are integer paise. Runtime guards in money.ts
 * enforce this at every calculation and provider boundary.
 */
export type Paise = number;
export type BasisPoints = number;
export type ISODate = string;
export type ISODateTime = string;

export type ClaimStatus =
  | "ready_for_approval"
  | "needs_review"
  | "blocked"
  | "processing"
  | "completed";

export type ReturnReason =
  | "manufacturing_defect"
  | "wrong_item"
  | "courier_damage"
  | "not_as_described"
  | "customer_remorse"
  | "unknown";

export type LiabilityParty = "seller" | "marketplace" | "courier" | "customer" | "unresolved";

export interface Customer {
  id: string;
  name: string;
  email: string;
}

export interface Seller {
  id: string;
  name: string;
  linkedAccountId: string;
}

export interface OrderLine {
  id: string;
  title: string;
  variant?: string;
  quantity: number;
  unitPricePaise: Paise;
  sellerId: string;
  transferId: string;
}

export interface RouteTransfer {
  id: string;
  providerTransferId: string;
  sellerId: string;
  linkedAccountId: string;
  originalAmountPaise: Paise;
  reversedAmountPaise: Paise;
  status: "processed" | "partially_reversed" | "fully_reversed";
  createdAt: ISODateTime;
}

export interface Order {
  id: string;
  reference: string;
  customer: Customer;
  paymentId: string;
  placedAt: ISODateTime;
  capturedAt: ISODateTime;
  capturedPaymentPaise: Paise;
  refundedPaymentPaise: Paise;
  merchandiseSubtotalPaise: Paise;
  shippingPaise: Paise;
  orderDiscountPaise: Paise;
  policyId: string;
  lines: readonly OrderLine[];
  transfers: readonly RouteTransfer[];
}

export interface PolicyRules {
  marketplaceCommissionBps: BasisPoints;
  sellerLiableReasons: readonly ReturnReason[];
  refundOutboundShippingOnPartialReturn: boolean;
  refundOutboundShippingOnFullReturn: boolean;
  customerRemorseRefundable: boolean;
}

export interface Policy {
  id: string;
  name: string;
  version: string;
  citation: string;
  effectiveFrom: ISODate;
  effectiveTo?: ISODate;
  summary: string;
  rules: PolicyRules;
}

export interface ReturnedItem {
  /** Stable claim-local identifier used even when item matching abstains. */
  id: string;
  claimedTitle: string;
  quantity: number;
  orderLineId?: string;
  matchConfidence: number;
  evidenceQuote: string;
}

export interface ReviewFlag {
  code:
    | "ambiguous_item"
    | "liability_unclear"
    | "insufficient_reversible_balance"
    | "prior_refund"
    | "provider_failure"
    | "provider_result_unknown"
    | "duplicate_event_ignored"
    | "manual_override";
  tone: "neutral" | "warning" | "danger";
  label: string;
  detail: string;
}

export interface EvidenceReference {
  source: "claim" | "policy" | "order" | "provider";
  label: string;
  quote: string;
}

export interface ClaimReview {
  state: "ready" | "needs_review" | "blocked" | "processing" | "completed";
  headline: string;
  explanation: string;
  extractionConfidence?: number;
  liability: LiabilityParty;
  policyId: string;
  policyCitation: string;
  flags: readonly ReviewFlag[];
  evidence: readonly EvidenceReference[];
  requiresHumanApproval: true;
  overrideReason?: string;
}

export interface LineRefundAllocation {
  orderLineId: string;
  title: string;
  sellerId: string;
  transferId: string;
  quantity: number;
  grossPaise: Paise;
  discountAllocationPaise: Paise;
  customerRefundPaise: Paise;
}

export interface SellerReversal {
  sellerId: string;
  sellerName: string;
  transferId: string;
  providerTransferId: string;
  amountPaise: Paise;
  remainingReversiblePaise: Paise;
  reason: string;
}

export interface RefundPlan {
  claimId: string;
  orderId: string;
  paymentId: string;
  currency: "INR";
  decisionBasis: {
    reason: ReturnReason;
    liability: LiabilityParty;
    returnedItems: readonly {
      orderLineId: string;
      /** Frozen order quantity used by the execution store's reservation check. */
      orderLineQuantity: number;
      quantity: number;
      evidenceHash: string;
    }[];
  };
  providerSnapshot: {
    capturedPaymentPaise: Paise;
    previouslyRefundedPaise: Paise;
    remainingRefundablePaise: Paise;
  };
  policySnapshot: {
    id: string;
    version: string;
    citation: string;
    effectiveFrom: ISODate;
    effectiveTo?: ISODate;
    /** Complete money-decision rules; approval is bound to this exact copy. */
    rules: PolicyRules;
  };
  lineAllocations: readonly LineRefundAllocation[];
  sellerReversals: readonly SellerReversal[];
  shippingRefundPaise: Paise;
  customerRefundPaise: Paise;
  sellerFundedPaise: Paise;
  marketplaceFundedPaise: Paise;
  calculatedAt: ISODateTime;
  calculationVersion: "returnsplit-paise-v2";
}

export interface ClaimExecutionSummary {
  sagaId: string;
  state:
    | "approved"
    | "reversing_transfers"
    | "reversal_result_unknown"
    | "refunding_payment"
    | "refund_result_unknown"
    | "failed"
    | "completed";
  approvedBy?: string;
  approvedAt?: ISODateTime;
  completedAt?: ISODateTime;
  requestId?: string;
  completedReversalTransferIds?: readonly string[];
  canResume?: boolean;
  requiresReconciliation?: boolean;
  lastError?: string;
  pendingOperation?: "transfer_reversal" | "payment_refund";
}

export interface ClaimOrderSummary {
  id: string;
  reference: string;
  paymentId: string;
  paidPaise: Paise;
}

export interface Claim {
  id: string;
  reference: string;
  orderId: string;
  order: ClaimOrderSummary;
  customer: Customer;
  status: ClaimStatus;
  statusLabel: string;
  submittedAt: ISODateTime;
  approvedAt?: ISODateTime;
  completedAt?: ISODateTime;
  reason: ReturnReason;
  reasonLabel: string;
  claimText: string;
  itemSummary: string;
  returnedItems: readonly ReturnedItem[];
  amountPaise?: Paise;
  review: ClaimReview;
  decision?: RefundPlan;
  execution?: ClaimExecutionSummary;
}

export interface CalculationIssue {
  code:
    | "invalid_money"
    | "invalid_quantity"
    | "order_total_mismatch"
    | "policy_not_active"
    | "policy_mismatch"
    | "ambiguous_item"
    | "line_not_found"
    | "duplicate_returned_item"
    | "quantity_exceeds_order"
    | "liability_unresolved"
    | "reason_not_refundable"
    | "transfer_not_found"
    | "reversal_exceeds_remaining"
    | "refund_exceeds_remaining_payment"
    | "reconciliation_mismatch"
    | "plan_semantics_mismatch"
    | "empty_return";
  severity: "review" | "blocked";
  message: string;
  path?: string;
}

export type RefundCalculationResult =
  | { status: "ready"; plan: RefundPlan; issues: readonly [] }
  | { status: "needs_review"; issues: readonly CalculationIssue[] }
  | { status: "blocked"; issues: readonly CalculationIssue[]; plan?: RefundPlan };

export interface RefundCalculationInput {
  claim: Pick<Claim, "id" | "reason" | "returnedItems"> & {
    review: Pick<ClaimReview, "liability">;
  };
  order: Order;
  policy: Policy;
  sellers: readonly Seller[];
  calculatedAt?: ISODateTime;
}

export interface ActivityEvent {
  id: string;
  type:
    | "claim_received"
    | "item_extracted"
    | "calculation_created"
    | "approval_recorded"
    | "transfer_reversed"
    | "refund_created"
    | "provider_failure"
    | "provider_snapshot_checked"
    | "execution_started"
    | "reconciliation_pending"
    | "duplicate_event_ignored"
    | "manual_review_requested"
    | "recovery_updated";
  outcome: "info" | "success" | "warning" | "danger";
  claimId?: string;
  orderId?: string;
  occurredAt: ISODateTime;
  actor: string;
  summary: string;
  requestId?: string;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}
