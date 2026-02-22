#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile, spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const POCKETTTS_PORT = process.env.POCKETTTS_PORT || "8890";
const POCKETTTS_URL = process.env.POCKETTTS_URL || `http://localhost:${POCKETTTS_PORT}`;

// ── Playback queue ──────────────────────────────────────────
// Audio files queue up and play one at a time via ffplay.
// speak() returns immediately after synthesis — playback is async.
const playbackQueue = [];
let isPlaying = false;

async function enqueuePlayback(wavPath) {
  playbackQueue.push(wavPath);
  if (!isPlaying) {
    drainQueue();
  }
}

async function drainQueue() {
  isPlaying = true;
  while (playbackQueue.length > 0) {
    const wavPath = playbackQueue.shift();
    try {
      await new Promise((resolve, reject) => {
        execFile(
          "ffplay",
          ["-nodisp", "-autoexit", "-loglevel", "quiet", wavPath],
          { timeout: 120000 },
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    } catch (err) {
      // Log but don't crash — keep draining
      process.stderr.write(`[mcp-pockettts] Playback error: ${err.message}\n`);
    } finally {
      await unlink(wavPath).catch(() => {});
    }
  }
  isPlaying = false;
}

// ── PocketTTS server management ─────────────────────────────

/** Start pocket-tts serve as a child process if it's not already running. */
async function ensurePocketTTS() {
  try {
    const res = await fetch(`${POCKETTTS_URL}/health`);
    if (res.ok) return; // already running
  } catch {
    // not running — start it
  }

  const child = spawn("uvx", ["pocket-tts", "serve", "--port", POCKETTTS_PORT], {
    stdio: "ignore",
    detached: false,
    shell: true,
  });

  child.unref();

  // Wait for it to become healthy (up to 60s for model download on first run)
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`${POCKETTTS_URL}/health`);
      if (res.ok) return;
    } catch { /* keep waiting */ }
  }
  throw new Error("pocket-tts failed to start within 60s");
}

await ensurePocketTTS();

// ── MCP server ──────────────────────────────────────────────

const server = new McpServer({
  name: "mcp-pockettts",
  version: "0.2.0",
});

server.tool(
  "speak",
  "Speak text out loud using PocketTTS. Use this to communicate verbally with the user.",
  { text: z.string().describe("The text to speak aloud") },
  async ({ text }) => {
    try {
      // Synthesize audio (blocks until TTS server returns the WAV)
      const formData = new FormData();
      formData.append("text", text);

      const response = await fetch(`${POCKETTTS_URL}/tts`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        return { content: [{ type: "text", text: `TTS error: ${response.status} ${response.statusText}` }] };
      }

      // Save to temp WAV file
      const wavPath = join(tmpdir(), `tts-${randomUUID()}.wav`);
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(wavPath, buffer);

      // Queue for playback (non-blocking — returns immediately)
      enqueuePlayback(wavPath);

      const queued = playbackQueue.length;
      const status = queued > 0 ? ` (${queued} queued)` : "";
      return { content: [{ type: "text", text: `Spoke: "${text}"${status}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `TTS failed: ${err.message}` }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
