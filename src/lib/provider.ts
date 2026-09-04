import { assertPaise } from "./money";
import type { Paise } from "./types";

export type ProviderMode = "demo" | "razorpay_test";

export interface ProviderIdentity {
  mode: ProviderMode;
  label: string;
  isLive: false;
}

export interface ReverseTransferRequest {
  providerTransferId: string;
  amountPaise: Paise;
  receipt: string;
  idempotencyKey: string;
  notes: Readonly<Record<string, string>>;
}

export interface CreateRefundRequest {
  paymentId: string;
  amountPaise: Paise;
  receipt: string;
  idempotencyKey: string;
  notes: Readonly<Record<string, string>>;
}

export type ProviderMutationResult =
  | { outcome: "succeeded"; providerId: string; providerStatus: string }
  | { outcome: "failed"; code: string; message: string; retryable: boolean }
  | { outcome: "unknown"; message: string };

export type ProviderReconciliationResult =
  | { outcome: "succeeded"; providerId: string; providerStatus: string }
  | { outcome: "failed"; providerId?: string; code: string; message: string; retryable: boolean }
  | { outcome: "pending"; providerId: string; providerStatus: string }
  | { outcome: "not_found" }
  | { outcome: "unknown"; message: string };

export interface VerifyRefundCapacityRequest {
  paymentId: string;
  expectedCapturedPaymentPaise: Paise;
  expectedRefundedPaymentPaise: Paise;
  expectedRemainingRefundablePaise: Paise;
  transfers: readonly {
    providerTransferId: string;
    expectedSourcePaymentId: string;
    expectedLinkedAccountId: string;
    expectedOriginalAmountPaise: Paise;
    expectedReversedAmountPaise: Paise;
    expectedRemainingReversiblePaise: Paise;
  }[];
}

export type ProviderSnapshotVerification =
  | { outcome: "verified" }
  | { outcome: "mismatch"; message: string }
  | { outcome: "unknown"; message: string };

export interface RoutePaymentProvider extends ProviderIdentity {
  verifyRefundCapacity(request: VerifyRefundCapacityRequest): Promise<ProviderSnapshotVerification>;
  reverseTransfer(request: ReverseTransferRequest): Promise<ProviderMutationResult>;
  reconcileTransferReversal(
    request: Pick<ReverseTransferRequest, "providerTransferId" | "amountPaise" | "receipt">,
  ): Promise<ProviderReconciliationResult>;
  createRefund(request: CreateRefundRequest): Promise<ProviderMutationResult>;
  reconcileRefund(
    request: Pick<CreateRefundRequest, "paymentId" | "amountPaise" | "receipt">,
  ): Promise<ProviderReconciliationResult>;
}

export type DemoFault = "fail_retryable" | "fail_terminal" | "unknown_before_commit" | "unknown_after_commit";

export interface DemoProviderOptions {
  transfers?: Readonly<Record<string, Paise>>;
  payments?: Readonly<Record<string, Paise>>;
}

interface DemoOperation {
  fingerprint: string;
  result: Extract<ProviderMutationResult, { outcome: "succeeded" }>;
}

/**
 * An in-memory, deterministic provider for the product demo and tests. It never
 * performs a network request and its label must remain visible in the UI.
 */
export class DemoRouteProvider implements RoutePaymentProvider {
  readonly mode = "demo" as const;
  readonly label = "Demo data — no Razorpay request";
  readonly isLive = false as const;

  private readonly transferBalances = new Map<string, Paise>();
  private readonly paymentBalances = new Map<string, Paise>();
  private readonly idempotentOperations = new Map<string, DemoOperation>();
  private readonly reversalsByReceipt = new Map<string, DemoOperation>();
  private readonly refundsByReceipt = new Map<string, DemoOperation>();
  private readonly faults = new Map<string, DemoFault[]>();
  private sequence = 1;

  constructor(options: DemoProviderOptions = {}) {
    for (const [id, value] of Object.entries(options.transfers ?? {})) {
      assertPaise(value, `transfer ${id}`);
      this.transferBalances.set(id, value);
    }
    for (const [id, value] of Object.entries(options.payments ?? {})) {
      assertPaise(value, `payment ${id}`);
      this.paymentBalances.set(id, value);
    }
  }

  async verifyRefundCapacity(request: VerifyRefundCapacityRequest): Promise<ProviderSnapshotVerification> {
    assertPaise(request.expectedCapturedPaymentPaise, "expected captured payment amount");
    assertPaise(request.expectedRefundedPaymentPaise, "expected refunded payment amount");
    assertPaise(request.expectedRemainingRefundablePaise, "expected remaining refundable amount");
    if (
      request.expectedCapturedPaymentPaise - request.expectedRefundedPaymentPaise !==
      request.expectedRemainingRefundablePaise
    ) {
      return { outcome: "mismatch", message: "The expected payment balance components do not reconcile." };
    }
    const paymentBalance = this.paymentBalances.get(request.paymentId);
    if (paymentBalance === undefined) {
      return { outcome: "mismatch", message: "The payment is no longer available from the configured provider." };
    }
    if (paymentBalance !== request.expectedRemainingRefundablePaise) {
      return { outcome: "mismatch", message: "The payment refundable balance changed after this plan was calculated." };
    }
    for (const transfer of request.transfers) {
      assertPaise(transfer.expectedOriginalAmountPaise, "expected original transfer amount");
      assertPaise(transfer.expectedReversedAmountPaise, "expected reversed transfer amount");
      assertPaise(transfer.expectedRemainingReversiblePaise, "expected remaining reversible amount");
      if (
        !transfer.expectedSourcePaymentId ||
        !transfer.expectedLinkedAccountId ||
        transfer.expectedSourcePaymentId !== request.paymentId ||
        transfer.expectedOriginalAmountPaise - transfer.expectedReversedAmountPaise !==
          transfer.expectedRemainingReversiblePaise
      ) {
        return { outcome: "mismatch", message: "The expected seller-transfer identity or balance components do not reconcile." };
      }
      const transferBalance = this.transferBalances.get(transfer.providerTransferId);
      if (transferBalance === undefined) {
        return { outcome: "mismatch", message: "A required seller transfer is no longer available from the configured provider." };
      }
      if (transferBalance !== transfer.expectedRemainingReversiblePaise) {
        return { outcome: "mismatch", message: "A seller transfer balance changed after this plan was calculated." };
      }
    }
    return { outcome: "verified" };
  }

  queueFault(operationKey: string, fault: DemoFault): void {
    const queued = this.faults.get(operationKey) ?? [];
    queued.push(fault);
    this.faults.set(operationKey, queued);
  }

  async reverseTransfer(request: ReverseTransferRequest): Promise<ProviderMutationResult> {
    assertPaise(request.amountPaise);
    const fingerprint = `reverse:${request.providerTransferId}:${request.amountPaise}:${request.receipt}`;
    const prior = this.idempotentOperations.get(request.idempotencyKey);
    if (prior) return this.replayOrConflict(prior, fingerprint);

    const available = this.transferBalances.get(request.providerTransferId);
    if (available === undefined) {
      return { outcome: "failed", code: "transfer_not_found", message: "Demo transfer was not seeded", retryable: false };
    }
    if (request.amountPaise > available) {
      return { outcome: "failed", code: "insufficient_balance", message: "Reversal exceeds demo transfer balance", retryable: false };
    }
    return this.withFault(request.idempotencyKey, () => {
      this.transferBalances.set(request.providerTransferId, available - request.amountPaise);
      const operation: DemoOperation = {
        fingerprint,
        result: { outcome: "succeeded", providerId: `demo_rvr_${this.sequence++}`, providerStatus: "processed" },
      };
      this.idempotentOperations.set(request.idempotencyKey, operation);
      this.reversalsByReceipt.set(request.receipt, operation);
      return operation.result;
    });
  }

  async reconcileTransferReversal(
    request: Pick<ReverseTransferRequest, "providerTransferId" | "amountPaise" | "receipt">,
  ): Promise<ProviderReconciliationResult> {
    const operation = this.reversalsByReceipt.get(request.receipt);
    return operation?.fingerprint.includes(`:${request.providerTransferId}:`)
      ? operation.result
      : { outcome: "not_found" };
  }

  async createRefund(request: CreateRefundRequest): Promise<ProviderMutationResult> {
    assertPaise(request.amountPaise);
    const fingerprint = `refund:${request.paymentId}:${request.amountPaise}:${request.receipt}`;
    const prior = this.idempotentOperations.get(request.idempotencyKey);
    if (prior) return this.replayOrConflict(prior, fingerprint);

    const available = this.paymentBalances.get(request.paymentId);
    if (available === undefined) {
      return { outcome: "failed", code: "payment_not_found", message: "Demo payment was not seeded", retryable: false };
    }
    if (request.amountPaise > available) {
      return { outcome: "failed", code: "payment_fully_refunded", message: "Refund exceeds demo payment balance", retryable: false };
    }
    return this.withFault(request.idempotencyKey, () => {
      this.paymentBalances.set(request.paymentId, available - request.amountPaise);
      const operation: DemoOperation = {
        fingerprint,
        result: { outcome: "succeeded", providerId: `demo_rfnd_${this.sequence++}`, providerStatus: "processed" },
      };
      this.idempotentOperations.set(request.idempotencyKey, operation);
      this.refundsByReceipt.set(request.receipt, operation);
      return operation.result;
    });
  }

  async reconcileRefund(
    request: Pick<CreateRefundRequest, "paymentId" | "amountPaise" | "receipt">,
  ): Promise<ProviderReconciliationResult> {
    const operation = this.refundsByReceipt.get(request.receipt);
    return operation?.fingerprint.includes(`:${request.paymentId}:`)
      ? operation.result
      : { outcome: "not_found" };
  }

  private replayOrConflict(operation: DemoOperation, fingerprint: string): ProviderMutationResult {
    return operation.fingerprint === fingerprint
      ? operation.result
      : {
          outcome: "failed",
          code: "idempotency_conflict",
          message: "The idempotency key was already used for a different operation",
          retryable: false,
        };
  }

  private withFault(operationKey: string, commit: () => Extract<ProviderMutationResult, { outcome: "succeeded" }>): ProviderMutationResult {
    const queued = this.faults.get(operationKey) ?? [];
    const fault = queued.shift();
    this.faults.set(operationKey, queued);
    if (fault === "fail_retryable") return { outcome: "failed", code: "demo_timeout", message: "Simulated retryable failure", retryable: true };
    if (fault === "fail_terminal") return { outcome: "failed", code: "demo_rejected", message: "Simulated terminal failure", retryable: false };
    if (fault === "unknown_before_commit") return { outcome: "unknown", message: "Simulated connection loss before provider acknowledgement" };
    if (fault === "unknown_after_commit") {
      commit();
      return { outcome: "unknown", message: "Simulated connection loss after provider commit" };
    }
    return commit();
  }
}

interface RazorpayErrorShape {
  error?: { code?: string; description?: string; reason?: string };
}

interface RazorpayEntity {
  id?: string;
  entity?: string;
  status?: string;
  transfer_id?: string;
  payment_id?: string;
  source?: string;
  recipient?: string;
  amount?: number;
  amount_refunded?: number;
  amount_reversed?: number;
  captured?: boolean;
  currency?: string;
  receipt?: string;
  notes?: Record<string, string>;
}

function isProviderPaise(value: unknown): value is Paise {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export interface RazorpayTestProviderOptions {
  keyId: string;
  keySecret: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

const DEFAULT_RAZORPAY_REQUEST_TIMEOUT_MS = 8_000;
const MAX_RAZORPAY_REQUEST_TIMEOUT_MS = 30_000;

class ProviderRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Razorpay request timed out after ${timeoutMs} ms; provider finality is unknown`);
    this.name = "ProviderRequestTimeoutError";
  }
}

/**
 * Minimal Route adapter for explicitly configured Razorpay Test Mode keys.
 * Live keys are rejected by construction; production credential management is
 * intentionally outside this demo's scope.
 */
export function createRazorpayTestProvider(options: RazorpayTestProviderOptions): RoutePaymentProvider {
  if (!options.keyId.startsWith("rzp_test_")) {
    throw new Error("ReturnSplit accepts only Razorpay Test Mode key IDs in this build");
  }
  if (!options.keySecret) throw new Error("Razorpay Test Mode key secret is required");
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_RAZORPAY_REQUEST_TIMEOUT_MS;
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 10 || requestTimeoutMs > MAX_RAZORPAY_REQUEST_TIMEOUT_MS) {
    throw new Error(`Razorpay request timeout must be between 10 and ${MAX_RAZORPAY_REQUEST_TIMEOUT_MS} ms`);
  }
  const requestFetch = options.fetchImpl ?? fetch;
  // Keep the credential destination fixed. Accepting a caller-provided origin
  // here would turn configuration mistakes into credential-exfiltration risk.
  const apiBaseUrl = "https://api.razorpay.com/v1";
  const authorization = `Basic ${btoa(`${options.keyId}:${options.keySecret}`)}`;

  async function request(path: string, init?: RequestInit): Promise<{ response?: Response; body?: unknown; unknown?: string }> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutFailure = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new ProviderRequestTimeoutError(requestTimeoutMs));
      }, requestTimeoutMs);
    });
    try {
      const response = await Promise.race([
        requestFetch(`${apiBaseUrl}${path}`, {
          ...init,
          signal: controller.signal,
          headers: {
            Authorization: authorization,
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
          },
        }),
        timeoutFailure,
      ]);
      const text = await Promise.race([response.text(), timeoutFailure]);
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = {};
      }
      return { response, body };
    } catch (error) {
      const message = controller.signal.aborted
        ? `Razorpay request timed out after ${requestTimeoutMs} ms; provider finality is unknown`
        : error instanceof Error
          ? error.message
          : "Unknown network failure";
      return { unknown: message };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  function mutationFailure(response: Response | undefined, body: unknown, unknown?: string): ProviderMutationResult {
    if (unknown || !response) return { outcome: "unknown", message: unknown ?? "Provider result was not received" };
    if (response.ok || response.status === 408 || response.status >= 500) {
      return { outcome: "unknown", message: `Razorpay returned an indeterminate HTTP ${response.status} response` };
    }
    const error = body as RazorpayErrorShape;
    return {
      outcome: "failed",
      code: error.error?.code ?? `http_${response.status}`,
      message: error.error?.description ?? error.error?.reason ?? "Razorpay rejected the request",
      retryable: response.status === 429 || response.status >= 500,
    };
  }

  function reversalMutationResult(
    response: Response | undefined,
    body: unknown,
    input: ReverseTransferRequest,
    unknown?: string,
  ): ProviderMutationResult {
    if (unknown || !response || !response.ok) return mutationFailure(response, body, unknown);
    const entity = body as RazorpayEntity;
    if (
      !entity.id ||
      entity.entity !== "reversal" ||
      entity.transfer_id !== input.providerTransferId ||
      entity.amount !== input.amountPaise ||
      entity.currency !== "INR"
    ) {
      return { outcome: "unknown", message: "Razorpay reversal response did not match the requested transfer and amount" };
    }
    if (entity.status && entity.status !== "processed") {
      return { outcome: "unknown", message: `Razorpay reversal status is ${entity.status}; finality is not confirmed` };
    }
    // Razorpay's reversal entity has no status field: its documented success
    // signal is a matching reversal ID in the synchronous 200 response.
    return { outcome: "succeeded", providerId: entity.id, providerStatus: entity.status ?? "processed" };
  }

  function refundMutationResult(
    response: Response | undefined,
    body: unknown,
    input: CreateRefundRequest,
    unknown?: string,
  ): ProviderMutationResult {
    if (unknown || !response || !response.ok) return mutationFailure(response, body, unknown);
    const entity = body as RazorpayEntity;
    if (
      !entity.id ||
      entity.entity !== "refund" ||
      entity.payment_id !== input.paymentId ||
      entity.amount !== input.amountPaise ||
      entity.currency !== "INR" ||
      (entity.receipt !== input.receipt && entity.notes?.returnsplit_receipt !== input.receipt)
    ) {
      return { outcome: "unknown", message: "Razorpay refund response did not match the requested payment, amount, and receipt" };
    }
    if (entity.status === "processed") {
      return { outcome: "succeeded", providerId: entity.id, providerStatus: entity.status };
    }
    if (entity.status === "failed") {
      return { outcome: "failed", code: "provider_failed", message: "Razorpay reports this refund as failed", retryable: false };
    }
    return { outcome: "unknown", message: `Razorpay refund status is ${entity.status ?? "missing"}; finality is not confirmed` };
  }

  function findByReceipt(
    body: unknown,
    expected: { kind: "reversal"; parentId: string; amountPaise: Paise; receipt: string } | { kind: "refund"; parentId: string; amountPaise: Paise; receipt: string },
  ): ProviderReconciliationResult {
    const items = Array.isArray(body) ? body : (body as { items?: unknown[] } | undefined)?.items;
    if (!Array.isArray(items)) return { outcome: "unknown", message: "Provider list response could not be interpreted" };
    const entity = items.find((item): item is RazorpayEntity => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as RazorpayEntity;
      return candidate.receipt === expected.receipt || candidate.notes?.returnsplit_receipt === expected.receipt;
    });
    if (!entity?.id) return { outcome: "not_found" };
    const parentMatches = expected.kind === "reversal"
      ? entity.entity === "reversal" && entity.transfer_id === expected.parentId
      : entity.entity === "refund" && entity.payment_id === expected.parentId;
    if (!parentMatches || entity.amount !== expected.amountPaise || entity.currency !== "INR") {
      return { outcome: "unknown", message: "Provider receipt matched an operation with different immutable fields" };
    }
    if (entity.status === "failed") {
      return { outcome: "failed", providerId: entity.id, code: "provider_failed", message: "Razorpay reports this operation as failed", retryable: false };
    }
    if (entity.status === "pending" || entity.status === "created") {
      return { outcome: "pending", providerId: entity.id, providerStatus: entity.status };
    }
    if (expected.kind === "reversal" && entity.status === undefined) {
      return { outcome: "succeeded", providerId: entity.id, providerStatus: "processed" };
    }
    if (entity.status === "processed") {
      return { outcome: "succeeded", providerId: entity.id, providerStatus: entity.status };
    }
    return { outcome: "unknown", message: `Provider returned an unrecognized ${expected.kind} status` };
  }

  async function reconcilePages(
    path: string,
    expected: { kind: "reversal"; parentId: string; amountPaise: Paise; receipt: string } | { kind: "refund"; parentId: string; amountPaise: Paise; receipt: string },
  ): Promise<ProviderReconciliationResult> {
    const pageSize = 100;
    const maximumPages = 10;
    for (let page = 0; page < maximumPages; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const result = await request(`${path}${separator}count=${pageSize}&skip=${page * pageSize}`);
      if (result.unknown || !result.response) {
        return { outcome: "unknown", message: result.unknown ?? "Provider result was not received" };
      }
      if (!result.response.ok) {
        return { outcome: "unknown", message: `Razorpay reconciliation returned HTTP ${result.response.status}` };
      }
      const reconciliation = findByReceipt(result.body, expected);
      if (reconciliation.outcome !== "not_found") return reconciliation;
      const items = Array.isArray(result.body)
        ? result.body
        : (result.body as { items?: unknown[] } | undefined)?.items;
      if (!Array.isArray(items)) return { outcome: "unknown", message: "Provider list response could not be interpreted" };
      if (items.length < pageSize) return { outcome: "not_found" };
    }
    return { outcome: "unknown", message: "Provider reconciliation exceeded the bounded pagination window" };
  }

  return {
    mode: "razorpay_test",
    label: "Razorpay Test Mode",
    isLive: false,
    async verifyRefundCapacity(input) {
      assertPaise(input.expectedCapturedPaymentPaise, "expected captured payment amount");
      assertPaise(input.expectedRefundedPaymentPaise, "expected refunded payment amount");
      assertPaise(input.expectedRemainingRefundablePaise, "expected remaining refundable amount");
      if (
        input.expectedCapturedPaymentPaise - input.expectedRefundedPaymentPaise !==
        input.expectedRemainingRefundablePaise
      ) {
        return { outcome: "mismatch", message: "The expected payment balance components do not reconcile." };
      }
      const paymentResult = await request(`/payments/${encodeURIComponent(input.paymentId)}`);
      if (paymentResult.unknown || !paymentResult.response) {
        return { outcome: "unknown", message: paymentResult.unknown ?? "The provider payment could not be checked." };
      }
      if (!paymentResult.response.ok) {
        return { outcome: "unknown", message: `Razorpay payment verification returned HTTP ${paymentResult.response.status}.` };
      }
      const payment = paymentResult.body as RazorpayEntity;
      if (
        payment.id !== input.paymentId ||
        payment.entity !== "payment" ||
        payment.currency !== "INR" ||
        !isProviderPaise(payment.amount) ||
        !isProviderPaise(payment.amount_refunded) ||
        payment.amount_refunded > payment.amount ||
        payment.captured !== true
      ) {
        return { outcome: "unknown", message: "Razorpay returned an invalid or uncaptured payment snapshot." };
      }
      if (
        payment.amount !== input.expectedCapturedPaymentPaise ||
        payment.amount_refunded !== input.expectedRefundedPaymentPaise ||
        payment.amount - payment.amount_refunded !== input.expectedRemainingRefundablePaise
      ) {
        return { outcome: "mismatch", message: "The payment refundable balance changed after this plan was calculated." };
      }

      const seenTransferIds = new Set<string>();
      for (const expected of input.transfers) {
        assertPaise(expected.expectedOriginalAmountPaise, "expected original transfer amount");
        assertPaise(expected.expectedReversedAmountPaise, "expected reversed transfer amount");
        assertPaise(expected.expectedRemainingReversiblePaise, "expected remaining reversible amount");
        if (
          seenTransferIds.has(expected.providerTransferId) ||
          expected.expectedSourcePaymentId !== input.paymentId ||
          !expected.expectedLinkedAccountId
        ) {
          return { outcome: "mismatch", message: "The expected seller-transfer identity is invalid." };
        }
        seenTransferIds.add(expected.providerTransferId);
        const transferResult = await request(`/transfers/${encodeURIComponent(expected.providerTransferId)}`);
        if (transferResult.unknown || !transferResult.response) {
          return { outcome: "unknown", message: transferResult.unknown ?? "A seller transfer could not be checked." };
        }
        if (!transferResult.response.ok) {
          return { outcome: "unknown", message: `Razorpay transfer verification returned HTTP ${transferResult.response.status}.` };
        }
        const transfer = transferResult.body as RazorpayEntity;
        if (
          transfer.id !== expected.providerTransferId ||
          transfer.entity !== "transfer" ||
          transfer.source !== expected.expectedSourcePaymentId ||
          transfer.recipient !== expected.expectedLinkedAccountId ||
          transfer.currency !== "INR" ||
          !isProviderPaise(transfer.amount) ||
          !isProviderPaise(transfer.amount_reversed) ||
          transfer.amount_reversed > transfer.amount ||
          (transfer.status !== "processed" && transfer.status !== "partially_reversed")
        ) {
          return { outcome: "unknown", message: "Razorpay returned an invalid seller-transfer snapshot." };
        }
        if (
          transfer.amount !== expected.expectedOriginalAmountPaise ||
          transfer.amount_reversed !== expected.expectedReversedAmountPaise ||
          transfer.amount - transfer.amount_reversed !== expected.expectedRemainingReversiblePaise
        ) {
          return { outcome: "mismatch", message: "A seller transfer balance changed after this plan was calculated." };
        }
      }
      return { outcome: "verified" };
    },
    async reverseTransfer(input) {
      assertPaise(input.amountPaise);
      const result = await request(`/transfers/${encodeURIComponent(input.providerTransferId)}/reversals`, {
        method: "POST",
        body: JSON.stringify({
          amount: input.amountPaise,
          notes: { ...input.notes, returnsplit_receipt: input.receipt },
        }),
      });
      return reversalMutationResult(result.response, result.body, input, result.unknown);
    },
    async reconcileTransferReversal(input) {
      return reconcilePages(`/transfers/${encodeURIComponent(input.providerTransferId)}/reversals`, {
        kind: "reversal", parentId: input.providerTransferId, amountPaise: input.amountPaise, receipt: input.receipt,
      });
    },
    async createRefund(input) {
      assertPaise(input.amountPaise);
      const result = await request(`/payments/${encodeURIComponent(input.paymentId)}/refund`, {
        method: "POST",
        headers: { "X-Refund-Idempotency": input.idempotencyKey },
        body: JSON.stringify({
          amount: input.amountPaise,
          receipt: input.receipt,
          notes: { ...input.notes, returnsplit_receipt: input.receipt },
        }),
      });
      return refundMutationResult(result.response, result.body, input, result.unknown);
    },
    async reconcileRefund(input) {
      return reconcilePages(`/payments/${encodeURIComponent(input.paymentId)}/refunds`, {
        kind: "refund", parentId: input.paymentId, amountPaise: input.amountPaise, receipt: input.receipt,
      });
    },
  };
}
