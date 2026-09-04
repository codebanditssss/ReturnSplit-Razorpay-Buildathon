# ReturnSplit business case

> Product and pricing hypotheses for discussion. This document does not claim
> audited market size, production accuracy, customer savings, or a live
> Razorpay deployment.

## Executive summary

ReturnSplit is a finance-control workbench for multi-vendor marketplaces using
Razorpay Route. It starts **after a return has been approved** and answers a
specific operational question: which seller transfer, and how much marketplace
funding, should produce the customer refund?

The product combines return evidence, the original order, the policy version
active on the order date, and Route transfer state. Untrusted extracted facts
are separated from deterministic integer-paise calculations. A named operator
approves a fingerprint of the exact plan; required transfer reversals complete
before the customer refund is created. Ambiguous evidence, unclear liability,
insufficient balance, and unknown provider outcomes stop or defer the workflow
instead of guessing.

The current repository is a polished prototype and engineering harness. It
demonstrates the finance-control logic with synthetic inputs and a local payment
simulator. It does not yet prove extraction quality, production economics, or a
live Razorpay integration.

## Ideal customer profile and buyer

### Initial ICP

An India-based marketplace, aggregator, or platform that:

- splits customer payments among multiple sellers through Razorpay Route;
- processes enough approved partial returns for manual transfer mapping to be a
  recurring finance-operations task;
- has seller-specific liability, commission, discount, or shipping rules;
- needs evidence tying each customer refund to the correct seller recovery;
- has finance and payments operators reviewing exceptions across separate
  commerce, policy, and payment systems.

The narrowest wedge is a marketplace where one order can contain products from
multiple sellers. A single-seller merchant with low refund volume or a business
looking primarily for return eligibility or fraud scoring is not the initial
ICP.

### Buying group

| Role | Interest in ReturnSplit |
| --- | --- |
| Economic buyer: Head of Finance, Controller, or CFO | Lower operating effort and financial leakage with a reviewable control trail |
| Operational owner: Payments or Finance Operations lead | Shorter queues, consistent policy application, explicit exception handling |
| Daily user: Refund or reconciliation operator | One place to inspect evidence, amounts, transfer state, and the next safe action |
| Technical approver: Payments engineering | Deterministic requests, idempotency, reconciliation, and narrow provider permissions |
| Risk/compliance reviewer | Human approval, frozen evidence and policy references, and auditable outcomes |

The buyer and ROI assumptions above remain hypotheses until validated with real
marketplace operators.

## The painful workflow

For an approved partial return, an operator may have to:

1. identify the returned order line from free-form evidence;
2. determine which seller owned that line;
3. retrieve the policy version that governed the order;
4. allocate order-level discounts and shipping without losing a paise;
5. separate the seller-funded amount from the marketplace contribution;
6. find the corresponding Route transfer and its remaining reversible balance;
7. reverse the correct transfer before refunding the customer;
8. determine whether a timeout failed or actually succeeded before retrying;
9. preserve enough evidence for later reconciliation and audit.

This is a risky junction rather than one isolated calculation. The source facts
can be ambiguous, while an incorrect transfer, duplicate request, or unsafe
retry can create a real monetary mismatch. Spreadsheets and ad hoc scripts can
support parts of the process, but ownership, control evidence, and recovery from
unknown provider outcomes still have to be designed.

## Product proposition

**Promise:** map every approved marketplace refund to the right seller
transfer, or make the exception explicit before money moves.

ReturnSplit currently demonstrates:

- evidence-linked item and policy proposals, represented by precomputed demo
  fixtures;
- deterministic validation and allocation in integer paise;
- explicit `execute`, `no_reversal`, `abstain`, and `blocked` dispositions;
- a SHA-256 plan fingerprint bound to human approval;
- reversal-before-refund execution with persisted operation intent;
- stable receipts, refund idempotency, and reconciliation before retrying an
  unknown transfer-reversal response;
- webhook signature, rotation, replay, and conflicting-event checks;
- aggregate refund-exposure planning using TimesFM 2.5 when configured, with a
  labeled deterministic fallback;
- an operational reserve snapshot combining new-demand forecasts with the
  priced open queue, executable seller reversals, blocked exposure, and
  unpriced claims without double counting;
- explicit evidence-request, reconciliation, and recovery cases with owners,
  due times, next actions, redacted notes, recovery/write-off accounting, and
  safe workflow boundaries;
- a 64-record synthetic control replay and an inspectable exception list.

The implementation evidence is documented in [Architecture](architecture.md),
[Evaluation protocol](evaluation.md), and [Threat model](threat-model.md).

## Razorpay AI Buildathon: Track 04 positioning

The official [Razorpay AI Buildathon](https://razorpay.com/buildathon/) describes
Track 04, **AI Finance Controller**, as “Run the books and the cash position.”
It asks for one finance-operations loop across a batch of more than 50 synthetic
records, with match rate and unresolved exceptions; its bar is throughput,
measured accuracy, and an honest exception list.

ReturnSplit belongs in Track 04 rather than the return-risk track because it
does not decide return eligibility or detect fraud. It closes a post-approval
finance-operations loop: map the returned line and frozen policy to the correct
seller transfer, calculate exact funding, approve the plan, execute in a safe
order, and preserve exceptions and provider outcomes.

| Track 04 requirement | Current evidence | Honest boundary |
| --- | --- | --- |
| Close one finance-ops loop | Approved return → funding plan → human approval → seller reversal → customer refund | The default provider is a local simulator, not Razorpay production |
| 50+ synthetic records | `pnpm eval:batch` evaluates 64 generated records | Inputs are pre-structured; this is not an extraction benchmark |
| Match or accuracy result | 64/64 expected finance-control decisions match the deterministic engine | This is fixture agreement, not generalization or model accuracy |
| Explicit exception list | 48 records close automatically; 16 surface as abstentions or balance blocks | The fixtures are generated and not representative production claims |
| False-positive cost | Current replay reports 0 unsafe automations and ₹0 wrong-seller overage | Those values apply only to the included synthetic dataset |
| Throughput | The 64-record run reports wall-clock records per second and p50/p95 in-process case latency | These engine-only timings exclude network, storage, model inference, and provider calls; they do not establish production capacity |
| Cash position | The Reserve page combines the open queue with aggregate new-refund demand and recommends headroom or a top-up | Forecast calibration and business impact have not been measured on real history |

The AI claim must remain narrow. TimesFM is a real optional forecasting model
for aggregate cash planning. Claim extraction in the showcased records is
precomputed, and every monetary decision is deterministic. ReturnSplit should
not be presented as an end-to-end autonomous AI agent until a real extraction
pipeline is evaluated on a sealed dataset.

## Quantified ROI model

Use the following model during customer discovery. Every input must come from
the prospective customer's own baseline; none of the values is established by
this repository.

| Symbol | Input |
| --- | --- |
| `N` | Approved marketplace return cases handled per month |
| `T_manual` | Current median operator minutes per case |
| `T_product` | Median operator minutes per case with ReturnSplit |
| `C` | Fully loaded operator cost per hour |
| `E` | Relevant mapping, duplicate, or reconciliation incidents per year |
| `L` | Average direct loss or recovery cost per incident |
| `R` | Fraction of those incidents prevented or recovered by ReturnSplit |
| `S` | Annual software subscription |
| `I` | One-time implementation cost |

```text
monthly hours saved = N × (T_manual − T_product) ÷ 60
annual labor value = monthly hours saved × C × 12
annual avoided-loss value = E × L × R
annual gross benefit = annual labor value + annual avoided-loss value
first-year net benefit = annual gross benefit − S − I
payback months = I ÷ ((annual gross benefit − S) ÷ 12)
```

### Illustrative scenario—not an observed result

Assume `N = 2,000`, `T_manual = 12 minutes`, `T_product = 4 minutes`,
`C = ₹600/hour`, `E = 24`, `L = ₹15,000`, and `R = 50%`.

- Monthly hours saved: `2,000 × 8 ÷ 60 = 266.7 hours`
- Annual labor value: `266.7 × ₹600 × 12 = ₹19.2 lakh`
- Annual avoided-loss value: `24 × ₹15,000 × 50% = ₹1.8 lakh`
- Annual gross benefit: `₹21 lakh`

If a future production subscription were ₹75,000 per month and implementation
were ₹3 lakh, this hypothetical customer would have ₹9 lakh first-year net
benefit and a three-month implementation payback after the subscription cost.
These numbers are arithmetic examples only. A pilot must measure each baseline,
the attributable change, and confidence intervals before using them in a sales
claim. Working-capital value from forecasting is deliberately excluded until it
can be measured without double counting.

## Pricing hypothesis

Pricing should be tested against the customer's measured operational value, not
presented as a current tariff.

- **Design-partner pilot:** ₹2–3 lakh fixed for six to eight weeks in shadow
  mode, including workflow mapping and an agreed evaluation report. No automated
  money movement.
- **Production hypothesis:** ₹75,000 per month for a base volume tier, with
  higher tiers based on approved-return volume, environments, retention, and
  control requirements rather than a percentage of refunds.
- **Enterprise expansion:** separately priced implementation, maker-checker
  controls, SSO/RBAC, durable audit export, service commitments, and additional
  commerce-system integrations. These are roadmap items, not features in the
  current prototype.

The pricing test is whether annual contract value remains a minority of verified
labor and loss-avoidance value while covering onboarding, support, model
inference, and payment-integration risk.

## Go-to-market hypothesis

1. **Recruit three design partners.** Use founder-led outreach to finance and
   payments leaders at multi-vendor marketplaces already using split-payment
   flows. Do not imply a Razorpay partnership or endorsement.
2. **Land in shadow mode.** Import approved returns, policies, orders, and
   transfer snapshots without permission to move money. Compare ReturnSplit's
   disposition and reversal vector with the operator's final decision.
3. **Prove the control case.** Measure review time, exact reversal-vector
   agreement, exception recall, wrong-seller paise, duplicate effects, and age
   of unresolved reconciliations.
4. **Add supervised execution.** After security and Test Mode acceptance, allow
   a named operator to approve bounded reversals and refunds.
5. **Expand from the refund wedge.** Add policy administration, reconciliation
   operations, durable audit export, and cash/reserve planning only after the
   first workflow has earned trust.

Potential distribution includes direct outreach, marketplace implementation
partners, and—only if separately accepted—Razorpay ecosystem channels. None is
an existing partnership in this repository.

## Alternatives and build-versus-buy

The comparison below describes solution categories, not audited claims about
every vendor in a category.

| Option | Line-to-transfer and policy context | Safe payment sequencing | Exception and unknown-outcome handling | Aggregate cash forecast | Merchant effort |
| --- | --- | --- | --- | --- | --- |
| Spreadsheet + payment dashboard | Manual joining and formulas | Operator procedure | Manual investigation | Separate sheet or finance model | Low setup, high recurring effort |
| Internal scripts and SQL | Can be tailored | Must be engineered and maintained | Must be engineered per provider | Can be built separately | High engineering ownership |
| Generic returns/RMA platform | Strong return workflow; payment-transfer depth varies | Integration-dependent | Integration-dependent | Usually outside the core workflow | Moderate integration and customization |
| ERP/accounting reconciliation | Strong ledger and close context; item-level return evidence varies | Connector-dependent | Often batch-oriented | Planning may exist elsewhere | Heavy configuration |
| ReturnSplit prototype | Explicit order-line, policy, seller, and transfer mapping | Reversal before refund with idempotency/reconciliation controls | Abstain, block, or reconcile rather than guess | TimesFM or labeled deterministic fallback | Focused workflow, but production platform work remains |

Build internally when the workflow is genuinely proprietary, volume is small,
and the marketplace can own provider edge cases indefinitely. A specialized
product becomes more attractive when the same control pattern spans many
sellers and policies, exception evidence matters, and payments engineers should
not maintain an operations UI as a side project.

## Pilot success criteria

Define thresholds before the pilot and report raw numerators, not just rates:

- exact reversal-vector agreement with blind human labels;
- wrong-seller overage in paise;
- unsafe automation count and mandatory-abstention recall;
- median and 90th-percentile review time;
- percentage of clear cases closed without rework;
- duplicate financial effects;
- age and resolution rate of unknown provider outcomes;
- forecast error and interval coverage by horizon, reported separately from
  claim-decision metrics.

The repository's proposed production gate is at least 100 representative,
de-identified, blind double-annotated claims, a sealed multilingual challenge
set, independent reruns, Razorpay Test Mode traces, and shadow-mode comparison
with human decisions. See [Evaluation protocol](evaluation.md).

## Truthful current limitations

- Claim facts and extraction outputs in the demo are pre-structured fixtures;
  there is no measured production extraction accuracy.
- The 64-record replay validates the deterministic finance-control layer on
  generated data, not an AI model on real claims.
- Demo provider, saga state, completion state, and webhook inbox are in memory
  and reset with the server process.
- The repository has no production authentication, tenant isolation, durable
  database, distributed locks, job queue, or production-grade audit store.
- A Razorpay Test Mode adapter can be selected by environment, but no
  credentials or matching Test Mode fixtures were supplied and no external
  reversal or webhook trace has been captured. Seeded demo IDs are barred from
  external requests. Live mode is intentionally unavailable.
- The bundled refund history is synthetic. TimesFM has a leakage-safe
  rolling-origin engineering backtest against two baselines, but it has not
  been backtested or calibrated on representative ReturnSplit production data.
- Forecasts cannot determine eligibility, liability, transfer selection, exact
  refund amounts, approval, or execution priority.
- Pricing, ROI, ICP, and go-to-market statements in this document are hypotheses
  awaiting customer evidence.

## Evidence links

- [Repository overview](../README.md)
- [Architecture and trust boundaries](architecture.md)
- [Evaluation protocol](evaluation.md)
- [Threat model](threat-model.md)
- [TimesFM service contract](../services/timesfm/README.md)
- [Razorpay AI Buildathon](https://razorpay.com/buildathon/)
- [Razorpay Route refund and transfer reversal documentation](https://razorpay.com/docs/api/payments/route/refund-payments-and-reverse-transfer/)
- [Google Research TimesFM](https://github.com/google-research/timesfm)
