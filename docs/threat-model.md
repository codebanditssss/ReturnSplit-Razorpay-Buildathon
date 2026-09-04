# Threat model

## Protected assets

- Razorpay credentials and provider identifiers
- Customer and claim evidence
- Seller balances and transfer ownership
- Approval records, plan fingerprints, and audit events
- Refund and reversal idempotency state

## Principal threats and controls

### Prompt injection and hostile evidence

Claims, OCR, uploaded documents, and policies are hostile text. A model receives no provider credentials or payment tools and can emit only a validated, allowlisted extraction schema. Claim text cannot change policy, arithmetic, authorization, or execution ordering. Conflicts and missing evidence force abstention.

### Duplicate or ambiguous payment effects

The saga persists intent before every call. Refund requests reuse one idempotency key. Route reversal does not have documented request idempotency, so the prototype pauses ambiguous responses and looks up the operation by parent resource and stable receipt before proceeding; it never blindly reposts. Before production, reconciliation must additionally verify the amount, operation notes, current `amount_reversed`, pagination, and the provider account/environment.

### Stale or manipulated plans

Approval binds the evidence hashes, complete money-decision policy rules, payment and transfer IDs, seller mapping, ordered and returned quantities, currency, amounts, and provider snapshot. Before inserting a new saga, the server re-fetches the authoritative payment and required transfers. It compares payment amount/refunded components and each transfer's source payment, recipient account, status, original amount, and reversed amount; matching only a derived remainder is insufficient. The operator-facing preflight uses the same check, is retained against the exact plan fingerprint for five minutes, and execution repeats it rather than trusting the browser result. The engine independently re-derives line allocations and reversals from the bound snapshot, and the store rejects later plan mutation. The demo store also atomically reserves returned quantities per order line so distinct claims cannot over-return one purchase. A production store must enforce the same reservation with durable serializable transactions, lock the payment and transfers in stable order, use fencing tokens, and minimize the remaining time-of-check/time-of-use window across provider calls.

### Webhook forgery and replay

The endpoint verifies HMAC-SHA256 over the untouched, size-bounded raw body with constant-time comparison, supports current/previous secrets, deduplicates by environment/event ID, and rejects an event ID reused with a different payload hash. Production must additionally persist before acknowledging, scope events by tenant and provider account, and re-fetch provider truth for consequential changes.

### Browser request abuse

Browser mutation routes require an exact `Origin` match. Production fails closed
unless the public origin is explicitly configured, and request bodies are read
through small streaming byte limits. These controls reduce CSRF and memory
exhaustion risk, but they do not replace authenticated sessions, per-action
authorization, or rate limiting.

### Operations-note privacy

Evidence and recovery notes are normalized, then email addresses, Indian phone
numbers, IP addresses, and long numeric identifiers are deterministically
redacted before process-local storage. The operator receives useful redacted
text plus a SHA-256 integrity digest; raw notes are not retained. This narrow
redactor is not a general PII classifier. Production still requires authenticated
access, tenant isolation, retention controls, and a measured DLP policy for names,
addresses, account references, and merchant-specific identifiers.

### Tenant and secret leakage

Secrets remain server-only and test/live credentials are isolated. The browser
claim view uses an allowlisted DTO and masked provider references; customer
email, linked-account IDs, and raw payment/transfer IDs are not serialized into
that page. Production still requires authenticated tenant scoping, RBAC,
session-bound CSRF tokens, redacted telemetry, upload scanning and limits, and
maker-checker approval for high-value operations.

### Audit export disclosure and integrity

The downloadable claim-audit JSON is constructed through an explicit field
allowlist. It hashes raw claim text and evidence, masks provider references, and
omits customer contact data, linked-account IDs, receipts, idempotency keys,
credentials, and arbitrary saga metadata. The response is marked private and
non-cacheable.

Redaction is not anonymization or authorization. The bundle intentionally still
contains claim and order references, item and seller names, operator identity,
amounts, timestamps, request IDs, policy rules, and workflow outcomes; hashes of
predictable source text can also be vulnerable to guessing. In this prototype
the export route has no authenticated tenant or role check, the source state is
process-local, and the bundle itself has no signature, hash chain, WORM
retention, or independent timestamp. Production must authorize and log every
export, minimize fields for its audience, protect it in transit and at rest,
and generate it from a durable tamper-evident audit store.

## Prototype limitations

The included saga store, operations cases, preflight history, and webhook inbox are in-memory test components. They demonstrate semantics but are not durable across processes or restarts. Separate application workers do not share their locks, so this build must not be used for external money movement. Live mode is intentionally unavailable; only simulation and Razorpay Test Mode are accepted.
