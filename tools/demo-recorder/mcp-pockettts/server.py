"""PocketTTS MCP server — in-process streaming TTS via FastMCP.

Loads the PocketTTS model directly (GPU if available), streams PCM chunks
to ffplay as they're generated. No HTTP server, no temp files.
"""

import asyncio
import subprocess
import sys
import threading
from collections import deque
from pathlib import Path
from typing import Optional

import numpy as np
import torch
from fastmcp import FastMCP
from pocket_tts import TTSModel

# ── Voice configuration ──────────────────────────────────────

VOICE_MAP = {
    "male": "alba",
    "female": "azelma",
}

VOICE_PREFIX = {
    "male": "... ",
    "female": "... ",
}

VOICE_TEMPO = {
    "male": 0.9,
    "female": 0.9,
}

DEFAULT_VOICE = "male"

# ── Model loading ────────────────────────────────────────────

print("[mcp-pockettts] Loading TTS model...", file=sys.stderr, flush=True)
model = TTSModel.load_model(eos_threshold=-4.0, lsd_decode_steps=1, temp=0.8)

if torch.cuda.is_available():
    print(
        f"[mcp-pockettts] GPU detected: {torch.cuda.get_device_name(0)}",
        file=sys.stderr,
        flush=True,
    )
    model = model.to("cuda")
else:
    print("[mcp-pockettts] Using CPU", file=sys.stderr, flush=True)

sample_rate = model.sample_rate

# Pre-compute voice states for both voices
print("[mcp-pockettts] Warming up voices...", file=sys.stderr, flush=True)
voice_states: dict[str, dict] = {}
for short_name, pockettts_name in VOICE_MAP.items():
    voice_states[short_name] = model.get_state_for_audio_prompt(pockettts_name)
print("[mcp-pockettts] Warmup complete.", file=sys.stderr, flush=True)

# ── Speech queue & tracking ──────────────────────────────────

speech_queue: deque[dict] = deque()
queued_word_count = 0
next_speech_id = 1
id_lock = threading.Lock()

# Map speech ID → asyncio.Event (set when that ID finishes playing)
speech_events: dict[int, asyncio.Event] = {}
# Track the event loop so background threads can set events
loop: Optional[asyncio.AbstractEventLoop] = None

drain_task: Optional[asyncio.Task] = None


def _play_streaming(text: str, voice_name: str) -> None:
    """Synthesize text and stream PCM chunks to ffplay (runs in thread)."""
    state = voice_states.get(voice_name, voice_states[DEFAULT_VOICE])
    prefix = VOICE_PREFIX.get(voice_name, ".")
    tempo = VOICE_TEMPO.get(voice_name, 0.9)

    proc = subprocess.Popen(
        [
            "ffplay",
            "-f", "s16le",
            "-ar", str(sample_rate),
            "-ch_layout", "mono",
            "-af", f"atempo={tempo}",
            "-nodisp",
            "-autoexit",
            "-loglevel", "quiet",
            "-i", "pipe:0",
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        # Lead-in silence so ffplay can initialize audio output before real audio
        silence = np.zeros(sample_rate // 5, dtype=np.int16)  # 200ms
        proc.stdin.write(silence.tobytes())

        for chunk in model.generate_audio_stream(
            model_state=state,
            text_to_generate=f"{prefix}{text}",
            copy_state=True,
            frames_after_eos=3,
        ):
            pcm = (np.clip(chunk.numpy(), -1.0, 1.0) * 32767).astype(np.int16)
            proc.stdin.write(pcm.tobytes())
        proc.stdin.close()
        proc.wait()
    except Exception as exc:
        print(
            f"[mcp-pockettts] Playback error: {exc}",
            file=sys.stderr,
            flush=True,
        )
        try:
            proc.stdin.close()
        except Exception:
            pass
        proc.wait()


async def _drain_playback() -> None:
    """Background task: dequeue items, play each, resolve waiters."""
    global queued_word_count

    while speech_queue:
        item = speech_queue.popleft()
        queued_word_count -= item["word_count"]

        await asyncio.to_thread(
            _play_streaming, item["text"], item["voice"]
        )

        # Signal completion for this speech ID
        event = speech_events.get(item["id"])
        if event:
            event.set()


def _enqueue_speech(text: str, voice: str, word_count: int) -> int:
    """Add text to the playback queue. Returns speech ID."""
    global next_speech_id, drain_task, queued_word_count

    with id_lock:
        speech_id = next_speech_id
        next_speech_id += 1

    event = asyncio.Event()
    speech_events[speech_id] = event

    speech_queue.append({
        "id": speech_id,
        "text": text,
        "voice": voice,
        "word_count": word_count,
    })
    queued_word_count += word_count

    # Start drain task if not already running
    if drain_task is None or drain_task.done():
        drain_task = asyncio.get_event_loop().create_task(_drain_playback())

    return speech_id


# ── MCP server ───────────────────────────────────────────────

mcp = FastMCP("mcp-pockettts")


@mcp.tool()
async def speak(text: str, voice: str = "male") -> str:
    """Speak text out loud using PocketTTS. Returns immediately with a speech ID. Audio streams to speakers in ~200ms."""
    word_count = len(text.split())
    speech_id = _enqueue_speech(text, voice, word_count)
    return f'Queued id={speech_id} [{voice}]: "{text}"'


@mcp.tool()
async def speech_status() -> str:
    """Check how much audio is queued. Returns instantly. Use this to decide whether to queue more speech, do browser actions, or wait."""
    pending = len(speech_queue)
    estimated_seconds = round(queued_word_count / 2.5)
    playing = drain_task is not None and not drain_task.done()
    status = "Playing now." if playing else "Silent."
    return f"Pending: {pending} items (~{estimated_seconds}s). {status}"


@mcp.tool()
async def await_speech(id: int | None = None) -> str:
    """Block until queued speech finishes playing. With no args, waits for ALL queued speech. With an id, waits for just that item (later items keep playing). Call at scene boundaries to sync audio with browser actions."""
    if id is not None:
        event = speech_events.get(id)
        if event is None:
            return f"Speech id={id} not found (already finished or never queued)."
        try:
            await asyncio.wait_for(event.wait(), timeout=120.0)
            return f"Speech id={id} finished."
        except asyncio.TimeoutError:
            return f"Timed out waiting for speech id={id}."

    # Wait for all queued speech
    try:
        deadline = 120.0
        while (speech_queue or (drain_task and not drain_task.done())) and deadline > 0:
            await asyncio.sleep(0.2)
            deadline -= 0.2
        return "All speech finished."
    except asyncio.TimeoutError:
        return "Timed out waiting for all speech."


@mcp.tool()
async def stop_recording() -> str:
    """Stop the screen recording. Waits for all queued audio to finish playing, then signals ffmpeg to finalize the MP4. Call this as your LAST action when the demo is complete."""
    # Drain playback queue
    deadline = 60.0
    while (speech_queue or (drain_task and not drain_task.done())) and deadline > 0:
        await asyncio.sleep(0.5)
        deadline -= 0.5

    # Extra buffer for final audio to reach PulseAudio sink
    await asyncio.sleep(2.0)

    try:
        Path("/workspace/stop-recording").write_text("")
        return "Audio drained and recording stopped. MP4 is being finalized."
    except Exception as exc:
        return f"Failed to stop recording: {exc}"


if __name__ == "__main__":
    mcp.run()
