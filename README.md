# ReturnSplit

**Map every approved marketplace refund to the right seller transfer.**

ReturnSplit is a financial-control workbench for multi-vendor marketplaces using Razorpay Route. It starts after a return is approved: the product accepts a proposed returned-line match and policy citation, validates them against the order, calculates exact integer-paise movements, asks a human to approve the frozen plan, reverses the required seller transfers, and only then refunds the customer. The included extraction results are precomputed demo fixtures, not a measured production model.

The default provider is a deterministic demo simulator. It cannot move real money. An environment-selected Razorpay **Test Mode** adapter is also wired into the runtime for teams that supply their own test credentials and matching Test Mode payment/transfer fixtures. Live keys are rejected, and seeded demo IDs are never sent externally.

## Why this exists

For a full refund, Route can reverse all linked transfers. For a partial refund spanning a subset of marketplace items, the merchant must identify and reverse the correct transfer amounts. That creates a risky manual junction between return evidence, seller contracts, order allocation, and payment state.

ReturnSplit makes that junction explicit and auditable. It is intentionally not a return-eligibility or fraud product.

## Run locally

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The golden path is `RET-260903-031`.

Production deployments must set `RETURNSPLIT_APP_ORIGIN` to their exact public
origin. Razorpay Test Mode requests have an 8-second default deadline; override
it with `RAZORPAY_REQUEST_TIMEOUT_MS` (10–30000) when needed. A timeout leaves
the operation in reconciliation-required state because provider finality is
unknown.

```bash
pnpm test
pnpm eval:batch
pnpm eval:forecast
pnpm lint
pnpm build
```

## What the demo proves

- Exact golden case: customer refund `232854`, Aavya reversal `197926`, Mora contribution `34928`, shipping refund `0`—all integer paise.
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

## TimesFM exposure forecasting

The Risk page forecasts aggregate daily refund exposure, not individual liability. By default it uses a deterministic seasonal baseline so the app works without model weights. Set `TIMESFM_ENDPOINT` to use the included Python sidecar with Google TimesFM 2.5 and its p10/p50/p90 output.

```bash
cp .env.example .env.local
python -m venv .venv
source .venv/bin/activate
pip install -r services/timesfm/requirements.txt
uvicorn services.timesfm.app.main:app --host 127.0.0.1 --port 8091 --workers 1
```

The sidecar contract can be tested without loading model weights:

```bash
pnpm test:timesfm
```

`pnpm eval:forecast` performs bounded rolling-origin 7/14/30-day backtests
against seasonal-naive and last-value baselines. Without a healthy configured
sidecar, the report identifies every candidate row as deterministic fallback
and makes no TimesFM accuracy claim. See [evaluation.md](docs/evaluation.md)
for real aggregate input and strict `--require-timesfm` usage.

TimesFM 2.5 is used because its model weights are Apache-2.0. TimesFM 3.0 is newer, but its published checkpoint is currently restricted to non-commercial, non-production use. Forecasts inform reserve planning and staffing only; they never approve or size a claim-level reversal.

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

## Architecture

```text
approved claim + order + frozen policy + Route transfers
                         │
                  evidence extraction
                  (untrusted candidate facts)
                         │
             deterministic paise calculation
                         │
               invariants + human approval
                         │
          persisted reversal → refund execution saga
                         │
             provider reconciliation + audit trail
```

See [architecture.md](docs/architecture.md), [threat-model.md](docs/threat-model.md), and [evaluation.md](docs/evaluation.md).

## Truthful scope

This repository is a polished prototype and engineering harness, not production financial infrastructure. Before live deployment it still needs durable storage and distributed locks, authenticated tenant isolation and maker-checker authorization, a job queue, rate limiting, WORM or hash-chained audit retention, real marketplace data validation, and a recorded Razorpay Test Mode trace. The current operations cases and standalone preflight records are intentionally process-local.

## Sources

- [Razorpay Route: refund payments and reverse transfers](https://razorpay.com/docs/api/payments/route/refund-payments-and-reverse-transfer/)
- [Razorpay Route: reverse a transfer](https://razorpay.com/docs/api/payments/route/reverse-a-transfer/)
- [Google Research TimesFM](https://github.com/google-research/timesfm)
