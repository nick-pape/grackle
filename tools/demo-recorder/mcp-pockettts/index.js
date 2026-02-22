#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "node:child_process";

const POCKETTTS_PORT = process.env.POCKETTTS_PORT || "8890";
const POCKETTTS_URL = process.env.POCKETTTS_URL || `http://localhost:${POCKETTTS_PORT}`;

// ── Streaming speech pipeline ───────────────────────────────
// v0.4.0: Fully streaming. Synthesis chunks pipe directly to
// ffplay stdin — first audio plays in ~200ms, not after full
// synthesis completes. Queue ensures sequential playback.
// speak() returns INSTANTLY in all cases.

const speechQueue = [];   // Queue of { text, id }
let pipelineRunning = false;
let speechCounter = 0;

/** Add text to the speech pipeline. Returns immediately. */
function enqueueSpeech(text) {
  const id = ++speechCounter;
  speechQueue.push({ text, id });
  if (!pipelineRunning) {
    drainSpeechPipeline();
  }
  return id;
}

/** Process speech queue: stream synthesis directly to ffplay, one at a time. */
async function drainSpeechPipeline() {
  pipelineRunning = true;
  while (speechQueue.length > 0) {
    const { text, id } = speechQueue.shift();
    try {
      // Start synthesis (PocketTTS returns Transfer-Encoding: chunked WAV)
      const formData = new FormData();
      formData.append("text", text);
      const response = await fetch(`${POCKETTTS_URL}/tts`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        process.stderr.write(`[mcp-pockettts] Synthesis error for #${id}: ${response.status}\n`);
        continue;
      }

      // Pipe streaming response directly to ffplay stdin
      const ffplay = spawn("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", "-i", "pipe:0"], {
        stdio: ["pipe", "ignore", "ignore"],
      });

      const reader = response.body.getReader();
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (result.value) {
          // Write chunk to ffplay stdin as it arrives from synthesis
          if (!ffplay.stdin.destroyed) {
            ffplay.stdin.write(result.value);
          }
        }
      }
      ffplay.stdin.end();

      // Wait for ffplay to finish playing the audio
      await new Promise((resolve) => {
        ffplay.on("close", resolve);
        ffplay.on("error", resolve);
      });
    } catch (err) {
      process.stderr.write(`[mcp-pockettts] Pipeline error for #${id}: ${err.message}\n`);
    }
  }
  pipelineRunning = false;
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
  version: "0.4.0",
});

server.tool(
  "speak",
  "Speak text out loud using PocketTTS. Use this to communicate verbally with the user.",
  { text: z.string().describe("The text to speak aloud") },
  async ({ text }) => {
    const id = enqueueSpeech(text);
    const pending = speechQueue.length;
    const status = pending > 0 ? ` (${pending} queued ahead)` : "";
    return { content: [{ type: "text", text: `Queued speech #${id}: "${text}"${status}` }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
