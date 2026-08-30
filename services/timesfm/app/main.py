from __future__ import annotations

import hmac
import logging
import os
import threading
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any, Literal

import numpy as np
from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, model_validator

LOGGER = logging.getLogger("returnsplit.timesfm")

MODEL_ID = "google/timesfm-2.5-200m-pytorch"
MODEL_REVISION = "1d952420fba87f3c6dee4f240de0f1a0fbc790e3"
MAX_CONTEXT = 512
MAX_HORIZON = 128
MAX_VALUE_PAISE = 9_007_199_254_740_991


class HistoryPoint(BaseModel):
    date: date
    valuePaise: int = Field(gt=0, le=MAX_VALUE_PAISE)


class ForecastRequest(BaseModel):
    history: list[HistoryPoint] = Field(min_length=14, max_length=MAX_CONTEXT)
    horizon: Literal[7, 14, 30]

    @model_validator(mode="after")
    def require_regular_daily_history(self) -> ForecastRequest:
        for previous, current in zip(self.history, self.history[1:]):
            if current.date - previous.date != timedelta(days=1):
                raise ValueError(
                    "history dates must be unique, ascending, and exactly daily"
                )
        return self


class ForecastPoint(BaseModel):
    date: date
    p10Paise: int = Field(ge=0, le=MAX_VALUE_PAISE)
    p50Paise: int = Field(ge=0, le=MAX_VALUE_PAISE)
    p90Paise: int = Field(ge=0, le=MAX_VALUE_PAISE)


class ForecastResponse(BaseModel):
    modelId: Literal["google/timesfm-2.5-200m-pytorch"]
    generatedAt: datetime
    forecast: list[ForecastPoint]


def _load_and_compile_model() -> Any:
    # Importing inside startup keeps schema/unit-test imports lightweight. The
    # checkpoint is fetched by Hugging Face only when this service is started.
    import timesfm
    import torch

    torch.set_float32_matmul_precision("high")
    model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
        torch_compile=False,
    )
    model.compile(
        timesfm.ForecastConfig(
            max_context=MAX_CONTEXT,
            max_horizon=MAX_HORIZON,
            normalize_inputs=True,
            per_core_batch_size=1,
            use_continuous_quantile_head=True,
            force_flip_invariance=True,
            infer_is_positive=True,
            fix_quantile_crossing=True,
            return_backcast=False,
        )
    )

    # Warm the same zero-shot forecast path before the readiness flag is set.
    warmup = [np.linspace(100_000, 120_000, 32, dtype=np.float32)]
    model.forecast(horizon=7, inputs=warmup)
    return model


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.ready = False
    app.state.inference_lock = threading.Lock()
    app.state.model = await run_in_threadpool(_load_and_compile_model)
    app.state.ready = True
    try:
        yield
    finally:
        app.state.ready = False
        app.state.model = None


app = FastAPI(
    title="ReturnSplit TimesFM forecasting service",
    version="0.1.0",
    lifespan=lifespan,
)


def _authorize(authorization: Annotated[str | None, Header()] = None) -> None:
    expected_token = os.getenv("TIMESFM_SERVICE_TOKEN", "").strip()
    if not expected_token:
        return

    expected_header = f"Bearer {expected_token}"
    if authorization is None or not hmac.compare_digest(
        authorization, expected_header
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )


def _rounded_non_negative_paise(value: float) -> int:
    if not np.isfinite(value):
        raise ValueError("TimesFM returned a non-finite forecast")
    rounded = max(0, int(np.rint(value)))
    if rounded > MAX_VALUE_PAISE:
        raise ValueError("TimesFM forecast exceeds safe integer paise")
    return rounded


def _to_forecast_points(
    quantile_forecast: np.ndarray,
    last_history_date: date,
    horizon: int,
) -> list[ForecastPoint]:
    quantiles = np.asarray(quantile_forecast)
    if quantiles.shape != (1, horizon, 10):
        raise ValueError(
            f"Unexpected TimesFM quantile shape: {quantiles.shape!r}"
        )

    points: list[ForecastPoint] = []
    for index in range(horizon):
        # TimesFM 2.5 channel 0 is mean; channels 1..9 are q10..q90.
        p10 = _rounded_non_negative_paise(float(quantiles[0, index, 1]))
        p50 = max(
            p10,
            _rounded_non_negative_paise(float(quantiles[0, index, 5])),
        )
        p90 = max(
            p50,
            _rounded_non_negative_paise(float(quantiles[0, index, 9])),
        )
        points.append(
            ForecastPoint(
                date=last_history_date + timedelta(days=index + 1),
                p10Paise=p10,
                p50Paise=p50,
                p90Paise=p90,
            )
        )
    return points


@app.get("/healthz")
def health(request: Request) -> dict[str, object]:
    ready = bool(getattr(request.app.state, "ready", False))
    if not ready:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TimesFM is not ready",
        )
    return {
        "status": "ready",
        "modelId": MODEL_ID,
        "modelRevision": MODEL_REVISION,
    }


@app.post("/forecast", response_model=ForecastResponse, include_in_schema=False)
@app.post("/v1/forecast", response_model=ForecastResponse)
def forecast(
    payload: ForecastRequest,
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> ForecastResponse:
    _authorize(authorization)
    if not bool(getattr(request.app.state, "ready", False)):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TimesFM is not ready",
        )

    inference_lock: threading.Lock = request.app.state.inference_lock
    if not inference_lock.acquire(blocking=False):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="TimesFM is busy; retry later",
        )

    try:
        # TimesFM's forecast method may mutate its input list, so each call gets
        # a new list and array. Dates are intentionally omitted: 2.5 consumes a
        # regularly sampled univariate array and has no frequency argument.
        values = np.asarray(
            [point.valuePaise for point in payload.history],
            dtype=np.float32,
        )
        inputs = [values]
        _, quantile_forecast = request.app.state.model.forecast(
            horizon=payload.horizon,
            inputs=inputs,
        )
        points = _to_forecast_points(
            quantile_forecast,
            payload.history[-1].date,
            payload.horizon,
        )
        return ForecastResponse(
            modelId=MODEL_ID,
            generatedAt=datetime.now(timezone.utc),
            forecast=points,
        )
    except HTTPException:
        raise
    except Exception as error:
        LOGGER.exception("TimesFM inference failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TimesFM inference unavailable",
        ) from error
    finally:
        inference_lock.release()
