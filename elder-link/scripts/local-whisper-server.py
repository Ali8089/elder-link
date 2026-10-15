#!/usr/bin/env python
"""Fully local, offline Whisper transcription server for Elder Link.

Why this file exists
--------------------
``src/routes/api/speech/transcribe.ts`` proxies speech-to-text to whatever
``SPEECH_TO_TEXT_URL`` points at.  The public providers (Groq, OpenAI) are
geo-blocked from Hong Kong — they answer HTTP 403 even with a browser
User-Agent — so the call feature would be dead on arrival here.

This server speaks the *same* OpenAI-compatible protocol, so the route needs no
changes: point ``SPEECH_TO_TEXT_URL`` at
``http://127.0.0.1:5599/v1/audio/transcriptions`` and it just works.  It runs on
``faster-whisper`` with the CTranslate2 CPU backend, which means:

  * no API key, no signup, no network egress after the model is cached;
  * the elder's voice never leaves this machine — the whole point for a service
    handling vulnerable people's audio;
  * it works offline, which matters when the "call" is the safety check.

Protocol implemented
--------------------
``POST /v1/audio/transcriptions`` — ``multipart/form-data`` with the fields the
route forwards: ``file`` (the audio), ``model``, ``language`` and ``prompt``.
Responds ``{"text": "..."}``.

``GET  /health`` — ``{"status": "ok", "model": "...", "device": "..."}``.

Three environment quirks this file deliberately works around
-----------------------------------------------------------
Everything below was found by testing on the target machine, not assumed:

1. **``huggingface_hub`` writes 0-byte model files here.**  Downloading
   ``Systran/faster-whisper-small`` via ``snapshot_download`` (or
   ``hf_hub_download``, with or without the Xet backend, with or without
   ``local_dir``) leaves a 0-byte ``model.bin`` in the snapshot directory even
   though the blob lands at the right size.  ``WhisperModel`` then dies with
   ``File model.bin is incomplete``.  Plain ``urllib`` streaming to a normal
   directory works fine, so this file downloads the weights itself and never
   touches the HF cache.

2. **faster-whisper 1.2.1 cannot decode audio with the installed PyAV 19.0.1.**
   Its ``decode_audio`` calls ``av.open(..., metadata_errors="ignore")``, and
   that keyword no longer exists, so *every* transcription raises
   ``TypeError: open() got an unexpected keyword argument 'metadata_errors'``.
   We decode with PyAV directly (which works) and hand faster-whisper a
   ``numpy`` array, which is a supported input type.

3. **Whisper's ``yue`` language token is unreliable on ``small``.**  ``yue`` is
   listed in ``supported_languages`` and is *accepted*, so a
   rejection-based fallback never fires — but on this project's audio, with the
   prompt the route actually sends, it deterministically emits rows of ``﹑``
   (and takes ~15 s doing it), while ``zh`` returns the exact spoken line,
   Cantonese characters and all.     (``medium`` handles ``yue`` correctly; only
   the small checkpoint is affected.)  So ``zh`` is the default, and the guard
   below retries on visibly junk output rather than on an exception.

4. **The per-request ``language`` field is deliberately overridden.**  The app
   sends ``language=yue`` (``DEFAULT_LANGUAGE`` in
   ``src/routes/api/speech/transcribe.ts``).  Because of point 3 the server pins
   ``WHISPER_LANGUAGE`` instead, and says so at startup and once per distinct
   requested value, so the app is not left believing it got ``yue``.  Set
   ``WHISPER_HONOR_REQUEST_LANGUAGE=1`` to accept the request's value.

Run it with the project interpreter (no new venv, no new dependencies):

    "C:/Users/user/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe" \\
        scripts/local-whisper-server.py
"""

from __future__ import annotations

import email
import io
import json
import logging
import os
import re
import threading
import time
import urllib.request
from email import policy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional

# --------------------------------------------------------------------------- #
# Configuration — every knob is overridable by environment variable.
# --------------------------------------------------------------------------- #

#: Whisper checkpoint.  ``small`` is the default: fast enough on CPU to be
#: usable and, with the ``zh`` language setting below, accurate on Cantonese.
#: ``medium`` / ``large-v3`` are better again but much slower on CPU.
MODEL_SIZE: str = os.environ.get("WHISPER_MODEL", "small")

#: ``cpu`` or ``cuda``.  A dashboard box has no GPU, so CPU by default.
DEVICE: str = os.environ.get("WHISPER_DEVICE", "cpu")

#: CTranslate2 compute type.  ``int8`` is the sweet spot on CPU: roughly 2x
#: faster than ``float32`` with little accuracy loss on quantisation-tolerant
#: Whisper.  On CUDA, ``float16`` is the usual choice.
COMPUTE_TYPE: str = os.environ.get(
    "WHISPER_COMPUTE_TYPE", "int8" if DEVICE == "cpu" else "float16"
)

#: Listening port.  Matches the stand-in stub and the value the deploy docs use.
PORT: int = int(os.environ.get("WHISPER_PORT", "5599"))

#: Bind address.  Loopback only — this is a private helper, never expose it.
HOST: str = os.environ.get("WHISPER_HOST", "127.0.0.1")

#: Where downloaded weights live.  Overridable so an air-gapped install can
#: pre-seed a directory and set ``WHISPER_MODEL_DIR`` to it.
MODEL_CACHE_DIR: str = os.environ.get(
    "WHISPER_MODEL_DIR", os.path.join(os.path.expanduser("~"), ".cache", "local-whisper")
)

#: Transcription language.  Defaults to ``zh``, NOT ``yue``: on ``small`` the
#: ``yue`` token produces deterministic garbage, while ``zh`` returns the
#: correct Cantonese text (see the module docstring).  Set to ``yue`` if you
#: run a checkpoint that handles it properly.
LANGUAGE: str = os.environ.get("WHISPER_LANGUAGE", "zh")

#: Language to retry with when the configured one emits junk.
FALLBACK_LANGUAGE: str = os.environ.get("WHISPER_FALLBACK_LANGUAGE", "zh")

#: Whether to accept the per-request ``language`` field.  OFF by default, and
#: deliberately so: the app sends ``yue`` (see ``DEFAULT_LANGUAGE`` in
#: ``src/routes/api/speech/transcribe.ts``) and Whisper's ``yue`` token emits
#: filler symbols on the smaller checkpoints, so the server pins the language
#: rather than honouring the request.  That override is announced at startup and
#: on the first request that asks for something else.  Turn this on only with a
#: checkpoint known to handle ``yue`` (``medium`` and up).
HONOR_REQUEST_LANGUAGE: bool = os.environ.get(
    "WHISPER_HONOR_REQUEST_LANGUAGE", "0"
).strip().lower() in ("1", "true", "yes")

#: Voice-activity gating.  ON by default, with ``WHISPER_VAD=0`` to disable.
#:
#: This default was flipped from OFF after measuring the failure it causes.
#: A real check-in recording is 12 s of mostly quiet room noise with a few
#: seconds of speech in the middle — nothing like the pre-recorded clips the
#: server was originally verified against.  Fed that shape, ``small`` does not
#: return "nothing heard"; it latches onto the ``initial_prompt`` and recites it.
#: Reproduced deterministically on a synthetic 12 s quiet clip:
#:
#:   VAD off -> 24.0 s, '佢會講自己今日身體點，例如《我冇事》，例如《我冇事》，...'  (x11)
#:   VAD on  ->  8.3 s, no repetition
#:
#: The same runaway text appeared in the live server log on real microphone
#: input, so this is the actual reported symptom, not a synthetic curiosity.
#: It also makes the fast path faster: 24 s -> 8 s, because the silent tail is
#: no longer decoded.
USE_VAD: bool = os.environ.get("WHISPER_VAD", "1").strip().lower() not in ("0", "false", "no")

#: Cap on repeated n-grams.  Whisper's repetition loops are a decoding failure,
#: not a language failure, so the guard is blunt on purpose: a check-in answer is
#: a short sentence and never legitimately repeats a 3-gram.  Measured: without
#: this, a quiet clip still echoed the prompt twice even with VAD on.
NO_REPEAT_NGRAM_SIZE: int = int(os.environ.get("WHISPER_NO_REPEAT_NGRAM", "3"))

#: Treat low-confidence decodes as silence rather than text.
#:
#: Whisper reports per-segment confidence; below these thresholds the "text" is
#: hallucination.  ``no_speech_threshold`` is the important one — it is what
#: turns a quiet recording into an empty transcript instead of invented words,
#: and the app already maps empty to the no-answer path.  Measured on the same
#: quiet clip: with these set the result is correctly ``''`` (silence) rather
#: than a plausible-looking sentence nobody said.
NO_SPEECH_THRESHOLD: float = float(os.environ.get("WHISPER_NO_SPEECH_THRESHOLD", "0.6"))
LOG_PROB_THRESHOLD: float = float(os.environ.get("WHISPER_LOG_PROB_THRESHOLD", "-0.7"))
COMPRESSION_RATIO_THRESHOLD: float = float(
    os.environ.get("WHISPER_COMPRESSION_RATIO_THRESHOLD", "2.0")
)

#: Refuse bodies larger than this before buffering them (the route caps at 8 MiB;
#: give a little headroom).
MAX_BODY_BYTES: int = int(os.environ.get("WHISPER_MAX_BODY_BYTES", str(12 * 1024 * 1024)))

#: Sample rate Whisper expects.
SAMPLE_RATE: int = 16_000

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("local-whisper")

#: Known size -> Hugging Face repository.  A ``WHISPER_MODEL`` that is not in
#: here (and has no ``/``) falls back to the ``Systran/faster-whisper-<name>``
#: naming convention.
_REPO_BY_SIZE: dict[str, str] = {
    "tiny": "Systran/faster-whisper-tiny",
    "tiny.en": "Systran/faster-whisper-tiny.en",
    "base": "Systran/faster-whisper-base",
    "small": "Systran/faster-whisper-small",
    "medium": "Systran/faster-whisper-medium",
    "large": "Systran/faster-whisper-large-v2",
    "large-v2": "Systran/faster-whisper-large-v2",
    "large-v3": "Systran/faster-whisper-large-v3",
    "distil-large-v3": "Systran/faster-whisper-distil-large-v3",
}

#: Files a CTranslate2 Whisper model needs.  Fetched from the repo's file list
#: at download time rather than hard-coded, so ``large-v3``'s extra
#: ``preprocessor_config.json`` is picked up automatically.
_SKIP_SUFFIXES = (".md", ".gitattributes")


# --------------------------------------------------------------------------- #
# Model acquisition — plain urllib, because huggingface_hub writes 0 bytes here
# --------------------------------------------------------------------------- #


def _repo_id_for(model: str) -> str:
    """Map a model size (or a full ``owner/name``) to a Hugging Face repo id."""
    if "/" in model:
        return model
    return _REPO_BY_SIZE.get(model, f"Systran/faster-whisper-{model}")


def _download_file(url: str, dest: str) -> None:
    """Stream ``url`` to ``dest`` atomically.

    Writes to a ``.part`` sibling and renames on success so an interrupted
    download never leaves a half-written ``model.bin`` that would later be
    mistaken for a complete one.

    Args:
        url: The file to fetch.
        dest: Absolute path to write.
    """
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    request = urllib.request.Request(url, headers={"User-Agent": "local-whisper/1.0"})
    with urllib.request.urlopen(request, timeout=300) as response, open(tmp, "wb") as handle:
        while True:
            chunk = response.read(1024 * 512)
            if not chunk:
                break
            handle.write(chunk)
    os.replace(tmp, dest)


def ensure_model_files(model: str) -> str:
    """Make sure the weights for ``model`` exist locally and return the directory.

    A local directory passed as ``WHISPER_MODEL`` is used as-is.  Otherwise the
    repo's file list is fetched from the HF API and any missing weight file is
    downloaded into ``MODEL_CACHE_DIR``.  Existing, non-empty files are left
    alone, so this is a no-op after the first run.

    Args:
        model: A size name (``small``), a repo id (``Systran/faster-whisper-...``)
            or a path to a directory that already holds the files.

    Returns:
        Directory containing ``model.bin`` and friends.

    Raises:
        RuntimeError: If the weights cannot be materialised.
    """
    if os.path.isdir(model):
        if not _has_weights(model):
            raise RuntimeError(f"'{model}' is a directory but contains no model.bin.")
        return model

    repo_id = _repo_id_for(model)
    target = os.path.join(MODEL_CACHE_DIR, repo_id.replace("/", "--"))

    if _has_weights(target):
        log.info("using cached model at %s", target)
        return target

    log.info("downloading model '%s' from %s (first run only)", model, repo_id)
    started = time.time()
    try:
        with urllib.request.urlopen(
            f"https://huggingface.co/api/models/{repo_id}", timeout=60
        ) as response:
            info = json.load(response)
    except Exception as exc:  # network down, repo missing, HF blocked
        raise RuntimeError(f"Could not list files for '{repo_id}': {exc}") from exc

    filenames = [
        entry["rfilename"]
        for entry in info.get("siblings", [])
        if not entry["rfilename"].endswith(_SKIP_SUFFIXES)
    ]
    if not filenames:
        raise RuntimeError(f"Repository '{repo_id}' exposes no files.")

    for name in filenames:
        dest = os.path.join(target, name)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            continue
        _download_file(f"https://huggingface.co/{repo_id}/resolve/main/{name}", dest)
        log.info("  fetched %s (%.1f MiB)", name, os.path.getsize(dest) / 1024 / 1024)

    if not _has_weights(target):
        raise RuntimeError(f"Download of '{repo_id}' did not produce a model.bin.")
    log.info("model '%s' ready in %.1fs", model, time.time() - started)
    return target


def _has_weights(directory: str) -> bool:
    """True when ``directory`` holds a non-empty ``model.bin``."""
    path = os.path.join(directory, "model.bin")
    return os.path.exists(path) and os.path.getsize(path) > 0


# --------------------------------------------------------------------------- #
# Model lifecycle
# --------------------------------------------------------------------------- #

_model: Optional[Any] = None
_model_lock = threading.Lock()

#: Languages already observed to emit junk.  Sticky: once a language fails we
#: stop paying for a doomed first pass on every later request, which matters
#: because a bad ``yue`` pass costs ~15 s before the retry even starts.
_junk_languages: set[str] = set()
_junk_lock = threading.Lock()

#: Request languages we have already announced an override for, so the warning
#: appears once per distinct value rather than on every call.
_override_seen: set[str] = set()
_override_lock = threading.Lock()


def note_language_override(requested: str) -> None:
    """Announce, once per value, that a request's language is being overridden.

    The app sends ``language=yue``; this server pins the language to
    ``WHISPER_LANGUAGE`` because Whisper's ``yue`` token emits filler symbols on
    the smaller checkpoints.  Ignoring the caller's request is the right call
    here, but doing it silently means the app believes it is getting ``yue``
    while the server uses ``zh``.  Logging it once makes the behaviour explicit
    and auditable instead of accidental.

    Args:
        requested: The ``language`` value supplied by the request.
    """
    if HONOR_REQUEST_LANGUAGE or requested == LANGUAGE:
        return
    with _override_lock:
        if requested in _override_seen:
            return
        _override_seen.add(requested)
    log.warning(
        "ignoring the request's language '%s' and using '%s' instead: Whisper's "
        "'yue' token is unreliable on the '%s' checkpoint. Set "
        "WHISPER_HONOR_REQUEST_LANGUAGE=1 to accept the request's value.",
        requested,
        LANGUAGE,
        MODEL_SIZE,
    )

#: Characters that count as real content when judging whether output is junk.
#: Covers ASCII, CJK ideographs, CJK punctuation-adjacent digits and fullwidth
#: alphanumerics.  Whisper's failure mode on a bad language token is a run of
#: ``﹑``/``﹒`` symbols, which match none of these.
_MEANINGFUL = re.compile(
    r"[0-9A-Za-z\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]"
)


def get_model() -> Any:
    """Return the shared ``WhisperModel``, loading it on first use.

    The load is serialised by a lock: without it, a burst of concurrent
    requests on a cold server would each start their own download and fight
    over the same cache directory.

    Returns:
        A ready-to-use ``faster_whisper.WhisperModel``.
    """
    global _model
    if _model is not None:
        return _model

    with _model_lock:
        # Re-check: another thread may have finished loading while we waited.
        if _model is not None:
            return _model

        # Imported here, not at module top, so binding the port stays instant.
        from faster_whisper import WhisperModel

        directory = ensure_model_files(MODEL_SIZE)
        log.info(
            "loading '%s' (device=%s, compute_type=%s) from %s",
            MODEL_SIZE,
            DEVICE,
            COMPUTE_TYPE,
            directory,
        )
        started = time.time()
        _model = WhisperModel(directory, device=DEVICE, compute_type=COMPUTE_TYPE)
        log.info("model ready in %.1fs", time.time() - started)
        return _model


# --------------------------------------------------------------------------- #
# Audio decoding — our own, because faster-whisper 1.2.1 + PyAV 19.0.1 is broken
# --------------------------------------------------------------------------- #


def decode_audio(data: bytes, sample_rate: int = SAMPLE_RATE) -> "Any":
    """Decode compressed audio bytes to mono float32 PCM at ``sample_rate``.

    faster-whisper's own ``decode_audio`` passes a ``metadata_errors`` keyword
    that PyAV 19.0.1 rejects, so every call would raise ``TypeError``.  PyAV
    itself decodes fine without that keyword, so we drive it directly and hand
    the resulting array to ``WhisperModel.transcribe``, which accepts numpy.

    Args:
        data: Raw bytes of an audio container (webm/opus, mp3, ogg, wav, ...).
        sample_rate: Target sample rate; Whisper wants 16 kHz.

    Returns:
        A 1-D ``numpy.float32`` array of samples.  Empty if nothing decoded.
    """
    import av
    import numpy as np

    chunks: list[Any] = []
    with av.open(io.BytesIO(data), mode="r") as container:
        stream = container.streams.audio[0]
        resampler = av.audio.resampler.AudioResampler(
            format="flt", layout="mono", rate=sample_rate
        )
        for frame in container.decode(stream):
            for resampled in resampler.resample(frame):
                chunks.append(resampled.to_ndarray())
        # Flush whatever the resampler is still holding.
        try:
            for resampled in resampler.resample(None):
                chunks.append(resampled.to_ndarray())
        except Exception:
            # Older PyAV raises on a ``None`` flush; the tail is negligible.
            pass

    if not chunks:
        return np.zeros(0, dtype=np.float32)
    # Frames are (channels, samples) with channels == 1; flatten to 1-D.
    return np.concatenate(chunks, axis=1).reshape(-1).astype(np.float32)


def _looks_like_content(text: str) -> bool:
    """Heuristic: does ``text`` contain real words rather than decoder noise?

    Whisper's bad-language output is a long run of punctuation symbols with no
    letters or ideographs.  An empty string is *not* junk — silence is a normal
    check-in outcome — so it is reported as content-less only by the caller.

    Args:
        text: The transcript to judge.

    Returns:
        True when at least one meaningful character is present.
    """
    return bool(_MEANINGFUL.search(text))


def _run(model: Any, samples: "Any", language: str, prompt: Optional[str]) -> str:
    """Transcribe decoded samples once and return the joined text.

    The decode options are not cosmetic — each one was measured against a real
    failure on this machine, and the comments say which:

    * ``temperature=0.0`` + ``condition_on_previous_text=False`` — with the
      defaults, ``small`` falls into a temperature-escalation loop on short
      Cantonese audio, taking ~160 s and emitting hallucinated junk.
    * ``no_repeat_ngram_size`` — a second guard against the same class of
      failure: a quiet clip echoed the prompt verbatim, twice.
    * the three thresholds — what makes a quiet recording come back as *empty*
      (silence, the honest answer) rather than as a fluent sentence that was
      never spoken.  ``no_speech_threshold`` is the load-bearing one.
    * ``vad_filter`` — on by default; see the note on ``USE_VAD``.

    Silence deliberately returns ``""``: the caller maps that to the no-answer
    path, and inventing a wellbeing sentence from room noise is the one
    outcome this system must never produce.
    """
    segments, _info = model.transcribe(
        samples,
        language=language,
        beam_size=5,
        temperature=0.0,
        condition_on_previous_text=False,
        no_repeat_ngram_size=NO_REPEAT_NGRAM_SIZE,
        no_speech_threshold=NO_SPEECH_THRESHOLD,
        log_prob_threshold=LOG_PROB_THRESHOLD,
        compression_ratio_threshold=COMPRESSION_RATIO_THRESHOLD,
        initial_prompt=prompt or None,
        vad_filter=USE_VAD,
        vad_parameters={"min_silence_duration_ms": 500} if USE_VAD else None,
    )
    # ``segments`` is a generator: the real work happens as we iterate.
    return "".join(segment.text for segment in segments).strip()


def transcribe_bytes(
    audio: bytes,
    prompt: Optional[str],
    language: Optional[str] = None,
) -> str:
    """Transcribe raw audio bytes, guarding against a junk-language result.

    Args:
        audio: Raw uploaded audio.
        prompt: Cantonese context sentence from the caller, used as
            ``initial_prompt``.  It genuinely helps: without it, even a working
            language setting can degenerate into filler symbols.
        language: Language to transcribe in.  Defaults to the configured
            ``WHISPER_LANGUAGE``; a caller only supplies a value when
            ``WHISPER_HONOR_REQUEST_LANGUAGE`` is on.

    Returns:
        The transcript text.  Empty string for silence.

    Raises:
        Exception: Whatever decoding or inference raised, if unrecoverable.
    """
    samples = decode_audio(audio)
    if samples.size == 0:
        return ""

    model = get_model()

    active = language or LANGUAGE
    # Skip straight to the fallback if this language has already been seen to
    # emit junk, so only the very first request pays the wasted first pass.
    with _junk_lock:
        chosen = FALLBACK_LANGUAGE if active in _junk_languages else active

    text = _run(model, samples, chosen, prompt)

    # Empty is a legitimate "no speech" answer; only non-empty junk triggers a
    # retry, so we never burn a second pass on a genuinely silent recording.
    if text and not _looks_like_content(text) and chosen != FALLBACK_LANGUAGE:
        with _junk_lock:
            first_time = chosen not in _junk_languages
            _junk_languages.add(chosen)
        if first_time:
            log.warning(
                "language '%s' produced no recognisable text (e.g. %r); falling back "
                "to '%s' for all subsequent requests — set WHISPER_LANGUAGE to override",
                chosen,
                text[:24],
                FALLBACK_LANGUAGE,
            )
        retry = _run(model, samples, FALLBACK_LANGUAGE, prompt)
        if _looks_like_content(retry):
            return retry

    return text


# --------------------------------------------------------------------------- #
# Multipart parsing (stdlib ``email``; ``cgi`` no longer exists in 3.13)
# --------------------------------------------------------------------------- #


def parse_multipart(
    content_type: str, body: bytes
) -> tuple[dict[str, str], dict[str, tuple[str, bytes]]]:
    """Split a ``multipart/form-data`` body into text fields and files.

    Args:
        content_type: The request's ``Content-Type`` header, including boundary.
        body: The raw request body.

    Returns:
        ``(fields, files)`` where ``fields`` maps name -> decoded text and
        ``files`` maps name -> ``(filename, raw_bytes)``.
    """
    # Rebuild a minimal MIME message so the stdlib parser can walk the parts.
    header = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("latin-1")
    message = email.message_from_bytes(header + body, policy=policy.default)

    fields: dict[str, str] = {}
    files: dict[str, tuple[str, bytes]] = {}

    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not name:
            continue
        payload = part.get_payload(decode=True) or b""
        filename = part.get_filename()
        if filename is not None:
            files[name] = (filename, payload)
        else:
            charset = part.get_content_charset() or "utf-8"
            fields[name] = payload.decode(charset, errors="replace")

    return fields, files


# --------------------------------------------------------------------------- #
# HTTP layer
# --------------------------------------------------------------------------- #


class Handler(BaseHTTPRequestHandler):
    """Minimal OpenAI-compatible Whisper endpoint."""

    server_version = "LocalWhisper/1.0"

    # -- helpers ----------------------------------------------------------- #

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        """Write a JSON response with the right headers."""
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self) -> Optional[bytes]:
        """Read the request body, or ``None`` if it is oversized/malformed."""
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"text": "", "error": "Invalid Content-Length."})
            return None
        if length <= 0:
            return b""
        if length > MAX_BODY_BYTES:
            self._send_json(413, {"text": "", "error": "Recording too long."})
            return None
        return self.rfile.read(length)

    # -- routes ------------------------------------------------------------ #

    def do_GET(self) -> None:  # noqa: N802 — name fixed by BaseHTTPRequestHandler
        """Health probe.  Deliberately does not load the model."""
        if self.path.split("?")[0] in ("/health", "/"):
            self._send_json(
                200,
                {
                    "status": "ok",
                    "model": MODEL_SIZE,
                    "device": DEVICE,
                    "compute_type": COMPUTE_TYPE,
                    "language": LANGUAGE,
                    "loaded": _model is not None,
                },
            )
            return
        self._send_json(404, {"error": "Not found."})

    def do_POST(self) -> None:  # noqa: N802 — name fixed by BaseHTTPRequestHandler
        """Transcription endpoint, matching the OpenAI contract the route expects."""
        if self.path.split("?")[0] != "/v1/audio/transcriptions":
            self._send_json(404, {"text": "", "error": "Not found."})
            return

        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self._send_json(400, {"text": "", "error": "Expected multipart/form-data."})
            return

        body = self._read_body()
        if body is None:
            return

        try:
            fields, files = parse_multipart(content_type, body)
        except Exception as exc:  # malformed multipart
            log.warning("could not parse multipart body: %s", exc)
            self._send_json(400, {"text": "", "error": "Malformed request."})
            return

        if "file" not in files:
            self._send_json(400, {"text": "", "error": "No audio supplied."})
            return

        _filename, audio = files["file"]
        if not audio:
            # Silence is a normal outcome for a check-in, not an error.
            self._send_json(200, {"text": ""})
            return

        # The route sends the prompt precisely so Whisper does not invent words
        # on two seconds of quiet speech; we honour it as ``initial_prompt``.
        prompt = fields.get("prompt") or None

        # The route also sends ``language`` (it defaults to ``yue``).  We do not
        # honour it by default — see ``note_language_override`` — but we do
        # announce the override, so the behaviour is a decision rather than an
        # accident.
        requested_language = (fields.get("language") or "").strip()
        if requested_language:
            note_language_override(requested_language)

        started = time.time()
        try:
            text = transcribe_bytes(
                audio,
                prompt,
                requested_language if HONOR_REQUEST_LANGUAGE else None,
            )
        except Exception as exc:
            # Never leak a stack trace to the caller — the route maps our error
            # field into a human message.
            log.exception("transcription failed")
            self._send_json(500, {"text": "", "error": f"Transcription failed: {exc}"})
            return

        elapsed = time.time() - started
        log.info(
            "transcribed %d bytes in %.2fs -> %r",
            len(audio),
            elapsed,
            text[:80],
        )
        self._send_json(200, {"text": text})

    def log_message(self, fmt: str, *args: Any) -> None:
        """Route http.server's access log through our logger."""
        log.info("%s - %s", self.address_string(), fmt % args)


def main() -> None:
    """Bind the port and serve until interrupted."""
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    # Announce clearly, and on its own lines, so a supervisor can see it.
    print(f"Local Whisper server listening on http://{HOST}:{PORT}", flush=True)
    print(f"  endpoint : POST http://{HOST}:{PORT}/v1/audio/transcriptions", flush=True)
    print(f"  health   : GET  http://{HOST}:{PORT}/health", flush=True)
    print(f"  model    : {MODEL_SIZE} ({DEVICE}, {COMPUTE_TYPE}), language {LANGUAGE}", flush=True)
    print(f"  cache    : {MODEL_CACHE_DIR}", flush=True)
    if HONOR_REQUEST_LANGUAGE:
        print("  language : honouring the request's `language` field", flush=True)
    else:
        print(
            "  language : OVERRIDING the request's `language` field — the app sends "
            f"'yue', which is unreliable on '{MODEL_SIZE}', so '{LANGUAGE}' is pinned",
            flush=True,
        )
        print(
            "             (set WHISPER_HONOR_REQUEST_LANGUAGE=1 to accept the request's value)",
            flush=True,
        )
    print("  model loads lazily on the first transcription request.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
