# Evaluation protocol

ReturnSplit evaluates three layers independently: claim extraction, deterministic allocation, and the end-to-end disposition (`execute`, `no_reversal`, or `abstain`). Abstention is deferred work, not a financial false negative.

## Release-blocking invariants

- Every amount is a non-negative safe integer number of paise.
- A reversal never exceeds its remaining transfer balance.
- Total refunds never exceed the captured payment.
- Seller funding plus marketplace funding equals the customer refund.
- Every touched transfer belongs to the payment and mapped seller.
- Discounts and shipping allocation conserve every paise.
- Duplicate requests and events produce no duplicate effects.
- The refund is sent only after required reversals are confirmed.
- Unknown provider results trigger reconciliation, not blind retry.

The repository runs 10,000 seeded randomized allocation trials plus focused state and failure tests. That is engineering validation, not evidence of model accuracy.

`pnpm eval:batch` runs 64 generated finance-control inputs through the real deterministic refund engine and compares its customer-refund and transfer-reversal vectors with independently specified expected decisions. The batch covers discounts, partial quantities, multiple sellers, shared transfers, non-refundable returns, ambiguity, unclear liability, and insufficient balances. It reports `execute`, `no_reversal`, `abstain`, and `blocked` separately, emits the complete exception list, measures wrong-seller overage in paise, and records wall-clock throughput plus p50/p95 in-process case latency. Those timings exclude networks, storage, model inference, and provider calls; they are engine microbenchmark evidence rather than production capacity. Claim facts are pre-structured, so the resulting match rate validates the post-extraction finance-control loop only; it must not be quoted as extraction or model accuracy.

## Model evaluation plan

Use group-isolated development, calibration, in-distribution test, out-of-distribution test, and a manually written English/Hindi/Hinglish challenge set. Report exact reversal-vector accuracy, mandatory-abstention recall, unsafe automation rate, wrong-seller rupees, rupee precision/recall, coverage, evidence-span validity, latency, and cost with raw numerators and group-bootstrap confidence intervals.

Select automation thresholds on calibration data only. Require a one-sided 95% upper bound below 1% unsafe automation and zero wrong-seller rupees, then freeze the threshold before sealed test evaluation.

Production claims require at least 100 representative, de-identified, blind double-annotated cases, independent reruns, Razorpay Test Mode traces, and shadow-mode comparison with human decisions.

## Aggregate refund-forecast backtest

`pnpm eval:forecast` runs a leakage-safe rolling-origin evaluation at 7, 14,
and 30 days. Each origin gives the candidate only the history that existed at
that cutoff, then scores its p50 forecast against a strict seven-day
seasonal-naive baseline and a last-value baseline. The JSON report includes:

- MAE and WAPE, with exact raw paise totals;
- empirical p10-p90 coverage and p10/p50/p90 pinball loss for the candidate;
- candidate-minus-baseline error deltas (negative is better);
- per-origin source labels and counts for TimesFM versus deterministic fallback;
- a SHA-256 dataset fingerprint, cutoff windows, protocol settings, and an
  explicit non-production release gate.

The default input is the 56-day synthetic Creo Market series and the latest
five eligible origins per horizon. Its results are illustrative engineering
checks, never production accuracy. The Evaluation page includes a dated summary
of the latest strict run so judges can inspect the evidence without treating it
as a live health signal. To evaluate a local aggregate series:

```bash
pnpm --silent eval:forecast -- --input ./daily-refunds.json --max-origins all \
  --evaluated-at 2026-09-04T12:00:00.000Z
```

The input is either an array of `{ "date": "YYYY-MM-DD", "valuePaise": 123 }`
records or `{ "datasetLabel": "...", "history": [...] }`. Dates must be
consecutive and values must be positive integer paise. The evaluator labels
file input as user-supplied aggregate data; it does not infer provenance or
representativeness.

Set `TIMESFM_ENDPOINT` and its optional server credential to measure TimesFM.
The CLI loads the repository-root `.env*` files with Next's supported
`@next/env` loader; an explicitly exported shell value keeps precedence.
Calls are sequential because the bundled sidecar serializes inference. A
missing, rejected, unavailable, timed-out, or invalid endpoint yields a
clearly counted deterministic-fallback origin. Use `--require-timesfm` in a CI
or evidence run to exit with status 2 unless every origin used TimesFM output:

```bash
TIMESFM_ENDPOINT=http://127.0.0.1:8091/v1/forecast \
TIMESFM_API_TOKEN=local-secret \
pnpm --silent eval:forecast -- --input ./daily-refunds.json --require-timesfm
```

`--silent` suppresses pnpm's command banner so redirected stdout is a clean
JSON artifact.

The point baselines do not claim probabilistic intervals, so their coverage
and pinball fields are `null`. Overlapping rolling windows are correlated; the
report therefore does not manufacture confidence intervals or a production
approval. Calibration and promotion still require representative held-out
history, a frozen model/service revision, missing-data controls, and repeated
shadow evaluation.
