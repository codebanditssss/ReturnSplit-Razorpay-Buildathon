# Voice Lab

Self-hosted speech-to-text and text-to-speech for the dedicated Upstash Box
`voice-lab-stt-tts`.

## Models

- Live English previews: Faster Whisper `base.en`, CPU INT8, bounded rolling
  windows, VAD, and LocalAgreement-2 stabilization. This path is tuned for
  sub-second inference without constantly rewriting already stable words.
- Realtime finals: Faster Whisper `small.en` for English and multilingual
  `small` for auto-detection or other languages, CPU INT8, beam size 1.
- Studio STT: Faster Whisper `large-v3-turbo`, CPU INT8, beam size 3. Opt in
  with `quality=accurate` when latency matters less than difficult-audio quality.
- TTS: Kokoro-82M v1.0 full-precision ONNX with Misaki English G2P,
  low-latency first-chunk streaming, and de-clicked 24 kHz mono output.
- Runtime: one Uvicorn worker on an 8 vCPU / 16 GB Large keep-alive Box.

The browser captures device-native PCM (normally 44.1 or 48 kHz) and the server
uses SoXR HQ to convert it to Whisper's 16 kHz input. This avoids unsupported
fixed-rate `AudioContext` failures and block-boundary artifacts from browser-side
resampling.

The Box proxy protects the entire service with HTTP Basic authentication. Keep
those credentials server-side when integrating the API; do not publish them in
frontend source.

## HTTP API

Health and metadata:

```text
GET /healthz
GET /v1/voices
GET /docs
```

Transcription (also available at `/v1/audio/transcriptions`):

```bash
curl -u "$VOICE_USER:$VOICE_PASSWORD" \
  -F file=@recording.mp3 \
  -F quality=realtime \
  -F response_format=verbose_json \
  https://YOUR_BOX_URL/v1/stt
```

Speech generation (also available at `/v1/audio/speech`):

```bash
curl -u "$VOICE_USER:$VOICE_PASSWORD" \
  -H 'Content-Type: application/json' \
  -d '{"input":"Hello from Voice Lab.","voice":"af_heart","speed":1}' \
  https://YOUR_BOX_URL/v1/tts \
  --output speech.wav
```

## WebSocket API

For live STT, connect to `/v1/stt/ws`, send this JSON first, then binary mono
PCM16-LE chunks, and finish with `{"type":"stop"}`:

```json
{
  "type": "start",
  "encoding": "pcm_s16le",
  "sample_rate": 48000,
  "language": null,
  "partial_interval_ms": 500,
  "quality": "realtime",
  "word_timestamps": false
}
```

Send the actual capture rate in `sample_rate`; 16, 44.1, and 48 kHz PCM are all
supported. The server emits `ready`, stabilized rolling `partial`, and `final`
JSON events. A partial includes `committedText` and `pendingText`. Set
`quality` to `accurate` for a slower large-model final pass; partials always use
the realtime model.

## Concurrency

The default single-process scheduler admits two live preview decodes, two
realtime final transcriptions, one Studio transcription, and two TTS generations
at a time. Additional requests wait rather than starting enough CPU work to
destroy latency. These are inference slots, not connection limits; scale across
multiple Boxes for sustained public traffic.

For streaming TTS, connect to `/v1/tts/ws` and send:

```json
{"type":"speak","input":"Hello.","voice":"af_heart","speed":1}
```

The server emits a JSON `start` frame, binary 24 kHz PCM16-LE audio frames,
then a JSON `done` frame. A connection may handle multiple requests in order.

## Limits

- File upload: 100 MB
- Live STT session: 10 minutes
- TTS request: 5,000 characters

These are per-process safety limits, not a substitute for tenant-level quotas
or rate limiting. Add those before distributing credentials to end users.
