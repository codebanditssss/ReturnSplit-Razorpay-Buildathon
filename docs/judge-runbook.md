# ReturnSplit judge runbook

This runbook produces a deterministic three-to-five-minute demonstration of
the repository's strongest path and its safety boundaries. The default flow
uses simulated provider state and cannot move real money.

## One-sentence pitch

ReturnSplit maps every approved marketplace refund to the correct seller
transfer, asks a person to approve the exact plan, reverses seller funds first,
and only then refunds the customer.

## Buildathon position

Enter under **Track 04 — AI Finance Controller**. The demonstrated loop is an
approved return through funding attribution, exception handling, controlled
execution, and audit. The repository includes a 64-record synthetic
finance-control replay, reports an explicit exception list, and separately uses
TimesFM for aggregate refund cash planning.

Do not position ReturnSplit as return fraud detection or eligibility scoring.
Do not describe the 64-record replay as model accuracy: its inputs are already
structured.

## Preflight and reset

### Required default demo

From the repository root:

```sh
pnpm install
pnpm test
pnpm eval:batch
pnpm typecheck
pnpm lint
pnpm build
pnpm dev
```

Open <http://localhost:3000/claims>. Confirm that:

- the shell says **Simulation · No live money**;
- `RET-260903-031` is **Ready to approve**;
- the console command reports 64 records, 64 fixture assertions, 48 automated
  fixtures, 16 exceptions, 0 unsafe automations, and 0 wrong-seller paise.

The simulation state is held by the Next.js server process. Open **Settings → Simulation
scenarios** and launch **Golden approval** before presenting. This clears all
session mutations, reconstructs provider balances, and opens the known claim;
a browser refresh alone intentionally preserves state.

No Razorpay credentials are required or used for the default path.

### Optional TimesFM path

The Risk page always works. Without a healthy sidecar it deliberately shows a
labeled deterministic seasonal fallback. To demonstrate actual TimesFM 2.5,
install and start the optional service before starting Next.js:

```sh
python -m venv .venv
source .venv/bin/activate
pip install -r services/timesfm/requirements.txt
TIMESFM_SERVICE_TOKEN=local-secret \
  uvicorn services.timesfm.app.main:app --host 127.0.0.1 --port 8091 --workers 1
```

In `.env.local`, configure the matching caller values:

```dotenv
TIMESFM_ENDPOINT=http://127.0.0.1:8091/v1/forecast
TIMESFM_API_TOKEN=local-secret
TIMESFM_TIMEOUT_MS=5000
```

Restart the Next.js process after changing `.env.local`. Wait for the model to
load and warm up, then check:

```sh
curl http://127.0.0.1:8091/healthz
curl 'http://127.0.0.1:3000/api/forecasts/refunds?horizon=14'
```

The health response should be ready, and the app response must contain
`"source":"google_timesfm_2_5"`. If it contains
`"source":"deterministic_seasonal_fallback"`, present it as the fallback; do
not say TimesFM produced that forecast.

Model startup may download the pinned roughly 925 MB checkpoint when it is not
cached. The sidecar is optional for the core refund-control demo.

## Four-minute deterministic script

Keep the browser zoom at 100%. Use the direct routes below so navigation timing
does not depend on search or filters.

### 0:00–0:30 — Frame the job

Open <http://localhost:3000/claims>.

Say:

> “A marketplace refund is not one number. On a multi-seller order, finance has
> to map the approved return to the right Route transfer, apply the policy and
> discount correctly, and recover seller funds before refunding the customer.
> ReturnSplit either produces that controlled plan or stops for review.”

Point to the queue states: ready, review, blocked, and retry/reconciliation.
State once that this is demo data and no live money moves.

### 0:30–1:45 — Show and execute the golden claim

Open <http://localhost:3000/claims/RET-260903-031>.

Say:

> “This return was already approved. The evidence match shown here is a
> precomputed fixture, not a claimed production extraction result. The system
> validates it against the order and policy before calculating money.”

Show the customer quote, matched kurta, policy citation, and exact plan:

| Movement | Expected amount |
| --- | ---: |
| Aavya Textiles transfer reversal | ₹1,979.26 |
| Creo Market contribution | ₹349.28 |
| Customer refund | ₹2,328.54 |
| Outbound shipping refund | ₹0.00 |

Point out that seller funding plus marketplace funding equals the customer
refund, and that approval is bound to the plan fingerprint.

Click **Check current balances** and show that the payment and required Route
transfer match the reviewed snapshot. Then click **Approve and execute**, review
the confirmation, and click **Reverse and refund**.
Wait for **Execution complete**.

Say:

> “The simulator follows the real control order: refresh provider balances,
> record intent, reverse the required seller transfer, confirm it, then create
> the customer refund. The execution endpoint repeats the balance check, and
> the deterministic engine—not a model—supplies every amount.”

### 1:45–2:25 — Show abstention and a hard block

Open <http://localhost:3000/claims/RET-260903-033>.

Say:

> “The order has two linen-shirt variants and the evidence does not distinguish
> them. ReturnSplit abstains instead of charging a guessed seller.”

First expand **Cannot determine from this evidence**. Explain that an operator
can record why the evidence is insufficient and open an owned, due-dated
customer-evidence request instead of guessing. For the main run, choose either
exact order variant and click **Confirm item and recalculate**. Show that the
decision persists, the real paise engine runs again, and a new
fingerprint-bound plan becomes ready for approval.

Then open <http://localhost:3000/claims/RET-260903-038>.

Say:

> “This transfer has only ₹49.15 left to reverse, so approval is blocked. A
> confident item match does not override provider balance.”

Click **Escalate to payments ops** and show the persisted reconciliation case,
owner, due time, and next action. Approval remains unavailable; escalation
records work instead of bypassing the balance check.

### 2:25–3:00 — Show safe recovery

Open <http://localhost:3000/claims/RET-260903-041>.

Say:

> “Aavya's reversal is already confirmed. Field Notes returned a retryable
> failure, and the customer refund has not been sent. Retry resumes the same
> saga and skips the completed reversal.”

Click **Retry and finish** and wait for completion. Emphasize that an
unknown response would be reconciled by stable receipt and provider state; it
would never be blindly posted again.

### 3:00–3:35 — Prove the batch, not a cherry-picked case

Open <http://localhost:3000/evaluation>.

Say:

> “Track 04 asks for a finance loop across more than 50 synthetic records with
> measured results and honest exceptions. This run evaluates 64 structured
> control records: 48 close automatically, 16 abstain or block, and the included
> fixture set has zero unsafe automations and zero wrong-seller overage.”

Immediately add:

> “That is deterministic fixture agreement, not extraction-model accuracy. A
> representative, blind, multilingual claim benchmark is still required.”

Expand **View all 16 exceptions** if a judge wants the complete failure list.
The same page contains the dated TimesFM backtest summary and both baselines.
If a judge asks for reproducibility, show `pnpm eval:batch` and
`pnpm --silent eval:forecast -- --require-timesfm` in the terminal.

### 3:35–4:10 — Show cash planning without crossing the control boundary

Open <http://localhost:3000/risk> and switch between 7, 14, and 30 days. Point
out the available reserve, priced open commitment, blocked exposure, unpriced
claim count, and the resulting headroom or top-up recommendation.

Read the source badge before speaking:

- If it says **TimesFM 2.5**, say it is a zero-shot forecast over synthetic
  aggregate daily approved-refund totals.
- If it says **Seasonal fallback**, say the model is unavailable and the product
  has degraded safely to its labeled deterministic planning baseline.

Say:

> “Forecasting helps finance plan refund reserves and staffing. It never decides
> whether a claim is eligible, who is liable, which transfer to reverse, or what
> amount to move.”

Add that current open claims are included once outside the forecast, while the
forecast represents new authorizations after the history cutoff.

Do not claim production forecast accuracy. The checked-in evidence is a strict
rolling-origin backtest on synthetic history; no representative production
backtest or calibration exists.

### Optional — Show the recovery ledger

Reset to **Liability decision**, front the refund from Creo Market, and complete
the zero-reversal refund. The completed claim stays in the Open and Recovery
queues because customer settlement and marketplace recovery are separate facts.
On the claim, record a partial courier recovery, then allocate the remaining
target to write-off and close it. Point out the cumulative paise controls,
responsible party, redacted note history, due/age state, and the queue transition
from Recovery (1) to Recovery (0).

### 4:10–4:30 — Close

Say:

> “ReturnSplit is a control layer between approved return evidence and Razorpay
> Route. Its product principle is simple: automate the unambiguous finance work,
> surface every exception, and never let probabilistic output directly move
> money.”

## Expected demo evidence

| Demonstration | Evidence to point at |
| --- | --- |
| Correct funding | ₹1,979.26 seller + ₹349.28 marketplace = ₹2,328.54 customer refund |
| Safe execution | Reversal completes before refund in the progress and audit states |
| Ambiguity handling | `RET-260903-033` requires an item match instead of creating a plan |
| Balance protection | `RET-260903-038` is blocked with ₹49.15 remaining reversible balance |
| Retry safety | `RET-260903-041` retains the confirmed Aavya reversal and retries only the remaining work |
| Batch breadth | 64 synthetic controls: 40 execute, 8 no-reversal, 12 abstain, 4 blocked |
| Exception honesty | 16 surfaced exceptions; the list includes ambiguity, unclear liability, and insufficient balance |
| Engine throughput | Wall-clock records/second and p50/p95 in-process case latency; excludes provider and network time |
| Forecast boundary | Model/fallback source is visible and the page states planning-only use |
| Forecast evidence | 15/15 recorded TimesFM origins, zero fallbacks, WAPE and baseline comparisons; synthetic only |

## Likely judge questions

### Where is the AI?

TimesFM 2.5 is optionally used for aggregate refund-exposure forecasting. The
claim evidence shown in the demo is precomputed. Money calculation, validation,
authorization, and execution are intentionally deterministic. A future
extraction model must pass the evaluation gate before it can propose live claim
facts.

### Why is this not just a Razorpay dashboard feature?

Razorpay supplies the payment and transfer primitives. ReturnSplit's proposed
merchant-side layer joins those primitives to marketplace-specific order lines,
seller ownership, return evidence, and frozen liability policies, then manages
the approval and exception workflow. This is a product-layer distinction, not
a claim that Razorpay lacks adjacent capabilities.

### Is it integrated with Razorpay?

The runtime can select either the local simulator or the Razorpay Test Mode
adapter by environment. The demonstrated fixtures use the simulator because no
credentials or matching Test Mode payment/transfer IDs were supplied. Seeded
demo IDs are blocked from external requests, no external trace was recorded,
and live mode is disabled.

### Is it 100% accurate?

No. The deterministic engine matches all 64 independently specified expected
decisions in the generated control set. That does not measure extraction or
real-world accuracy. The planned gate requires representative de-identified
claims, blind annotation, a sealed multilingual set, and Test Mode traces.

### How do you prevent duplicate money movement?

Approval binds the exact plan fingerprint. The saga records intent before each
provider call, refund requests reuse an idempotency key, webhooks are
deduplicated, and an unknown reversal result is reconciled by receipt and
provider state before any retry.

### Is TimesFM making claim decisions?

No. It sees aggregate daily totals and produces a planning range. Its output
cannot affect eligibility, liability, transfer selection, exact paise amounts,
approval, or execution priority.

### Is it production-ready?

No. Production still requires authentication and tenant isolation, durable
database-backed state and locks, a job queue, production audit retention,
observability, real marketplace validation, and recorded Razorpay Test Mode
evidence.

### What is the commercial value?

The value hypothesis is reduced operator time and fewer mapping or recovery
errors. Use the customer-specific formula in [Business case](business-case.md);
do not present its illustrative values as measured savings.

## Failure-safe presentation

- If the app state was previously mutated, restart the Next.js process.
- If approval visibly fails, keep the error on screen and explain that execution
  paused before an unsafe continuation; then use the Evaluation page for the
  deterministic evidence.
- If TimesFM is unavailable, demonstrate the labeled fallback and explain why
  model failure cannot block the refund-control workflow.
- If network access is unavailable, the default demo and synthetic replay still
  run locally after dependencies and model-independent assets are installed.
- Do not switch to live credentials or improvise provider calls during judging.

## Claims to avoid

Do not say:

- “AI approves refunds” or “AI decides seller liability.”
- “100% accurate” without limiting the statement to the included fixture
  assertions.
- “Production-ready,” “live with Razorpay,” or “Razorpay-approved.”
- “64 real claims”; they are generated, pre-structured records.
- “Zero financial loss” beyond the included synthetic replay.
- “TimesFM predicts individual returns, fraud, or liability.”
- “The forecast is calibrated”; it has not been backtested on production data.
- “The UI decisions are durable”; the current demo state is in memory.

## Reference links

- [Business case](business-case.md)
- [Repository overview](../README.md)
- [Architecture and trust boundaries](architecture.md)
- [Evaluation protocol](evaluation.md)
- [Threat model](threat-model.md)
- [TimesFM service contract](../services/timesfm/README.md)
- [Razorpay AI Buildathon](https://razorpay.com/buildathon/)
- [Razorpay Route refund and transfer reversal documentation](https://razorpay.com/docs/api/payments/route/refund-payments-and-reverse-transfer/)
