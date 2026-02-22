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
const VOICE_SERVER_PORT = process.env.VOICE_SERVER_PORT || "8891";

// ── Voice URL mapping ───────────────────────────────────────
// Maps short voice names to HTTP URLs serving pre-exported safetensors.
// PocketTTS voice_url only accepts http://, https://, or hf:// — not local paths.
const VOICE_MAP = {
  snoop: `http://localhost:${VOICE_SERVER_PORT}/snoop.safetensors`,
  cumberbatch: `http://localhost:${VOICE_SERVER_PORT}/cumberbatch.safetensors`,
};

// ── Synthesis-wait, playback-async architecture ─────────────
// v0.5.1: speak() awaits full synthesis (downloads entire WAV),
// then enqueues for background playback via ffplay. Returns to
// agent after synthesis completes — even if audio is still playing.
// This ties agent pacing to synthesis speed naturally.

// Per-voice playback speed (atempo filter). Lower = slower.
const VOICE_TEMPO = {
  snoop: 0.89,
  cumberbatch: 0.98,
  default: 0.95,
};

const playbackQueue = [];
let playbackRunning = false;

/** Enqueue a WAV buffer for background playback. */
function enqueuePlayback(wavBuffer, voice) {
  playbackQueue.push({ buffer: wavBuffer, voice });
  if (!playbackRunning) {
    drainPlayback();
  }
}

/** Process playback queue: write to temp file, play with ffplay, clean up. */
async function drainPlayback() {
  playbackRunning = true;
  while (playbackQueue.length > 0) {
    const { buffer, voice } = playbackQueue.shift();
    const tempo = VOICE_TEMPO[voice] || VOICE_TEMPO.default;
    const wavPath = join(tmpdir(), `tts-${randomUUID()}.wav`);
    try {
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
  version: "0.5.0",
});

server.tool(
  "speak",
  "Speak text out loud using PocketTTS. Use this to communicate verbally with the user.",
  {
    text: z.string().describe("The text to speak aloud"),
    voice: z
      .enum(["snoop", "cumberbatch"])
      .optional()
      .describe("Voice clone to use. Omit for default voice."),
  },
  async ({ text, voice }) => {
    const formData = new FormData();
    // Prepend "..." to avoid garbled start (known PocketTTS issue with first syllable)
    formData.append("text", `... ${text}`);
    if (voice && VOICE_MAP[voice]) {
      formData.append("voice_url", VOICE_MAP[voice]);
    }

    try {
      const response = await fetch(`${POCKETTTS_URL}/tts`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        return {
          content: [
            {
              type: "text",
              text: `TTS error ${response.status}: ${errText}`,
            },
          ],
        };
      }

      // Await full synthesis (download entire WAV)
      const buffer = Buffer.from(await response.arrayBuffer());
      // Enqueue for background playback (with voice for per-voice tempo)
      enqueuePlayback(buffer, voice);
    } catch (err) {
      return {
        content: [
          { type: "text", text: `TTS fetch error: ${err.message}` },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Speaking [${voice || "default"}]: "${text}"`,
        },
      ],
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
    while ((playbackQueue.length > 0 || playbackRunning) && Date.now() - drainStart < 60_000) {
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
