import type { ISODateTime } from "./types";

export interface VerifiedWebhookEnvelope {
  providerEventId: string;
  eventType: string;
  /** SHA-256 or equivalent digest computed from the verified raw request body. */
  bodyFingerprint: string;
  receivedAt: ISODateTime;
  signatureVerified: boolean;
}

export type WebhookAdmission =
  | { outcome: "accepted" }
  | { outcome: "duplicate"; firstReceivedAt: ISODateTime }
  | { outcome: "rejected_unverified" }
  | { outcome: "id_conflict"; firstReceivedAt: ISODateTime };

interface InboxEntry {
  bodyFingerprint: string;
  eventType: string;
  firstReceivedAt: ISODateTime;
}

/**
 * Idempotent webhook admission ledger. Signature verification must happen on
 * the untouched raw body before calling admit; duplicate event IDs are ignored.
 */
export class InMemoryWebhookInbox {
  private readonly entries = new Map<string, InboxEntry>();

  admit(envelope: VerifiedWebhookEnvelope): WebhookAdmission {
    if (!envelope.signatureVerified) return { outcome: "rejected_unverified" };
    if (!envelope.providerEventId.trim() || !envelope.bodyFingerprint.trim()) {
      throw new Error("Webhook event ID and raw-body fingerprint are required");
    }
    const prior = this.entries.get(envelope.providerEventId);
    if (!prior) {
      this.entries.set(envelope.providerEventId, {
        bodyFingerprint: envelope.bodyFingerprint,
        eventType: envelope.eventType,
        firstReceivedAt: envelope.receivedAt,
      });
      return { outcome: "accepted" };
    }
    if (prior.bodyFingerprint === envelope.bodyFingerprint && prior.eventType === envelope.eventType) {
      return { outcome: "duplicate", firstReceivedAt: prior.firstReceivedAt };
    }
    return { outcome: "id_conflict", firstReceivedAt: prior.firstReceivedAt };
  }
}

