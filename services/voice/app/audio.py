from __future__ import annotations

import io
import wave

import numpy as np
from numpy.typing import NDArray

try:
    import soxr
except ImportError:  # pragma: no cover - production installs the optimized resampler
    soxr = None

TARGET_STT_SAMPLE_RATE = 16_000
TTS_SAMPLE_RATE = 24_000


class AudioInputError(ValueError):
    """Raised when a raw PCM payload is malformed."""


def pcm16le_to_float32(
    payload: bytes,
    sample_rate: int,
    target_rate: int = TARGET_STT_SAMPLE_RATE,
) -> NDArray[np.float32]:
    """Decode mono signed 16-bit little-endian PCM and resample when needed."""
    if sample_rate < 8_000 or sample_rate > 96_000:
        raise AudioInputError("sample_rate must be between 8000 and 96000")
    if len(payload) % 2:
        raise AudioInputError("pcm_s16le payload must contain complete 16-bit samples")

    pcm = np.frombuffer(payload, dtype="<i2")
    if pcm.size == 0:
        return np.empty(0, dtype=np.float32)

    audio = pcm.astype(np.float32) / 32768.0
    if sample_rate == target_rate:
        return audio

    if soxr is not None:
        return np.asarray(
            soxr.resample(audio, sample_rate, target_rate, quality="HQ"),
            dtype=np.float32,
        )

    output_size = max(1, round(audio.size * target_rate / sample_rate))
    source_positions = np.arange(audio.size, dtype=np.float64)
    target_positions = (
        np.arange(output_size, dtype=np.float64) * sample_rate / target_rate
    )
    return np.interp(target_positions, source_positions, audio).astype(np.float32)


def float32_to_pcm16le(samples: NDArray[np.floating]) -> bytes:
    clipped = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


def float32_to_wav(samples: NDArray[np.floating], sample_rate: int) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(float32_to_pcm16le(samples))
    return output.getvalue()
