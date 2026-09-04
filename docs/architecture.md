# Architecture

## Trust boundaries

ReturnSplit separates three jobs:

1. Evidence extraction proposes allowlisted order lines, normalized reason codes, evidence spans, and policy citations. Its output is untrusted.
2. The deterministic engine validates order ownership and frozen policy versions, allocates discounts with largest-remainder rounding, and calculates every amount in integer paise.
3. The execution boundary re-fetches the payment and required Route transfers, rejects any balance drift from the approved plan, binds a named human approval to the exact plan fingerprint, persists intent before each provider call, and reconciles ambiguous outcomes before any retry.

No claim text, model output, browser state, or client-provided amount crosses directly into a payment request.

TimesFM is the only model required by this prototype. Small classifiers,
embedding/reranking models, Whisper, and a local generative model are deferred
until production inputs create a measured need for them. Evidence extraction is
a replaceable, untrusted boundary; the showcased extraction records are static
fixtures. Operator-note redaction is deterministic so it remains reproducible
and testable.

The claim-detail server component projects domain records into a narrow browser
view model. Customer email, linked-account IDs, and raw provider payment and
transfer IDs remain server-side; the operator UI receives only the fields it
renders and masked provider references. This is data minimization, not a
substitute for production authentication and tenant isolation.

## Implemented claim state model

```text
needs_review ──human resolution──▶ ready_for_approval
      │                 ▲
      └─ evidence case ─┘
ready_for_approval ──approval──▶ processing ──confirmed──▶ completed
                       │              ├─ retryable failure / unknown result
                       │              └─ terminal failure requiring manual action
                       └─ failed safety check──▶ blocked
```

Evidence cases record an owner, due time, next action, a deterministically
redacted rationale, and its digest; completing the review closes that case.
Choosing marketplace funding for uncertain courier/seller responsibility opens
a separate recovery case. That ledger records the recovery target, cumulative
recovered and written-off paise, responsible party, redacted operator note,
aging, and explicit closure. It remains open after the customer refund completes
and remains visible in the work queue until the target is fully accounted for.
`rejection`, `cancellation`, and reservation release are not implemented in
this prototype. A production workflow must add them before operators can abandon
a non-executed claim.

Recovery updates use `POST /api/claims/[id]/recovery` with cumulative integer-
paise recovered and written-off totals, a responsible party, operator note, and
an explicit open/closed state. Totals are monotonic and cannot exceed the frozen
marketplace-funded target. Closure fails unless the complete target is
accounted for, and request IDs are idempotent only for an identical update.

## Implemented execution-saga state model

```text
approved → reversing_transfers → refunding_payment → completed
                   │                    │
                   ├─ reversal_result_unknown
                   ├─ refund_result_unknown
                   └─ failed (retryable or terminal step)
```

A network timeout is an unknown result, never proof of failure. For Route reversal, ReturnSplit records a stable operation receipt in notes and checks the transfer reversal collection before deciding whether a request can be retried. Refund retries reuse `X-Refund-Idempotency` with an identical body.

Before a new saga is inserted, the provider adapter fetches the current payment
and every transfer required by the plan. Payment amount and refunded amount,
plus each transfer's source payment, recipient linked account, status, original
amount, and reversed amount must match the server-side order and approved
snapshot—not merely produce the same remaining balance. The
operator also performs this check explicitly before the approval control is
shown; that standalone result is retained against the plan fingerprint for five
minutes and appears in activity/audit history. The execution endpoint repeats
the check to close the client-to-server gap.
Existing sagas do not rerun this initial check because their own confirmed
movements have necessarily changed those balances; they resume through the
step-level reconciliation rules above.

## Claim audit export boundary

The claim workbench can download a JSON audit bundle generated on demand by an
explicit allowlist. It includes claim and order references, evidence hashes,
the frozen policy and money plan, the plan fingerprint, approval and execution
state, allowlisted saga-event fields, masked provider references, and the ordered
history of evidence, reconciliation, and recovery cases. Customer contact details, raw claim text,
raw evidence excerpts, linked-account IDs, raw payment and transfer IDs,
provider receipts, idempotency keys, credentials, and arbitrary provider or
audit metadata are omitted.

This export is a redacted operator aid, not a durable or tamper-evident audit
record. It is assembled from process-local prototype state, is not signed or
hash-chained as a complete bundle, and can lose session events after a restart.
Production requires authenticated tenant-scoped export authorization, durable
retention, access logging, encryption, and an immutable or independently
verifiable audit store. A simulated bundle is not evidence of a Razorpay Test
Mode transaction.

## Forecast boundary

TimesFM receives only aggregated daily time series such as approved refund paise, seller-recoverable paise, claim count, and processing delay. Its quantiles support treasury reserves and staffing. The reserve view adds forecasted new demand to the current open queue once, deducting only executable seller reversals and reserving blocked, terminal-failure, and provider-unknown claims in full. Forecast output cannot affect claim eligibility, liable party, transfer selection, or exact monetary execution.

The Next.js server calls a separately deployed Python inference endpoint. If unavailable, the page returns a deterministic seasonal baseline with an explicit label. This keeps the user interface available without pretending a foundation model ran.
