#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const POCKETTTS_URL = process.env.POCKETTTS_URL || "http://localhost:8890";

// ── Voice mapping ───────────────────────────────────────────
// Maps short voice names to PocketTTS built-in voice names.
const VOICE_MAP = {
  male: "marius",
  female: "alba",
};

// ── Fire-and-forget synthesis, ordered playback ──────────────
// v0.6.0: speak() returns immediately — synthesis runs in the background.
// A speechQueue holds { promise, voice, wordCount } entries in order. drainPlayback()
// awaits each promise then plays, so playback order matches enqueue order
// even though synthesis may complete out of order. speech_status() returns
// queue depth and estimated seconds for self-pacing. The agent calls
// await_speech() at scene boundaries to sync audio with browser actions.

// Per-voice text prefix to avoid garbled first syllable (PocketTTS known issue).
const VOICE_PREFIX = {
  male: "... ",
  female: "",
  default: "",
};

// Per-voice playback speed (atempo filter). Lower = slower.
// Only atempo is applied at playback — rich filter chains cause ffplay to exit early.
const VOICE_TEMPO = {
  male: 0.90,
  female: 1.00,
  default: 0.95,
};

const speechQueue = [];
let queuedWordCount = 0;
let playbackRunning = false;

/** Enqueue a synthesis promise for ordered background playback. */
function enqueueSpeech(synthesisPromise, voice, wordCount) {
  speechQueue.push({ promise: synthesisPromise, voice, wordCount });
  queuedWordCount += wordCount;
  if (!playbackRunning) {
    drainPlayback();
  }
}

/** Synthesize text to a WAV buffer via PocketTTS. Returns Promise<Buffer>. */
function synthesize(text, voice) {
  const formData = new FormData();
  const prefix = VOICE_PREFIX[voice] || VOICE_PREFIX.default;
  formData.append("text", `${prefix}${text}`);
  if (voice && VOICE_MAP[voice]) {
    formData.append("voice", VOICE_MAP[voice]);
  }
  return fetch(`${POCKETTTS_URL}/tts`, { method: "POST", body: formData })
    .then(async (response) => {
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`TTS error ${response.status}: ${errText}`);
      }
      return Buffer.from(await response.arrayBuffer());
    });
}

/** Process speech queue: await synthesis, write to temp file, play with ffplay, clean up. */
async function drainPlayback() {
  playbackRunning = true;
  while (speechQueue.length > 0) {
    const { promise, voice, wordCount } = speechQueue.shift();
    queuedWordCount -= wordCount;
    const tempo = VOICE_TEMPO[voice] || VOICE_TEMPO.default;
    const wavPath = join(tmpdir(), `tts-${randomUUID()}.wav`);
    try {
      const buffer = await promise;
      await writeFile(wavPath, buffer);
      await new Promise((resolve, reject) => {
        execFile(
          "ffplay",
          ["-nodisp", "-autoexit", "-loglevel", "quiet", "-af", `atempo=${tempo}`, wavPath],
          { timeout: 120_000 },
          (err) => (err ? reject(err) : resolve()),
        );
      });
    } catch (err) {
      process.stderr.write(`[mcp-pockettts] Playback error: ${err.message}\n`);
    } finally {
      await unlink(wavPath).catch(() => {});
    }
  }
  playbackRunning = false;
}

// ── PocketTTS server management ─────────────────────────────

/** Start pocket-tts serve as a child process if it's not already running. */
async function ensurePocketTTS() {
  try {
    const res = await fetch(`${POCKETTTS_URL}/health`);
    if (res.ok) return;
  } catch {
    // not running — will retry below
  }

  // Wait for it to become healthy (started by entrypoint, may need warmup time)
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`${POCKETTTS_URL}/health`);
      if (res.ok) return;
    } catch {
      /* keep waiting */
    }
  }
  throw new Error("pocket-tts failed to become healthy within 60s");
}

await ensurePocketTTS();

// ── MCP server ──────────────────────────────────────────────

const server = new McpServer({
  name: "mcp-pockettts",
  version: "0.6.0",
});

server.tool(
  "speak",
  "Speak text out loud using PocketTTS. Use this to communicate verbally with the user.",
  {
    text: z.string().describe("The text to speak aloud"),
    voice: z
      .enum(["male", "female"])
      .optional()
      .describe("Voice to use. Omit for default voice."),
  },
  async ({ text, voice }) => {
    const wordCount = text.split(/\s+/).length;
    const promise = synthesize(text, voice);
    enqueueSpeech(promise, voice, wordCount);
    return {
      content: [{ type: "text", text: `Queued [${voice || "default"}]: "${text}"` }],
    };
  },
);

server.tool(
  "speech_status",
  "Check how much audio is queued. Returns instantly. Use this to decide whether to queue more speech, do browser actions, or wait.",
  {},
  async () => {
    const pending = speechQueue.length;
    const estimatedSeconds = Math.round(queuedWordCount / 2.5);
    const playing = playbackRunning;
    return {
      content: [{
        type: "text",
        text: `Pending: ${pending} items (~${estimatedSeconds}s). ${playing ? "Playing now." : "Silent."}`,
      }],
    };
  },
);

server.tool(
  "await_speech",
  "Block until all queued speech has finished synthesizing and playing. Call this at scene boundaries to sync audio with browser actions.",
  {},
  async () => {
    const start = Date.now();
    while ((speechQueue.length > 0 || playbackRunning) && Date.now() - start < 120_000) {
      await new Promise((r) => setTimeout(r, 200));
    }
    return {
      content: [{ type: "text", text: "All speech finished." }],
    };
  },
);

server.tool(
  "stop_recording",
  "Stop the screen recording. Waits for all queued audio to finish playing, then signals ffmpeg to finalize the MP4. Call this as your LAST action when the demo is complete.",
  {},
  async () => {
    // Wait for playback queue to drain so all audio is captured in the recording
    const drainStart = Date.now();
    while ((speechQueue.length > 0 || playbackRunning) && Date.now() - drainStart < 60_000) {
      await new Promise((r) => setTimeout(r, 500));
    }

    // Extra buffer for final audio to reach PulseAudio sink
    await new Promise((r) => setTimeout(r, 2000));

    try {
      await writeFile("/workspace/stop-recording", "");
      return {
        content: [{ type: "text", text: "Audio drained and recording stopped. MP4 is being finalized." }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Failed to stop recording: ${err.message}` }],
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
