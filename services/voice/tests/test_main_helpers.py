import unittest

import numpy as np
from app.main import (
    LiveTranscriptState,
    SpeechRequest,
    SttSocketConfig,
    _prepare_tts_samples,
    _split_tts_text,
)


class MainHelperTests(unittest.TestCase):
    def test_realtime_is_the_socket_default(self) -> None:
        config = SttSocketConfig()
        self.assertEqual(config.quality, "realtime")
        self.assertEqual(config.partial_interval_ms, 500)
        self.assertFalse(config.word_timestamps)

    def test_live_hypotheses_commit_only_after_agreement(self) -> None:
        state = LiveTranscriptState()

        first = [
            {
                "words": [
                    {"start": 0.0, "end": 0.5, "word": " Hello"},
                    {"start": 0.5, "end": 1.0, "word": " world"},
                    {"start": 1.0, "end": 1.4, "word": " from"},
                    {"start": 1.4, "end": 1.8, "word": " Voice"},
                ]
            }
        ]
        text, committed, pending = state.update(first, 0.0, 4.0)
        self.assertEqual(text, "Hello world from Voice")
        self.assertEqual(committed, "")
        self.assertEqual(pending, "Hello world from Voice")

        second = [
            {
                "words": [
                    {"start": 0.02, "end": 0.52, "word": " Hello"},
                    {"start": 0.52, "end": 1.02, "word": " world"},
                    {"start": 1.02, "end": 1.42, "word": " from"},
                    {"start": 1.42, "end": 1.82, "word": " Voice"},
                    {"start": 1.82, "end": 2.2, "word": " Lab"},
                ]
            }
        ]
        text, committed, pending = state.update(second, 0.0, 5.0)
        self.assertEqual(text, "Hello world from Voice Lab")
        self.assertEqual(committed, "Hello world")
        self.assertEqual(pending, "from Voice Lab")

    def test_live_preview_window_is_bounded(self) -> None:
        state = LiveTranscriptState()
        self.assertEqual(state.window_start(5.0), 0.0)
        self.assertEqual(state.window_start(20.0), 12.0)

    def test_openai_style_tts_input(self) -> None:
        request = SpeechRequest(input="  Hello world.  ")
        self.assertEqual(request.input, "Hello world.")

    def test_tts_chunks_stay_bounded(self) -> None:
        text = " ".join(["A realistic sentence with useful punctuation."] * 30)
        chunks = _split_tts_text(text)
        self.assertGreater(len(chunks), 1)
        self.assertLessEqual(len(chunks[0]), 64)
        self.assertTrue(all(len(chunk) <= 200 for chunk in chunks[1:]))
        self.assertEqual(" ".join(chunks), text)

    def test_tts_short_first_chunk_uses_natural_boundary(self) -> None:
        text = (
            "Hello from Voice Lab. This opening audio should arrive quickly while "
            "the rest of this longer passage continues rendering in the background."
        )
        chunks = _split_tts_text(text)
        self.assertEqual(chunks[0], "Hello from Voice Lab.")
        self.assertEqual(" ".join(chunks), text)

    def test_tts_audio_cleanup_removes_invalid_values_and_clicks(self) -> None:
        samples = np.array(
            [np.nan, np.inf, -np.inf, 0.4, -0.2, 0.3] * 100, dtype=np.float32
        )
        cleaned = _prepare_tts_samples(samples, 24_000)
        self.assertTrue(np.isfinite(cleaned).all())
        self.assertAlmostEqual(float(cleaned[0]), 0.0, places=6)
        self.assertAlmostEqual(float(cleaned[-1]), 0.0, places=6)
        self.assertLessEqual(float(np.max(np.abs(cleaned))), 1.0)


if __name__ == "__main__":
    unittest.main()
