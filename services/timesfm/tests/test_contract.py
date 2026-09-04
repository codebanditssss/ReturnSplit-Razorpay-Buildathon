import threading
import unittest
from datetime import date, timedelta

import numpy as np
from app.main import ForecastRequest, _to_forecast_points, app, forecast
from pydantic import ValidationError
from starlette.requests import Request


def history(length: int = 14) -> list[dict[str, object]]:
    start = date(2026, 8, 1)
    return [
        {
            "date": (start + timedelta(days=index)).isoformat(),
            "valuePaise": 100_000 + index,
        }
        for index in range(length)
    ]


class ForecastContractTests(unittest.TestCase):
    def test_accepts_supported_horizon_and_positive_daily_history(self) -> None:
        payload = ForecastRequest(history=history(), horizon=14)
        self.assertEqual(payload.horizon, 14)

    def test_rejects_irregular_history(self) -> None:
        values = history()
        values[7]["date"] = "2026-08-12"
        with self.assertRaises(ValidationError):
            ForecastRequest(history=values, horizon=14)

    def test_rejects_non_positive_paise(self) -> None:
        values = history()
        values[0]["valuePaise"] = 0
        with self.assertRaises(ValidationError):
            ForecastRequest(history=values, horizon=7)

    def test_maps_q10_q50_q90_to_integer_paise(self) -> None:
        quantiles = np.zeros((1, 7, 10), dtype=np.float32)
        quantiles[:, :, 1] = 100.4
        quantiles[:, :, 5] = 200.6
        quantiles[:, :, 9] = 300.2

        points = _to_forecast_points(quantiles, date(2026, 9, 3), 7)
        self.assertEqual(points[0].date, date(2026, 9, 4))
        self.assertEqual(points[0].p10Paise, 100)
        self.assertEqual(points[0].p50Paise, 201)
        self.assertEqual(points[0].p90Paise, 300)

    def test_endpoint_contract_uses_integer_paise_without_real_model(self) -> None:
        quantiles = np.zeros((1, 7, 10), dtype=np.float32)
        quantiles[:, :, 1] = 100.4
        quantiles[:, :, 5] = 200.6
        quantiles[:, :, 9] = 300.2

        class FakeModel:
            def forecast(self, *, horizon: int, inputs: list[np.ndarray]):
                self.horizon = horizon
                self.inputs = inputs
                return np.zeros((1, horizon)), quantiles

        fake_model = FakeModel()
        app.state.ready = True
        app.state.inference_lock = threading.Lock()
        app.state.model = fake_model
        request = Request({"type": "http", "app": app, "headers": []})
        payload = ForecastRequest(history=history(), horizon=7)

        response = forecast(payload, request, None)

        self.assertEqual(response.modelId, "google/timesfm-2.5-200m-pytorch")
        self.assertEqual(len(response.forecast), 7)
        self.assertEqual(response.forecast[0].p50Paise, 201)
        self.assertEqual(fake_model.horizon, 7)


if __name__ == "__main__":
    unittest.main()
