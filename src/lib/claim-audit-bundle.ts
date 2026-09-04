import { createHash } from "node:crypto";
import type { ExecutionSaga, SagaAuditRecord } from "./execution-saga";
import { maskProviderReference } from "./claim-workbench-view";
import { refundPlanFingerprint } from "./execution-saga";
import type { ProviderIdentity } from "./provider";
import type { ActivityEvent, Claim, Order, Policy } from "./types";
import type { DemoCompletion, DemoEscalation } from "@/server/demo-runtime";

const EXPORTED_AUDIT_DETAIL_KEYS = new Set([
  "amountPaise",
  "attempt",
  "code",
  "customerRefundPaise",
  "isOverride",
  "marketplaceFundedPaise",
  "outcome",
  "planFingerprint",
  "policyVersion",
  "priorState",
  "providerMode",
  "providerSnapshotVerifiedAt",
  "retryable",
  "sellerFundedPaise",
]);

export interface ClaimAuditBundleInput {
  claim: Claim;
  order: Order;
  policy: Policy;
  provider: ProviderIdentity;
  activity: readonly ActivityEvent[];
  saga?: ExecutionSaga;
  completion?: DemoCompletion;
  escalation?: DemoEscalation;
  generatedAt?: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeAuditDetail(detail: SagaAuditRecord["detail"]): Readonly<Record<string, string | number | boolean>> {
  return Object.fromEntries(
    Object.entries(detail).filter(([key]) => EXPORTED_AUDIT_DETAIL_KEYS.has(key)),
  );
}

/**
 * Produces an allowlisted operator export. It intentionally omits customer
 * contact data, linked-account IDs, raw payment/transfer IDs, provider
 * receipts, idempotency keys, credentials, and arbitrary audit metadata.
 */
export function buildClaimAuditBundle({
  claim,
  order,
  policy,
  provider,
  activity,
  saga,
  completion,
  escalation,
  generatedAt = new Date().toISOString(),
}: ClaimAuditBundleInput) {
  const plan = claim.decision;
  const executionReversals = saga?.reversals.map((step) => ({
    sellerName: plan?.sellerReversals.find((entry) => entry.transferId === step.transferId)?.sellerName ?? "Recorded seller",
    amountPaise: step.amountPaise,
    status: step.status,
    attempts: step.attempts,
    providerStatus: step.providerStatus,
    providerReference: maskProviderReference(step.providerId),
    updatedAt: step.updatedAt,
  })) ?? completion?.reversals.map((step) => ({
    sellerName: plan?.sellerReversals.find((entry) => entry.transferId === step.transferId)?.sellerName ?? "Recorded seller",
    amountPaise: step.amountPaise,
    status: "succeeded" as const,
    attempts: null,
    providerStatus: "recorded_completion",
    providerReference: maskProviderReference(step.providerId),
    updatedAt: completion.completedAt,
  })) ?? [];

  const approval = saga?.approval
    ? {
        actor: saga.approval.actorName,
        approvedAt: saga.approval.approvedAt,
        requestId: saga.approval.requestId,
        isOverride: saga.approval.isOverride,
        ...(saga.approval.overrideReason
          ? { overrideReasonSha256: sha256(saga.approval.overrideReason) }
          : {}),
      }
    : claim.approvedAt
      ? {
          actor: claim.execution?.approvedBy ?? "Recorded operator",
          approvedAt: claim.approvedAt,
          requestId: claim.execution?.requestId ?? "not_recorded",
          isOverride: false,
        }
      : null;

  return {
    schemaVersion: "1.0",
    kind: "returnsplit_redacted_claim_audit_bundle",
    generatedAt,
    scope: "operator_export",
    redaction: {
      policy: "allowlist_v1",
      omitted: [
        "customer contact details",
        "linked-account identifiers",
        "raw payment and transfer identifiers",
        "provider receipts and idempotency keys",
        "credentials and arbitrary provider metadata",
      ],
    },
    claim: {
      reference: claim.reference,
      orderReference: order.reference,
      status: claim.status,
      receivedAt: claim.submittedAt,
      reason: { code: claim.reason, label: claim.reasonLabel },
      claimEvidenceSha256: sha256(claim.claimText),
      returnedItems: claim.returnedItems.map((item) => {
        const matchedLine = order.lines.find((line) => line.id === item.orderLineId);
        return {
          title: matchedLine?.title ?? "Unmatched returned item",
          quantity: item.quantity,
          matchConfidence: item.matchConfidence,
          claimedTitleSha256: sha256(item.claimedTitle),
          evidenceSha256: sha256(item.evidenceQuote),
        };
      }),
    },
    review: {
      state: claim.review.state,
      headline: claim.review.headline,
      liableParty: claim.review.liability,
      requiresHumanApproval: claim.review.requiresHumanApproval,
      policyCitation: claim.review.policyCitation,
      flags: claim.review.flags.map((flag) => ({ code: flag.code, label: flag.label })),
    },
    policy: {
      id: policy.id,
      name: policy.name,
      version: policy.version,
      citation: policy.citation,
      effectiveFrom: policy.effectiveFrom,
      effectiveTo: policy.effectiveTo ?? null,
      rules: {
        marketplaceCommissionBps: policy.rules.marketplaceCommissionBps,
        sellerLiableReasons: [...policy.rules.sellerLiableReasons],
        refundOutboundShippingOnPartialReturn: policy.rules.refundOutboundShippingOnPartialReturn,
        refundOutboundShippingOnFullReturn: policy.rules.refundOutboundShippingOnFullReturn,
        customerRemorseRefundable: policy.rules.customerRemorseRefundable,
      },
    },
    decision: plan
      ? {
          planFingerprint: refundPlanFingerprint(plan),
          calculationVersion: plan.calculationVersion,
          calculatedAt: plan.calculatedAt,
          currency: plan.currency,
          customerRefundPaise: plan.customerRefundPaise,
          sellerFundedPaise: plan.sellerFundedPaise,
          marketplaceFundedPaise: plan.marketplaceFundedPaise,
          shippingRefundPaise: plan.shippingRefundPaise,
          lineAllocations: plan.lineAllocations.map((line) => ({
            title: line.title,
            quantity: line.quantity,
            grossPaise: line.grossPaise,
            discountAllocationPaise: line.discountAllocationPaise,
            customerRefundPaise: line.customerRefundPaise,
          })),
          sellerReversals: plan.sellerReversals.map((reversal) => ({
            sellerName: reversal.sellerName,
            amountPaise: reversal.amountPaise,
            remainingReversiblePaise: reversal.remainingReversiblePaise,
            providerReference: maskProviderReference(reversal.providerTransferId),
          })),
          paymentSnapshot: {
            capturedAt: plan.calculatedAt,
            capturedPaymentPaise: plan.providerSnapshot.capturedPaymentPaise,
            previouslyRefundedPaise: plan.providerSnapshot.previouslyRefundedPaise,
            remainingRefundablePaise: plan.providerSnapshot.remainingRefundablePaise,
          },
        }
      : null,
    approval,
    execution: {
      provider: { mode: provider.mode, label: provider.label, isLive: provider.isLive },
      sagaId: saga?.id ?? claim.execution?.sagaId ?? null,
      state: saga?.state ?? claim.execution?.state ?? null,
      createdAt: saga?.createdAt ?? null,
      updatedAt: saga?.updatedAt ?? claim.completedAt ?? null,
      completedAt: saga?.completedAt ?? completion?.completedAt ?? claim.completedAt ?? null,
      reversals: executionReversals,
      refund: saga
        ? {
            amountPaise: saga.refund.amountPaise,
            status: saga.refund.status,
            attempts: saga.refund.attempts,
            providerStatus: saga.refund.providerStatus,
            providerReference: maskProviderReference(saga.refund.providerId),
            updatedAt: saga.refund.updatedAt,
          }
        : completion
          ? {
              amountPaise: plan?.customerRefundPaise ?? 0,
              status: "succeeded",
              attempts: null,
              providerStatus: "recorded_completion",
              providerReference: maskProviderReference(completion.refundId),
              updatedAt: completion.completedAt,
            }
          : null,
      events: saga?.audit.map((event) => ({
        at: event.at,
        actor: event.actor,
        action: event.action,
        requestId: event.requestId,
        detail: safeAuditDetail(event.detail),
      })) ?? [],
    },
    activity: activity
      .filter((event) => event.claimId === claim.id)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
      .map((event) => ({
        occurredAt: event.occurredAt,
        actor: event.actor,
        type: event.type,
        outcome: event.outcome,
        summary: event.summary,
        requestId: event.requestId ?? null,
      })),
    escalation: escalation
      ? {
          caseId: escalation.caseId,
          kind: escalation.kind,
          createdAt: escalation.createdAt,
          actor: escalation.actor,
          queue: escalation.queue,
          owner: escalation.owner,
          dueAt: escalation.dueAt,
          status: escalation.status,
          nextAction: escalation.nextAction,
          noteRecorded: escalation.noteRecorded,
          rationaleSha256: escalation.rationaleSha256 ?? null,
          closedAt: escalation.closedAt ?? null,
          requestId: escalation.requestId,
        }
      : null,
    limitations: [
      "This export is generated from process-local prototype state and is not a durable audit record.",
      "Provider references are masked and customer contact data is omitted.",
      "Simulation records are not evidence of a Razorpay Test Mode transaction.",
    ],
  } as const;
}
