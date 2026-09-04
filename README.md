# ReturnSplit

> Map every approved marketplace refund to the right seller transfer.

A partial refund on a multi-seller order is not one payment action. Finance must identify the returned line, recover the correct amount from the correct seller transfer, apply the policy and discount without losing a paise, and still refund the customer exactly once. A guessed match, stale balance, or blind retry can put the marketplace, seller, and customer ledgers out of sync.

ReturnSplit is a financial-control workbench for that gap. It starts **after a return is approved** and either produces an exact, reviewable reversal plan or stops the case before money moves.

**Razorpay AI Buildathon 2026 submission · Track 04 — AI Finance Controller**

## Working workflow

The default demo runs this complete loop with deterministic, process-local state:

1. Accept an approved claim with proposed returned-line and policy evidence. In the included scenarios, these extraction results are precomputed fixtures.
2. Validate the proposal against the order, seller ownership, frozen policy, quantities, payment, and Route transfer snapshot.
3. Calculate the customer refund, seller recovery, marketplace contribution, discounts, and shipping in integer paise.
4. Abstain on ambiguous evidence; block on an invalid plan or insufficient reversible balance.
5. Freeze the plan behind a SHA-256 fingerprint, refresh provider balances, and require a named human approval.
6. Persist execution intent, reverse every required seller transfer, reconcile uncertain responses, and create the customer refund only after the reversals are confirmed.
7. Record the decision and execution trail in a redacted, downloadable claim audit bundle.

Models do not supply payment amounts or receive payment authority. TimesFM is used only for aggregate refund-exposure planning; claim validation, allocation, approval, and execution are deterministic.

## Evaluation proof: 64 synthetic controls

`pnpm eval:batch` runs the same paise engine used by the workbench against 64 independently labeled, pre-structured finance-control fixtures.

| Result | Included run |
| --- | ---: |
| Exact expected decisions | 64 / 64 |
| Closed automatically | 48 |
| `execute` | 40 |
| `no_reversal` | 8 |
| Exceptions surfaced | 16 |
| `abstain` | 12 |
| `blocked` | 4 |
| Unsafe automations | 0 |
| Wrong-seller overage | 0 paise |

The 16-item exception list includes ambiguous items, unclear liability, and insufficient transfer balances. Each run also reports wall-clock throughput and p50/p95 in-process latency. Those timings exclude storage, networks, model inference, and provider calls.

This is **fixture agreement for the post-extraction control loop**, not extraction-model accuracy, production capacity, or evidence from real claims. The generator and evaluation contract live in [`src/evaluation/batch.ts`](src/evaluation/batch.ts); the methodology and release gates are in [`docs/evaluation.md`](docs/evaluation.md).

## Golden path

Start in **Settings → Demo tools → Golden approval**, then open [`/claims/RET-260903-031`](http://localhost:3000/claims/RET-260903-031).

The reviewed plan is exact:

| Movement | Amount |
| --- | ---: |
| Aavya Textiles transfer reversal | ₹1,979.26 |
| Creo Market contribution | ₹349.28 |
| Customer refund | ₹2,328.54 |
| Outbound shipping refund | ₹0.00 |

The operator checks current balances, approves the displayed fingerprint, and executes. The saga confirms the seller reversal before creating the customer refund. Repeating the approval resumes the same operation instead of creating a duplicate effect.

The default path uses the simulator and makes no Razorpay network request. The amounts above are asserted in [`tests/refund-engine.test.ts`](tests/refund-engine.test.ts), while ordering and retry behavior are covered in [`tests/execution-saga.test.ts`](tests/execution-saga.test.ts).

## Safe-failure story

Open [`/claims/RET-260903-038`](http://localhost:3000/claims/RET-260903-038). The item and policy match, but a prior partial reversal leaves only **₹49.15** on the required seller transfer. ReturnSplit blocks approval, creates no customer refund, and lets the operator open a persisted payments-reconciliation case. Confidence in the claim cannot override provider balance.

This is the core product rule: unresolved evidence becomes review, stale or insufficient money state becomes a block, and an unknown provider response becomes reconciliation—not a blind retry.

## Architecture

![ReturnSplit claim-control, safe-execution, and advisory cash-planning architecture](docs/screenshots/architecture-control-flow.png)

The claim-control and cash-planning paths are deliberately separate. A forecast cannot change eligibility, liability, seller selection, exact amounts, approval, or execution priority.

## Runtime boundaries

| Path | What is implemented | Boundary |
| --- | --- | --- |
| Deterministic simulator | Default provider; reproduces success, block, retry, and unknown-result scenarios without a network request | In-memory and process-local; cannot move real money |
| Razorpay Test Mode adapter | Fixed Razorpay API origin, Test Mode keys only, balance preflight, transfer reversal, refund idempotency, bounded timeout, and receipt-based reconciliation | Not used by seeded scenarios; matching Test Mode payment and transfer fixtures are required, and no external Test Mode trace is claimed |
| TimesFM 2.5 | Optional sidecar returns validated p10/p50/p90 aggregate-refund forecasts | Falls back to a visibly labeled deterministic seasonal forecast on missing, slow, unavailable, or invalid model output |

Live Razorpay keys are rejected. Seeded demo identifiers are also blocked from the Test Mode adapter.

## Demo routes

| Route | What to verify |
| --- | --- |
| [`/`](http://localhost:3000/) | Product problem and control loop |
| [`/claims`](http://localhost:3000/claims) | Operator queue, filters, states, and simulation label |
| [`/claims/RET-260903-031`](http://localhost:3000/claims/RET-260903-031) | Golden balance check, approval, reversal, and refund |
| [`/claims/RET-260903-033`](http://localhost:3000/claims/RET-260903-033) | Ambiguous item abstention and human resolution |
| [`/claims/RET-260903-038`](http://localhost:3000/claims/RET-260903-038) | Insufficient-balance block and reconciliation escalation |
| [`/claims/RET-260903-041`](http://localhost:3000/claims/RET-260903-041) | Safe resume after one seller reversal already succeeded |
| [`/evaluation`](http://localhost:3000/evaluation) | 64-case replay, complete exception list, and forecast evidence |
| [`/risk`](http://localhost:3000/risk) | 7/14/30-day aggregate exposure forecast with source label |
| [`/settings`](http://localhost:3000/settings) | Provider identity, controls, reset, and seeded scenarios |

## Product walkthrough

| Claims queue | Completed golden claim |
| --- | --- |
| ![Operator queue with explicit review, blocked, retry, and approval states](docs/screenshots/claims-queue.png) | ![Completed refund with the seller reversal confirmed before the customer refund](docs/screenshots/golden-claim.png) |

| Control evaluation | Reserve planning |
| --- | --- |
| ![Sixty-four-case deterministic control evaluation](docs/screenshots/evaluation.png) | ![Aggregate refund reserve forecast with explicit planning boundary](docs/screenshots/risk-forecast.png) |

## Run locally

The core demo needs no provider or model credentials.

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). To reproduce the checked controls:

```bash
pnpm test
pnpm eval:batch
pnpm eval:forecast
pnpm test:timesfm
pnpm typecheck
pnpm lint
pnpm build
```

Optional server-side configuration is documented in [`.env.example`](.env.example). Keep `RETURNSPLIT_PROVIDER_MODE=demo` for the seeded workflows. Use the Razorpay Test Mode adapter only with credentials and matching imported Test Mode identifiers that you control. The optional TimesFM service setup is documented in [`services/timesfm/README.md`](services/timesfm/README.md).

## What the demo proves

- Exact golden case: customer refund `232854`, Aavya reversal `197926`, Creo Market contribution `34928`, shipping refund `0`—all integer paise.
- Ambiguous item and unclear liability become review states, not guessed money movement.
- An operator can explicitly abstain, record a required rationale, and open an owned evidence request with a due time and next action.
- Human item matches and funding decisions persist for the server session, rerun the real calculator, and produce a new approval fingerprint.
- Approval requires a visible, persisted balance refresh, and execution re-fetches the payment and required Route transfers before creating a new saga. Payment components plus transfer source, recipient, status, and amount components must match; any drift fails closed.
- Insufficient reversible balance blocks approval.
- Blocked claims can open an owned payments-reconciliation case. Marketplace-funded uncertainty opens a separate recovery case with a target, recovered and written-off totals, responsible party, notes, aging, and explicit closure rather than silently writing off exposure.
- Duplicate approvals and webhooks cannot create duplicate effects.
- A retry resumes the existing saga and skips confirmed operations.
- An unknown reversal response is re-fetched and reconciled; the POST is never blindly repeated.
- The customer refund is created only after all required reversals are confirmed.
- The claim-detail browser payload excludes customer email, linked-account IDs, and raw provider identifiers.
- The UI labels simulated and Test Mode data honestly.
- Settings can reset all process-local mutations and launch five deterministic demo scenarios.
- A reproducible 64-record synthetic replay runs the real paise engine and reports exact customer-refund/reversal decisions, the complete exception list, unsafe automation, wrong-seller paise, throughput, and p50/p95 in-process latency. Inputs are pre-structured, so it is explicitly not presented as extraction, end-to-end, or production-capacity evidence.

## Security and financial controls

- Integer-paise arithmetic, conservation checks, largest-remainder discount allocation, and caps on refundable and reversible balances.
- Approval bound to evidence hashes, frozen policy rules, seller mapping, quantities, amounts, and provider snapshot through a plan fingerprint.
- Provider balances re-fetched before a new saga; drift fails closed before intent is inserted.
- Execution intent persisted before each call; confirmed reversals are skipped on resume and refunds reuse an idempotency key.
- Unknown reversal or refund outcomes are reconciled by stable receipt and provider state before any retry.
- Customer refund occurs only after every required seller reversal is confirmed.
- Razorpay webhooks use HMAC-SHA256 verification, current/previous secret rotation, body limits, event deduplication, and payload-conflict detection.
- Browser mutations require an exact origin match and bounded JSON bodies.
- Browser view models and audit exports omit customer email, linked-account IDs, raw provider identifiers, credentials, receipts, and idempotency keys.

See [`docs/threat-model.md`](docs/threat-model.md) for threats, implemented controls, and remaining gaps.

## Honest scope and production hardening

This repository is a working prototype and engineering harness, not production financial infrastructure.

Implemented here:

- deterministic allocation and invariant checks;
- human review, balance preflight, approval, execution, retry, reconciliation, and redacted audit flows;
- an in-memory simulator and a server-side Razorpay Test Mode adapter;
- optional TimesFM aggregate forecasting with a deterministic fallback;
- synthetic batch, randomized invariant, webhook, provider, saga, API, and forecast tests.

No additional local model is required for the buildathon proof. Reason classifiers,
semantic policy search, reranking, speech transcription, and a small generative
model become useful only when real merchant inputs justify those capabilities
and their own evaluation gates. The current demo uses precomputed extraction
fixtures, exact policy lookup, and deterministic redaction so model output never
becomes payment authority. Forecasting and backtesting are the only scheduled
model workload in scope.

The Reserve page closes the planning loop without giving the model payment
authority. It adds the current priced queue to forecasted new demand, deducts
only currently executable seller reversals, reserves blocked, terminal-failure,
and provider-unknown claims in full,
and calls out unpriced claims separately. This definition prevents the open
queue from being counted twice in the forecast horizon.

Required before live use:

- a measured extraction pipeline evaluated on representative, de-identified, blind double-annotated claims;
- authenticated tenant isolation, role-based and maker-checker authorization, and rate limits;
- durable database transactions, serializable reservations, distributed locks, fencing, and a job queue;
- encrypted evidence storage, retention controls, immutable or independently verifiable audit records, and monitored secret management;
- imported merchant data, recorded Razorpay Test Mode reversals and webhooks, shadow-mode comparison, and operational runbooks;
- representative forecast backtests, calibration, drift monitoring, capacity testing, and incident recovery exercises.

No production extraction accuracy, live Razorpay deployment, customer savings, or marketplace throughput is claimed.

## Sources

- [Razorpay AI Buildathon](https://razorpay.com/buildathon/)
- [Razorpay Route: refund payments and reverse transfers](https://razorpay.com/docs/api/payments/route/refund-payments-and-reverse-transfer/)
- [Razorpay Route: reverse a transfer](https://razorpay.com/docs/api/payments/route/reverse-a-transfer/)
- [Google Research TimesFM](https://github.com/google-research/timesfm)
- [TimesFM 2.5 model card](https://huggingface.co/google/timesfm-2.5-200m-pytorch)
- [Architecture](docs/architecture.md) · [Evaluation](docs/evaluation.md) · [Judge runbook](docs/judge-runbook.md) · [Business case](docs/business-case.md)
