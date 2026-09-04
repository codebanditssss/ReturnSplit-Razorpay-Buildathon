# ReturnSplit TimesFM sidecar

This optional service forecasts aggregate daily approved-refund outflow. It does
not decide whether a claim is eligible, identify fraud, assign seller liability,
calculate a reversal, or authorize money movement. ReturnSplit's deterministic
paise engine and human approval remain authoritative.

The service uses Google's TimesFM 2.5 200M PyTorch checkpoint through the
current `timesfm` package. The source and model weights up to version 2.5 are
Apache-2.0 according to the official repository. The open model is not an
officially supported Google product. Preserve applicable license notices and do
your own legal review.

## Run locally

From this directory:

```sh
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
TIMESFM_SERVICE_TOKEN=local-secret \
  uvicorn app.main:app --host 127.0.0.1 --port 8091 --workers 1
```

Then configure the Next.js server (never a `NEXT_PUBLIC_` variable):

```sh
TIMESFM_ENDPOINT=http://127.0.0.1:8091/v1/forecast
TIMESFM_API_TOKEN=local-secret
TIMESFM_TIMEOUT_MS=5000
```

Plain HTTP is accepted by the TypeScript adapter only for localhost. Remote
endpoints must use HTTPS. If the endpoint is missing, slow, down, or returns an
invalid payload, ReturnSplit displays its labeled deterministic weekday
fallback.

## Deployment facts

- Startup downloads the pinned 2.5 checkpoint revision from Hugging Face if it
  is not already cached. The weights are about 925 MB and are not stored here.
- Use a persistent Python container with sufficient memory (roughly 4 GB is a
  sensible prototype floor), not a short-lived Next.js/serverless function.
- Run one Uvicorn worker per model process. Additional workers duplicate model
  memory. Scale with separate replicas and a bounded upstream queue.
- Readiness is reported only after load, compile, and a warm-up forecast.
- Put authentication, rate limiting, TLS, and a request-body size limit at the
  private service boundary. The optional bearer token here is defense in depth,
  not a complete edge-security layer.
- `p10`–`p90` is a nominal 80% prediction band. Backtest and calibrate it on
  representative ReturnSplit history before calling it calibrated. The bundled
  Creo Market history is synthetic and every result from it remains labeled
  illustrative.

The checkpoint revision is pinned in `app/main.py`; package versions are pinned
in `requirements.txt`. Do not substitute TimesFM 3.0 pretrained weights without
reviewing their different non-commercial license.

## Contract

`POST /v1/forecast` accepts 14–512 consecutive daily observations and a horizon
of 7, 14, or 30 days:

```json
{
  "history": [
    { "date": "2026-08-21", "valuePaise": 1823400 },
    { "date": "2026-08-22", "valuePaise": 2012200 },
    { "date": "2026-08-23", "valuePaise": 2445100 },
    { "date": "2026-08-24", "valuePaise": 1718800 },
    { "date": "2026-08-25", "valuePaise": 1654200 },
    { "date": "2026-08-26", "valuePaise": 1793300 },
    { "date": "2026-08-27", "valuePaise": 1847600 },
    { "date": "2026-08-28", "valuePaise": 2099100 },
    { "date": "2026-08-29", "valuePaise": 2574400 },
    { "date": "2026-08-30", "valuePaise": 2387600 },
    { "date": "2026-08-31", "valuePaise": 1692500 },
    { "date": "2026-09-01", "valuePaise": 1768100 },
    { "date": "2026-09-02", "valuePaise": 1814200 },
    { "date": "2026-09-03", "valuePaise": 1936700 }
  ],
  "horizon": 14
}
```

Successful responses include integer-paise `p10Paise`, `p50Paise`, and
`p90Paise` for each future date. Invalid input is rejected, concurrent inference
returns `429`, and unavailable inference returns `503` so the Next.js adapter can
fall back safely.

Run contract tests without loading or downloading the model:

```sh
python -m unittest discover -s tests
```

From the repository root, run the rolling-origin evaluator against the live
sidecar with:

```sh
TIMESFM_ENDPOINT=http://127.0.0.1:8091/v1/forecast \
TIMESFM_API_TOKEN=local-secret \
pnpm --silent eval:forecast -- --require-timesfm
```

The default history is synthetic and cannot establish accuracy. Supply a
consecutive aggregate daily series with `--input`; the JSON artifact records
TimesFM/fallback source counts, 7/14/30-day MAE and WAPE, empirical interval
coverage, pinball loss, baseline deltas, and a dataset fingerprint.

Official references:

- <https://github.com/google-research/timesfm>
- <https://huggingface.co/google/timesfm-2.5-200m-pytorch>
