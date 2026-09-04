# ReturnSplit - proposed plan

Razorpay AI Buildathon 2026 · Track 04, AI Finance Controller

## The problem, stated precisely

On a marketplace running Razorpay Route, a single customer payment is split into transfers to
multiple sellers. When the customer returns one item from a multi-item order, finance has to answer
a question the refund API cannot answer on its own: which seller transfer funded that item, how much
of it must be reversed after commission, discount, and shipping, and whether the customer refund
should be released at all yet.

Razorpay's own Route documentation states that for a partial refund on a payment split across
multiple transfers, the platform cannot decide which transfer to reverse - the caller must. Get it
wrong and three ledgers drift: the marketplace, the seller, and the customer. A guessed match, a
stale balance, or a blind retry turns a routine return into a reconciliation incident.

## What ReturnSplit is

A financial-control layer that begins after a return is approved and does exactly one job well:
turn an approved return into an exact, reviewable reversal plan - or stop the case before any money
moves. It is a controller, not a chatbot. Models never supply amounts and never hold payment
authority.

## What is built for the demo

- A deterministic paise engine: integer-only arithmetic, half-up ratio splits in BigInt,
  largest-remainder discount allocation, and conservation invariants re-checked at calculation and
  again before execution.
- An execution saga with an enforced transition table: reverse every seller transfer, confirm each
  one, and only then create the customer refund. Idempotency keys, persisted intent before every
  provider call, and fail-closed handling of unknown responses.
- Reconciliation instead of retries: an unknown reversal or refund result is re-fetched by stable
  receipt before anything is re-posted.
- A maker-checker approval bound to a SHA-256 plan fingerprint, so approval cannot drift from the
  plan that was reviewed.
- A full operator workbench: claims queue, claim review, orders, policies, reserve planning,
  activity, and a 64-record control evaluation, all served from a process-local runtime.
- A Razorpay Test Mode adapter (Test keys only, live keys rejected by construction) alongside the
  default simulator.
- An optional TimesFM sidecar for aggregate refund-exposure forecasting, with a labeled
  deterministic fallback when the model is not deployed.

## Design decisions, and why

- Two separate paths. Claim control and cash planning never touch. A forecast can inform staffing
  and reserve, but it can never change eligibility, liability, seller selection, exact amounts,
  approval, or execution order.
- Deterministic where money moves. Every rupee decision is reproducible and asserted in tests. The
  model is confined to planning, where being approximately right is acceptable and clearly labeled.
- Honest state. The UI marks simulated and Test Mode data as what it is. Nothing claims a live
  Razorpay trace it did not produce.

## How it maps to the judging axes

- Problem taste: a real, documented gap in Route partial refunds, not a generic finance dashboard.
- Build quality: enforced state machines, invariant checks, idempotency, and a 64-case control
  replay with zero wrong-seller paise.
- AI judgment: the model is used only where it belongs (forecasting) and deliberately kept out of
  the money path; the right tool in the right place.
- Failure recovery: blocks on stale balance, abstains on ambiguous evidence, reconciles on unknown
  provider results, and resumes a partial saga without double-paying.

## Path to production

The demo is a working prototype and engineering harness, not live financial infrastructure. Before
real use it needs: a measured extraction pipeline on de-identified, double-annotated claims;
authenticated tenant isolation with role-based maker-checker authorization; durable transactional
storage with serializable reservations, locks, and a job queue; encrypted evidence storage with
immutable audit records; recorded Test Mode reversals and webhooks under shadow-mode comparison; and
forecast backtesting, calibration, and drift monitoring. No production accuracy, live deployment, or
customer savings are claimed today.
