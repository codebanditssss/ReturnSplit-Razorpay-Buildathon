from __future__ import annotations

import asyncio
import contextlib
import io
import json
import logging
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Any, Literal

import numpy as np
from fastapi import (
    FastAPI,
    File,
    Form,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field, ValidationError, model_validator

from app.audio import (
    AudioInputError,
    float32_to_pcm16le,
    float32_to_wav,
    pcm16le_to_float32,
)

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("voice-lab")

SERVICE_NAME = "Voice Lab"
SERVICE_VERSION = "1.3.4"
ROOT = Path(__file__).resolve().parent.parent
STATIC_ROOT = Path(__file__).resolve().parent / "static"

STT_QUALITY_MODEL_PATH = os.getenv("STT_MODEL_PATH", "large-v3-turbo")
STT_QUALITY_MODEL_LABEL = os.getenv("STT_MODEL_LABEL", "faster-whisper-large-v3-turbo")
STT_REALTIME_MODEL_PATH = os.getenv(
    "STT_REALTIME_MODEL_PATH", str(ROOT / "models" / "whisper-small")
)
STT_REALTIME_MODEL_LABEL = os.getenv("STT_REALTIME_MODEL_LABEL", "faster-whisper-small")
STT_REALTIME_EN_MODEL_PATH = os.getenv(
    "STT_REALTIME_EN_MODEL_PATH", str(ROOT / "models" / "whisper-small-en")
)
STT_REALTIME_EN_MODEL_LABEL = "faster-whisper-small.en"
STT_PREVIEW_EN_MODEL_PATH = os.getenv(
    "STT_PREVIEW_EN_MODEL_PATH", str(ROOT / "models" / "whisper-base-en")
)
STT_PREVIEW_EN_MODEL_LABEL = "faster-whisper-base.en"
STT_COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "int8")
STT_CPU_THREADS = int(os.getenv("STT_CPU_THREADS", "8"))
STT_WORKERS = int(os.getenv("STT_WORKERS", "1"))
STT_REALTIME_CPU_THREADS = int(os.getenv("STT_REALTIME_CPU_THREADS", "4"))
STT_REALTIME_WORKERS = int(os.getenv("STT_REALTIME_WORKERS", "2"))
TTS_MODEL_PATH = os.getenv("TTS_MODEL_PATH", str(ROOT / "models" / "kokoro-v1.0.onnx"))
TTS_VOICES_PATH = os.getenv("TTS_VOICES_PATH", str(ROOT / "models" / "voices-v1.0.bin"))
TTS_CPU_THREADS = int(os.getenv("TTS_CPU_THREADS", "4"))
TTS_WORKERS = int(os.getenv("TTS_WORKERS", "1"))

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(100 * 1024 * 1024)))
MAX_STREAM_SECONDS = int(os.getenv("MAX_STREAM_SECONDS", "600"))
MAX_TTS_CHARACTERS = int(os.getenv("MAX_TTS_CHARACTERS", "5000"))
PARTIAL_WINDOW_SECONDS = int(os.getenv("PARTIAL_WINDOW_SECONDS", "8"))
LIVE_COMMIT_LAG_WORDS = int(os.getenv("LIVE_COMMIT_LAG_WORDS", "2"))
LIVE_COMMIT_DELAY_SECONDS = float(os.getenv("LIVE_COMMIT_DELAY_SECONDS", "3.0"))
TTS_CHUNK_CHARACTERS = int(os.getenv("TTS_CHUNK_CHARACTERS", "260"))

VOICE_LANGUAGES = {
    "a": ("en-us", "English (US)"),
    "b": ("en-gb", "English (UK)"),
    "e": ("es", "Spanish"),
    "f": ("fr-fr", "French"),
    "h": ("hi", "Hindi"),
    "i": ("it", "Italian"),
    "j": ("ja", "Japanese"),
    "p": ("pt-br", "Portuguese (Brazil)"),
    "z": ("cmn", "Mandarin Chinese"),
}
RECOMMENDED_VOICES = {"af_heart", "af_bella", "bf_emma", "ff_siwis"}


class ModelStore:
    def __init__(self) -> None:
        self.stt_quality: Any | None = None
        self.stt_realtime: Any | None = None
        self.stt_realtime_en: Any | None = None
        self.stt_preview_en: Any | None = None
        self.tts: Any | None = None
        self.g2p_us: Any | None = None
        self.g2p_gb: Any | None = None
        self.ready = False
        self.loaded_at: float | None = None
        self.started_at = time.time()
        self.stt_quality_slots = asyncio.Semaphore(max(1, STT_WORKERS))
        self.stt_realtime_slots = asyncio.Semaphore(max(1, STT_REALTIME_WORKERS))
        self.stt_preview_slots = asyncio.Semaphore(2)
        self.tts_slots = asyncio.Semaphore(max(1, TTS_WORKERS))

    def load(self) -> None:
        import onnxruntime as ort
        from faster_whisper import WhisperModel
        from kokoro_onnx import Kokoro

        logger.info("Loading quality STT model from %s", STT_QUALITY_MODEL_PATH)
        self.stt_quality = WhisperModel(
            STT_QUALITY_MODEL_PATH,
            device="cpu",
            compute_type=STT_COMPUTE_TYPE,
            cpu_threads=STT_CPU_THREADS,
            num_workers=STT_WORKERS,
            download_root=os.getenv("HF_HOME"),
            local_files_only=os.getenv("HF_HUB_OFFLINE") == "1",
        )
        logger.info("Loading realtime STT model from %s", STT_REALTIME_MODEL_PATH)
        self.stt_realtime = WhisperModel(
            STT_REALTIME_MODEL_PATH,
            device="cpu",
            compute_type=STT_COMPUTE_TYPE,
            cpu_threads=STT_REALTIME_CPU_THREADS,
            num_workers=STT_REALTIME_WORKERS,
            download_root=os.getenv("HF_HOME"),
            local_files_only=os.getenv("HF_HUB_OFFLINE") == "1",
        )
        logger.info(
            "Loading English realtime STT model from %s", STT_REALTIME_EN_MODEL_PATH
        )
        self.stt_realtime_en = WhisperModel(
            STT_REALTIME_EN_MODEL_PATH,
            device="cpu",
            compute_type=STT_COMPUTE_TYPE,
            cpu_threads=STT_REALTIME_CPU_THREADS,
            num_workers=STT_REALTIME_WORKERS,
            download_root=os.getenv("HF_HOME"),
            local_files_only=os.getenv("HF_HUB_OFFLINE") == "1",
        )
        logger.info(
            "Loading English preview STT model from %s", STT_PREVIEW_EN_MODEL_PATH
        )
        self.stt_preview_en = WhisperModel(
            STT_PREVIEW_EN_MODEL_PATH,
            device="cpu",
            compute_type=STT_COMPUTE_TYPE,
            cpu_threads=4,
            num_workers=2,
            download_root=os.getenv("HF_HOME"),
            local_files_only=os.getenv("HF_HUB_OFFLINE") == "1",
        )

        logger.info("Loading TTS model from %s", TTS_MODEL_PATH)
        session_options = ort.SessionOptions()
        session_options.intra_op_num_threads = TTS_CPU_THREADS
        session_options.inter_op_num_threads = 1
        session_options.graph_optimization_level = (
            ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        )
        session = ort.InferenceSession(
            TTS_MODEL_PATH,
            sess_options=session_options,
            providers=["CPUExecutionProvider"],
        )
        self.tts = Kokoro.from_session(session, TTS_VOICES_PATH)
        try:
            from misaki import en, espeak

            self.g2p_us = en.G2P(
                trf=False,
                british=False,
                fallback=espeak.EspeakFallback(british=False),
            )
            self.g2p_gb = en.G2P(
                trf=False,
                british=True,
                fallback=espeak.EspeakFallback(british=True),
            )
        except Exception:
            logger.exception("Misaki unavailable; falling back to eSpeak phonemization")

        # Exercise both inference paths during startup, so the first user does not
        # discover a bad model file or pay all of the one-time initialization cost.
        list(
            self.stt_realtime.transcribe(
                np.zeros(16_000, dtype=np.float32),
                language="en",
                beam_size=1,
                best_of=1,
                temperature=0.0,
                vad_filter=False,
            )[0]
        )
        list(
            self.stt_quality.transcribe(
                np.zeros(16_000, dtype=np.float32),
                language="en",
                beam_size=1,
                best_of=1,
                temperature=0.0,
                vad_filter=False,
            )[0]
        )
        list(
            self.stt_realtime_en.transcribe(
                np.zeros(16_000, dtype=np.float32),
                language="en",
                beam_size=1,
                best_of=1,
                temperature=0.0,
                vad_filter=False,
            )[0]
        )
        list(
            self.stt_preview_en.transcribe(
                np.zeros(16_000, dtype=np.float32),
                language="en",
                beam_size=1,
                best_of=1,
                temperature=0.0,
                without_timestamps=True,
                vad_filter=False,
            )[0]
        )
        if self.g2p_us is not None:
            phonemes, _ = self.g2p_us("Voice Lab is ready.")
            self.tts.create(phonemes, voice="af_heart", lang="en-us", is_phonemes=True)
        else:
            self.tts.create("Voice Lab is ready.", voice="af_heart", lang="en-us")
        self.loaded_at = time.time()
        self.ready = True
        logger.info("Voice models loaded and warmed")


models = ModelStore()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.to_thread(models.load)
    yield


app = FastAPI(
    title=SERVICE_NAME,
    version=SERVICE_VERSION,
    description=(
        "Private, CPU-optimized speech-to-text and text-to-speech service. "
        "Includes OpenAI-style REST routes and low-latency WebSocket routes."
    ),
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip() for origin in os.getenv("CORS_ORIGINS", "*").split(",")
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    allow_credentials=False,
)


class SpeechRequest(BaseModel):
    input: str | None = None
    text: str | None = None
    model: str | None = None
    voice: str = "af_heart"
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    language: str | None = None
    response_format: Literal["wav", "pcm"] = "wav"

    @model_validator(mode="after")
    def validate_text(self) -> SpeechRequest:
        value = self.input if self.input is not None else self.text
        if value is None or not value.strip():
            raise ValueError("input or text is required")
        if len(value) > MAX_TTS_CHARACTERS:
            raise ValueError(f"text must not exceed {MAX_TTS_CHARACTERS} characters")
        self.input = value.strip()
        return self


class SttSocketConfig(BaseModel):
    type: Literal["start"] = "start"
    encoding: Literal["pcm_s16le"] = "pcm_s16le"
    sample_rate: int = Field(default=16_000, ge=8_000, le=96_000)
    language: str | None = None
    task: Literal["transcribe", "translate"] = "transcribe"
    quality: Literal["realtime", "accurate"] = "realtime"
    partial_interval_ms: int = Field(default=500, ge=500, le=10_000)
    word_timestamps: bool = False
    initial_prompt: str | None = Field(default=None, max_length=500)


def _language_for_voice(voice: str, requested: str | None) -> str:
    if requested:
        return requested
    return VOICE_LANGUAGES.get(voice[:1], ("en-us", "English (US)"))[0]


def _voice_payload(name: str) -> dict[str, Any]:
    locale, language = VOICE_LANGUAGES.get(name[:1], ("en-us", "English (US)"))
    gender = "female" if len(name) > 1 and name[1] == "f" else "male"
    display_name = name.split("_", 1)[-1].replace("_", " ").title()
    return {
        "id": name,
        "name": display_name,
        "gender": gender,
        "locale": locale,
        "language": language,
        "recommended": name in RECOMMENDED_VOICES,
    }


async def _read_upload_limited(upload: UploadFile) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while chunk := await upload.read(1024 * 1024):
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413, detail="audio file exceeds the 100 MB limit"
            )
        chunks.append(chunk)
    payload = b"".join(chunks)
    if not payload:
        raise HTTPException(status_code=422, detail="audio file is empty")
    return payload


def _transcribe_sync(
    audio: io.BytesIO | np.ndarray,
    *,
    quality: Literal["realtime", "accurate"],
    preview: bool,
    language: str | None,
    task: str,
    beam_size: int,
    word_timestamps: bool,
    vad_filter: bool,
    initial_prompt: str | None,
) -> dict[str, Any]:
    is_english = bool(language and language.lower().split("-", 1)[0] == "en")
    if quality == "accurate":
        model = models.stt_quality
        model_label = STT_QUALITY_MODEL_LABEL
    elif preview and is_english:
        model = models.stt_preview_en
        model_label = STT_PREVIEW_EN_MODEL_LABEL
    elif is_english:
        model = models.stt_realtime_en
        model_label = STT_REALTIME_EN_MODEL_LABEL
    else:
        model = models.stt_realtime
        model_label = STT_REALTIME_MODEL_LABEL
    if model is None:
        raise RuntimeError(f"{quality} STT model is not loaded")

    started = time.perf_counter()
    segment_stream, info = model.transcribe(
        audio,
        language=language,
        task=task,
        beam_size=beam_size,
        best_of=1 if beam_size == 1 else 5,
        temperature=0.0 if beam_size == 1 else [0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
        condition_on_previous_text=quality == "accurate" and beam_size > 1,
        without_timestamps=preview and not word_timestamps,
        word_timestamps=word_timestamps,
        vad_filter=vad_filter,
        vad_parameters={
            "min_silence_duration_ms": 500,
            "speech_pad_ms": 200,
        },
        initial_prompt=initial_prompt,
    )

    rendered_segments = []
    text_parts = []
    for segment in segment_stream:
        text_parts.append(segment.text)
        words = None
        if word_timestamps and segment.words:
            words = [
                {
                    "start": round(word.start, 3),
                    "end": round(word.end, 3),
                    "word": word.word,
                    "probability": round(word.probability, 5),
                }
                for word in segment.words
            ]
        rendered_segments.append(
            {
                "id": segment.id,
                "start": round(segment.start, 3),
                "end": round(segment.end, 3),
                "text": segment.text.strip(),
                "avgLogProbability": round(segment.avg_logprob, 5),
                "noSpeechProbability": round(segment.no_speech_prob, 5),
                "words": words,
            }
        )

    processing_seconds = time.perf_counter() - started
    duration = float(getattr(info, "duration", 0.0) or 0.0)
    return {
        "id": f"stt_{uuid.uuid4().hex[:16]}",
        "text": "".join(text_parts).strip(),
        "language": info.language,
        "languageProbability": round(float(info.language_probability), 5),
        "durationSeconds": round(duration, 3),
        "durationAfterVadSeconds": round(float(info.duration_after_vad), 3),
        "processingMs": round(processing_seconds * 1000),
        "realtimeFactor": round(processing_seconds / duration, 4) if duration else None,
        "model": model_label,
        "quality": quality,
        "segments": rendered_segments,
    }


async def _transcribe(
    audio: io.BytesIO | np.ndarray,
    *,
    quality: Literal["realtime", "accurate"],
    preview: bool = False,
    language: str | None,
    task: str,
    beam_size: int,
    word_timestamps: bool,
    vad_filter: bool,
    initial_prompt: str | None,
) -> dict[str, Any]:
    if quality == "accurate":
        slots = models.stt_quality_slots
    elif preview:
        slots = models.stt_preview_slots
    else:
        slots = models.stt_realtime_slots
    async with slots:
        return await asyncio.to_thread(
            _transcribe_sync,
            audio,
            quality=quality,
            preview=preview,
            language=language,
            task=task,
            beam_size=beam_size,
            word_timestamps=word_timestamps,
            vad_filter=vad_filter,
            initial_prompt=initial_prompt,
        )


def _split_tts_text(text: str) -> list[str]:
    """Keep Kokoro near its best prosody range and reduce WS time-to-first-audio."""
    sentences = [piece.strip() for piece in re.split(r"(?<=[.!?;:])\s+|\n+", text)]
    sentences = [piece for piece in sentences if piece]
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        words = sentence.split()
        pieces: list[str] = []
        while words:
            piece_words: list[str] = []
            size = 0
            while words and (
                not piece_words or size + len(words[0]) + 1 <= TTS_CHUNK_CHARACTERS
            ):
                word = words.pop(0)
                piece_words.append(word)
                size += len(word) + 1
            pieces.append(" ".join(piece_words))
        for piece in pieces:
            candidate = f"{current} {piece}".strip()
            if current and len(candidate) > TTS_CHUNK_CHARACTERS:
                chunks.append(current)
                current = piece
            else:
                current = candidate
    if current:
        chunks.append(current)
    return chunks or [text]


def _synthesize_chunk_sync(
    text: str, *, voice: str, speed: float, language: str
) -> tuple[np.ndarray, int]:
    if models.tts is None:
        raise RuntimeError("TTS model is not loaded")
    g2p = models.g2p_gb if language == "en-gb" else models.g2p_us
    if language in {"en-us", "en-gb"} and g2p is not None:
        phonemes, _ = g2p(text)
        return models.tts.create(
            phonemes,
            voice=voice,
            speed=speed,
            lang=language,
            is_phonemes=True,
            trim=True,
        )
    return models.tts.create(
        text,
        voice=voice,
        speed=speed,
        lang=language,
        trim=True,
    )


def _synthesize_sync(request: SpeechRequest) -> tuple[np.ndarray, int, str]:
    if models.tts is None:
        raise RuntimeError("TTS model is not loaded")
    if request.voice not in models.tts.get_voices():
        raise ValueError(f"unknown voice: {request.voice}")
    if request.input is None:
        raise ValueError("input is required")
    language = _language_for_voice(request.voice, request.language)
    chunks = _split_tts_text(request.input)
    audio_parts: list[np.ndarray] = []
    sample_rate = 24_000
    for index, chunk in enumerate(chunks):
        samples, sample_rate = _synthesize_chunk_sync(
            chunk, voice=request.voice, speed=request.speed, language=language
        )
        audio_parts.append(samples)
        if index < len(chunks) - 1:
            audio_parts.append(np.zeros(round(sample_rate * 0.08), dtype=np.float32))
    return np.concatenate(audio_parts), sample_rate, language


@app.get("/", include_in_schema=False)
async def playground() -> FileResponse:
    return FileResponse(
        STATIC_ROOT / "index.html",
        media_type="text/html",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/healthz", tags=["system"])
async def health() -> dict[str, Any]:
    return {
        "status": "ok" if models.ready else "loading",
        "ready": models.ready,
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
        "uptimeSeconds": round(time.time() - models.started_at),
        "models": {
            "sttPreviewEnglish": STT_PREVIEW_EN_MODEL_LABEL,
            "sttRealtimeEnglish": STT_REALTIME_EN_MODEL_LABEL,
            "sttRealtimeMultilingual": STT_REALTIME_MODEL_LABEL,
            "sttAccurate": STT_QUALITY_MODEL_LABEL,
            "sttCompute": f"cpu/{STT_COMPUTE_TYPE}",
            "tts": "Kokoro-82M-v1.0/full-precision",
            "ttsFrontend": (
                "misaki-en/espeak-multilingual"
                if models.g2p_us is not None
                else "espeak"
            ),
        },
        "capacity": {
            "sttLivePreviews": 2,
            "sttRealtimeFinals": max(1, STT_REALTIME_WORKERS),
            "sttStudioJobs": max(1, STT_WORKERS),
            "ttsGenerations": max(1, TTS_WORKERS),
        },
    }


@app.get("/v1/voices", tags=["tts"])
async def voices() -> dict[str, Any]:
    if models.tts is None:
        raise HTTPException(status_code=503, detail="TTS model is still loading")
    items = [_voice_payload(name) for name in models.tts.get_voices()]
    items.sort(
        key=lambda item: (not item["recommended"], item["language"], item["name"])
    )
    return {"object": "list", "data": items, "default": "af_heart"}


@app.post("/v1/stt", tags=["stt"])
@app.post("/v1/audio/transcriptions", tags=["stt"])
async def speech_to_text(
    file: Annotated[
        UploadFile, File(description="Audio in WAV, MP3, M4A, FLAC, OGG, or WebM")
    ],
    language: Annotated[str | None, Form()] = None,
    task: Annotated[Literal["transcribe", "translate"], Form()] = "transcribe",
    quality: Annotated[Literal["fast", "realtime", "accurate"], Form()] = "realtime",
    response_format: Annotated[
        Literal["json", "verbose_json", "text"], Form()
    ] = "verbose_json",
    word_timestamps: Annotated[bool, Form()] = False,
    vad_filter: Annotated[bool, Form()] = True,
    initial_prompt: Annotated[str | None, Form(max_length=500)] = None,
    model: Annotated[str | None, Form()] = None,
) -> Response:
    del model
    payload = await _read_upload_limited(file)
    model_quality: Literal["realtime", "accurate"] = (
        "accurate" if quality == "accurate" else "realtime"
    )
    try:
        result = await _transcribe(
            io.BytesIO(payload),
            quality=model_quality,
            language=language or None,
            task=task,
            beam_size=3 if model_quality == "accurate" else 1,
            word_timestamps=word_timestamps,
            vad_filter=vad_filter,
            initial_prompt=initial_prompt,
        )
    except Exception as error:
        logger.exception("STT request failed")
        raise HTTPException(
            status_code=422, detail=f"could not transcribe audio: {error}"
        ) from error

    headers = {
        "Cache-Control": "no-store",
        "X-Processing-Ms": str(result["processingMs"]),
        "X-Request-Id": result["id"],
    }
    if response_format == "text":
        return PlainTextResponse(result["text"], headers=headers)
    if response_format == "json":
        return JSONResponse({"text": result["text"]}, headers=headers)
    return JSONResponse(result, headers=headers)


@app.post("/v1/tts", tags=["tts"])
@app.post("/v1/audio/speech", tags=["tts"])
async def text_to_speech(request: SpeechRequest) -> Response:
    started = time.perf_counter()
    try:
        async with models.tts_slots:
            samples, sample_rate, language = await asyncio.to_thread(
                _synthesize_sync, request
            )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        logger.exception("TTS request failed")
        raise HTTPException(
            status_code=500, detail="could not synthesize speech"
        ) from error

    processing_ms = round((time.perf_counter() - started) * 1000)
    request_id = f"tts_{uuid.uuid4().hex[:16]}"
    headers = {
        "Cache-Control": "no-store",
        "Content-Disposition": f'inline; filename="{request_id}.wav"',
        "X-Audio-Duration": f"{len(samples) / sample_rate:.3f}",
        "X-Language": language,
        "X-TTS-Frontend": (
            "misaki"
            if language in {"en-us", "en-gb"} and models.g2p_us is not None
            else "espeak"
        ),
        "X-Processing-Ms": str(processing_ms),
        "X-Request-Id": request_id,
    }
    if request.response_format == "pcm":
        headers["Content-Disposition"] = f'inline; filename="{request_id}.pcm"'
        return Response(
            float32_to_pcm16le(samples),
            media_type=f"audio/pcm;rate={sample_rate};channels=1",
            headers=headers,
        )
    return Response(
        float32_to_wav(samples, sample_rate), media_type="audio/wav", headers=headers
    )


@dataclass(frozen=True)
class LiveWord:
    start: float
    end: float
    text: str


def _normalise_live_word(text: str) -> str:
    normalised = re.sub(r"[^\w']+", "", text.casefold(), flags=re.UNICODE)
    return normalised or text.casefold().strip()


def _same_live_word(left: LiveWord, right: LiveWord) -> bool:
    return _normalise_live_word(left.text) == _normalise_live_word(right.text)


def _render_live_words(words: list[LiveWord]) -> str:
    return "".join(word.text for word in words).strip()


@dataclass
class LiveTranscriptState:
    """Stabilize consecutive Whisper hypotheses with LocalAgreement-2."""

    committed: list[LiveWord] = field(default_factory=list)
    previous: list[LiveWord] = field(default_factory=list)
    buffer_start_seconds: float = 0.0

    @property
    def last_committed_time(self) -> float:
        return self.committed[-1].end if self.committed else 0.0

    def reset(self) -> None:
        self.committed.clear()
        self.previous.clear()
        self.buffer_start_seconds = 0.0

    def window_start(self, audio_seconds: float) -> float:
        if audio_seconds - self.buffer_start_seconds <= PARTIAL_WINDOW_SECONDS:
            return self.buffer_start_seconds

        # Keep a full context window. Jumping directly to the newest committed
        # word makes Whisper start mid-sentence and can create repeated tails.
        self.buffer_start_seconds = max(0.0, audio_seconds - PARTIAL_WINDOW_SECONDS)
        return self.buffer_start_seconds

    def update(
        self,
        segments: list[dict[str, Any]],
        window_start: float,
        audio_seconds: float,
    ) -> tuple[str, str, str]:
        candidates = [
            LiveWord(
                start=float(word["start"]) + window_start,
                end=float(word["end"]) + window_start,
                text=str(word["word"]),
            )
            for segment in segments
            for word in (segment.get("words") or [])
            if word.get("word")
        ]

        if self.committed:
            last_end = self.last_committed_time
            candidates = [word for word in candidates if word.end > last_end - 0.15]

            # Whisper commonly repeats a few words around a trimmed audio boundary.
            # Remove only a nearby exact n-gram from the already committed tail.
            for width in range(min(5, len(self.committed), len(candidates)), 0, -1):
                committed_tail = self.committed[-width:]
                candidate_head = candidates[:width]
                if (
                    all(
                        _same_live_word(left, right)
                        for left, right in zip(committed_tail, candidate_head)
                    )
                    and candidate_head[-1].end <= last_end + 1.5
                ):
                    candidates = candidates[width:]
                    break

        previous = self.previous
        if previous and candidates and not _same_live_word(previous[0], candidates[0]):
            alignment: tuple[int, int] | None = None
            for previous_index, old_word in enumerate(previous[:4]):
                for candidate_index, new_word in enumerate(candidates[:4]):
                    if _same_live_word(old_word, new_word) and abs(
                        old_word.start - new_word.start
                    ) <= 1.25:
                        option = (previous_index, candidate_index)
                        if alignment is None or sum(option) < sum(alignment):
                            alignment = option
            if alignment is not None:
                previous = previous[alignment[0] :]
                candidates = candidates[alignment[1] :]

        agreed = 0
        for old_word, new_word in zip(previous, candidates):
            if not _same_live_word(old_word, new_word):
                break
            if abs(old_word.start - new_word.start) > 1.25:
                break
            agreed += 1

        # Keep a short mutable tail. Two identical partials can still end on an
        # unfinished number or word (for example "$18,592." before ".75").
        word_safe_count = max(0, agreed - max(0, LIVE_COMMIT_LAG_WORDS))
        stable_before = audio_seconds - max(0.0, LIVE_COMMIT_DELAY_SECONDS)
        time_safe_count = sum(
            1 for word in candidates[:agreed] if word.end <= stable_before
        )
        commit_count = min(word_safe_count, time_safe_count)
        if commit_count:
            self.committed.extend(candidates[:commit_count])
        self.previous = candidates[commit_count:]

        committed_text = _render_live_words(self.committed)
        pending_text = _render_live_words(self.previous)
        full_text = _render_live_words([*self.committed, *self.previous])
        return full_text, committed_text, pending_text


async def _send_partial(
    websocket: WebSocket,
    raw_pcm: bytes,
    config: SttSocketConfig,
    audio_seconds: float,
    window_start: float,
    transcript_state: LiveTranscriptState,
) -> None:
    try:
        samples = pcm16le_to_float32(raw_pcm, config.sample_rate)
        result = await _transcribe(
            samples,
            quality="realtime",
            preview=True,
            language=config.language,
            task=config.task,
            beam_size=1,
            word_timestamps=True,
            vad_filter=True,
            initial_prompt=config.initial_prompt,
        )
        text, committed_text, pending_text = transcript_state.update(
            result["segments"], window_start, audio_seconds
        )
        await websocket.send_json(
            {
                "type": "partial",
                "text": text,
                "committedText": committed_text,
                "pendingText": pending_text,
                "language": result["language"],
                "languageProbability": result["languageProbability"],
                "audioSeconds": round(audio_seconds, 3),
                "windowStartSeconds": round(window_start, 3),
                "processingMs": result["processingMs"],
                "model": result["model"],
            }
        )
    except Exception as error:  # noqa: BLE001 - a failed partial must not end the live session
        logger.warning("Live partial failed: %s", error)


@app.websocket("/v1/stt/ws")
async def speech_to_text_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    session_id = f"live_{uuid.uuid4().hex[:16]}"
    partial_task: asyncio.Task[None] | None = None
    transcript_state = LiveTranscriptState()
    audio = bytearray()
    try:
        try:
            config = SttSocketConfig.model_validate(await websocket.receive_json())
        except (ValidationError, ValueError, json.JSONDecodeError) as error:
            await websocket.send_json({"type": "error", "error": str(error)})
            await websocket.close(code=1003)
            return

        logger.info(
            "Live STT %s started rate=%s language=%s quality=%s intervalMs=%s",
            session_id,
            config.sample_rate,
            config.language or "auto",
            config.quality,
            config.partial_interval_ms,
        )
        await websocket.send_json(
            {
                "type": "ready",
                "sessionId": session_id,
                "encoding": "pcm_s16le",
                "sampleRate": config.sample_rate,
                "transcriptionSampleRate": 16_000,
                "model": (
                    STT_PREVIEW_EN_MODEL_LABEL
                    if config.language
                    and config.language.lower().split("-", 1)[0] == "en"
                    else STT_REALTIME_MODEL_LABEL
                ),
                "finalQuality": config.quality,
            }
        )

        last_partial_bytes = 0
        partial_interval_bytes = round(
            config.sample_rate * 2 * config.partial_interval_ms / 1000
        )
        max_stream_bytes = MAX_STREAM_SECONDS * config.sample_rate * 2

        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break

            chunk = message.get("bytes")
            if chunk is not None:
                if len(chunk) % 2:
                    await websocket.send_json(
                        {"type": "error", "error": "binary chunks must be pcm_s16le"}
                    )
                    continue
                audio.extend(chunk)
                if len(audio) > max_stream_bytes:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "error": f"stream exceeds the {MAX_STREAM_SECONDS}-second limit",
                        }
                    )
                    await websocket.close(code=1009)
                    return
                if len(audio) - last_partial_bytes >= partial_interval_bytes and (
                    partial_task is None or partial_task.done()
                ):
                    last_partial_bytes = len(audio)
                    audio_seconds = len(audio) / (config.sample_rate * 2)
                    window_start = transcript_state.window_start(audio_seconds)
                    window_start_byte = round(window_start * config.sample_rate) * 2
                    raw_window = bytes(memoryview(audio)[window_start_byte:])
                    partial_task = asyncio.create_task(
                        _send_partial(
                            websocket,
                            raw_window,
                            config,
                            audio_seconds,
                            window_start,
                            transcript_state,
                        )
                    )
                continue

            text = message.get("text")
            if text is None:
                continue
            try:
                control = json.loads(text)
            except json.JSONDecodeError:
                await websocket.send_json(
                    {"type": "error", "error": "invalid JSON control message"}
                )
                continue

            message_type = control.get("type")
            if message_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            if message_type == "reset":
                if partial_task:
                    with contextlib.suppress(Exception):
                        await partial_task
                audio.clear()
                last_partial_bytes = 0
                transcript_state.reset()
                await websocket.send_json({"type": "reset"})
                continue
            if message_type != "stop":
                await websocket.send_json(
                    {"type": "error", "error": "expected stop, reset, or ping"}
                )
                continue

            if partial_task:
                with contextlib.suppress(Exception):
                    await partial_task
            if not audio:
                await websocket.send_json(
                    {"type": "error", "error": "no audio received"}
                )
                continue

            samples = pcm16le_to_float32(bytes(audio), config.sample_rate)
            result = await _transcribe(
                samples,
                quality=config.quality,
                language=config.language,
                task=config.task,
                beam_size=3 if config.quality == "accurate" else 1,
                word_timestamps=config.word_timestamps,
                vad_filter=True,
                initial_prompt=config.initial_prompt,
            )
            await websocket.send_json(
                {"type": "final", "sessionId": session_id, **result}
            )
            logger.info(
                "Live STT %s finalized audioSeconds=%.3f processingMs=%s textChars=%s",
                session_id,
                len(audio) / (config.sample_rate * 2),
                result["processingMs"],
                len(result["text"]),
            )
            await websocket.close(code=1000)
            return
    except WebSocketDisconnect:
        pass
    except AudioInputError as error:
        with contextlib.suppress(Exception):
            await websocket.send_json({"type": "error", "error": str(error)})
            await websocket.close(code=1003)
    except Exception:
        logger.exception("STT WebSocket failed")
        with contextlib.suppress(Exception):
            await websocket.send_json(
                {"type": "error", "error": "transcription failed"}
            )
            await websocket.close(code=1011)
    finally:
        if partial_task and not partial_task.done():
            with contextlib.suppress(Exception):
                await partial_task
        logger.info(
            "Live STT %s closed audioSeconds=%.3f",
            session_id,
            len(audio) / (config.sample_rate * 2) if "config" in locals() else 0.0,
        )


@app.websocket("/v1/tts/ws")
async def text_to_speech_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    await websocket.send_json(
        {
            "type": "ready",
            "format": "pcm_s16le",
            "sampleRate": 24_000,
            "channels": 1,
            "model": "Kokoro-82M-v1.0",
        }
    )
    try:
        while True:
            control = await websocket.receive_json()
            if control.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            if control.get("type") not in (None, "speak"):
                await websocket.send_json(
                    {"type": "error", "error": "expected speak or ping"}
                )
                continue
            try:
                request = SpeechRequest.model_validate(control)
            except ValidationError as error:
                await websocket.send_json({"type": "error", "error": str(error)})
                continue
            if models.tts is None or request.voice not in models.tts.get_voices():
                await websocket.send_json(
                    {"type": "error", "error": f"unknown voice: {request.voice}"}
                )
                continue

            request_id = f"tts_{uuid.uuid4().hex[:16]}"
            language = _language_for_voice(request.voice, request.language)
            await websocket.send_json(
                {
                    "type": "start",
                    "id": request_id,
                    "format": "pcm_s16le",
                    "sampleRate": 24_000,
                    "channels": 1,
                    "voice": request.voice,
                    "language": language,
                    "frontend": (
                        "misaki"
                        if language in {"en-us", "en-gb"} and models.g2p_us is not None
                        else "espeak"
                    ),
                }
            )
            started = time.perf_counter()
            sample_count = 0
            first_audio_ms: int | None = None
            sample_rate = 24_000
            if request.input is None:
                await websocket.send_json(
                    {"type": "error", "error": "input is required"}
                )
                continue
            text_chunks = _split_tts_text(request.input)
            async with models.tts_slots:
                for index, text_chunk in enumerate(text_chunks):
                    samples, sample_rate = await asyncio.to_thread(
                        _synthesize_chunk_sync,
                        text_chunk,
                        voice=request.voice,
                        speed=request.speed,
                        language=language,
                    )
                    if index < len(text_chunks) - 1:
                        samples = np.concatenate(
                            [
                                samples,
                                np.zeros(round(sample_rate * 0.08), dtype=np.float32),
                            ]
                        )
                    sample_count += len(samples)
                    if first_audio_ms is None:
                        first_audio_ms = round((time.perf_counter() - started) * 1000)
                    await websocket.send_bytes(float32_to_pcm16le(samples))
            await websocket.send_json(
                {
                    "type": "done",
                    "id": request_id,
                    "audioSeconds": round(sample_count / sample_rate, 3),
                    "processingMs": round((time.perf_counter() - started) * 1000),
                    "timeToFirstAudioMs": first_audio_ms,
                    "chunks": len(text_chunks),
                }
            )
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("TTS WebSocket failed")
        with contextlib.suppress(Exception):
            await websocket.send_json(
                {"type": "error", "error": "speech synthesis failed"}
            )
            await websocket.close(code=1011)
