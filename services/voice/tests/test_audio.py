import io
import unittest
import wave

import numpy as np
from app.audio import float32_to_pcm16le, float32_to_wav, pcm16le_to_float32


class AudioTests(unittest.TestCase):
    def test_pcm_round_trip(self) -> None:
        source = np.array([-1.0, -0.5, 0.0, 0.5, 1.0], dtype=np.float32)
        decoded = pcm16le_to_float32(float32_to_pcm16le(source), 16_000)
        np.testing.assert_allclose(decoded, source, atol=1 / 32768)

    def test_resample(self) -> None:
        source = np.zeros(48_000, dtype=np.float32)
        decoded = pcm16le_to_float32(float32_to_pcm16le(source), 48_000)
        self.assertEqual(decoded.shape, (16_000,))

    def test_wav_header(self) -> None:
        payload = float32_to_wav(np.zeros(24_000, dtype=np.float32), 24_000)
        with wave.open(io.BytesIO(payload), "rb") as wav:
            self.assertEqual(wav.getnchannels(), 1)
            self.assertEqual(wav.getframerate(), 24_000)
            self.assertEqual(wav.getnframes(), 24_000)


if __name__ == "__main__":
    unittest.main()
