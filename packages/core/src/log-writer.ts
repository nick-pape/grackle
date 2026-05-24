import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  existsSync,
  statSync,
  openSync,
  readSync,
  closeSync,
  type WriteStream,
} from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { type grackle, eventTypeToString } from "@grackle-ai/common";
import { logger } from "./logger.js";

const openStreams: Map<string, WriteStream> = new Map<string, WriteStream>();

/** Initialize a JSONL log stream for a session at the given directory path. */
export function initLog(logPath: string): void {
  mkdirSync(logPath, { recursive: true });
  const streamPath = join(logPath, "stream.jsonl");
  const ws = createWriteStream(streamPath, { flags: "a" });
  openStreams.set(logPath, ws);
}

/**
 * Ensure the JSONL log stream for the given path is open.
 * If `initLog` has already been called for this path this is a no-op;
 * otherwise it opens a new append stream.  Use this before `writeEvent`
 * when the caller cannot guarantee that `initLog` has already been called
 * (e.g. signal delivery to a PENDING session).
 */
export function ensureLogInitialized(logPath: string): void {
  if (!openStreams.has(logPath)) {
    initLog(logPath);
  }
}

/** Append a session event as a JSON line to the session's log file. */
export async function writeEvent(logPath: string, event: grackle.SessionEvent): Promise<void> {
  const ws = openStreams.get(logPath);
  if (!ws) {
    return;
  }

  const line = JSON.stringify({
    session_id: event.sessionId,
    type: eventTypeToString(event.type),
    timestamp: event.timestamp,
    content: event.content,
    raw: event.raw || undefined,
  });

  const ok = ws.write(line + "\n");
  if (!ok) {
    if (ws.destroyed || ws.writableEnded) {
      return;
    }
    logger.warn({ logPath }, "Log writer backpressure — waiting for drain");
    // Race drain against error/close to avoid hanging indefinitely
    await Promise.race([
      once(ws, "drain"),
      once(ws, "error"),
      once(ws, "close"),
    ]);
  }
}

/** Close the write stream for a session log. */
export function endSession(logPath: string): void {
  const ws = openStreams.get(logPath);
  if (ws) {
    ws.end();
    openStreams.delete(logPath);
  }
}

/** Deserialized shape of a single line in a session's `stream.jsonl` log. */
export interface LogEntry {
  session_id: string;
  type: string;
  timestamp: string;
  content: string;
  raw?: string;
}

/** Number of bytes to read from the tail of a log file when searching for the last text entry. */
const LOG_TAIL_BYTES: number = 65536; // 64 KB

/**
 * Read the last "text" entry from a session's JSONL log file without parsing the whole file.
 * Reads only the tail of the file (up to LOG_TAIL_BYTES) to limit the amount of synchronous
 * work and reduce event-loop blocking time for large sessions.
 */
export function readLastTextEntry(logPath: string): LogEntry | undefined {
  const streamPath = join(logPath, "stream.jsonl");
  if (!existsSync(streamPath)) {
    return undefined;
  }

  const stats = statSync(streamPath);
  if (stats.size === 0) {
    return undefined;
  }

  const readSize = Math.min(stats.size, LOG_TAIL_BYTES);
  const buffer = Buffer.alloc(readSize);
  const fd = openSync(streamPath, "r");
  let bytesRead = 0;
  try {
    bytesRead = readSync(fd, buffer, 0, readSize, stats.size - readSize);
  } finally {
    closeSync(fd);
  }

  if (bytesRead <= 0) {
    return undefined;
  }

  const lines = buffer.subarray(0, bytesRead).toString("utf-8").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    try {
      const entry = JSON.parse(line) as LogEntry;
      if (entry.type === "text") {
        return entry;
      }
    } catch {
      // Skip malformed lines (the first line may be partial when reading from a byte offset)
    }
  }
  return undefined;
}

/** Read and parse all log entries from a session's JSONL log file. */
export function readLog(logPath: string): LogEntry[] {
  const streamPath = join(logPath, "stream.jsonl");
  if (!existsSync(streamPath)) return [];

  const content = readFileSync(streamPath, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as LogEntry);
}

/** Result of an incremental log read: new raw JSONL + the advanced byte offset. */
export interface IncrementalLogRead {
  /**
   * Raw JSONL of the complete lines appended since the given byte offset
   * (a trailing partial line, if any, is not included).
   */
  content: string;
  /** Byte offset at the last complete-line boundary; pass on the next call. */
  nextOffset: number;
}

/**
 * Max bytes {@link readLogFrom} reads per call. Bounds memory + blocking time
 * even when a large tail has accumulated (e.g. first pass on a big log): each
 * call advances `nextOffset` by at most this much, so callers make incremental
 * progress across successive passes rather than reading the whole tail at once.
 */
const MAX_INCREMENTAL_READ_BYTES: number = 1_048_576; // 1 MiB

/**
 * Read only the bytes appended to a session's JSONL log after `byteOffset`.
 *
 * O(new bytes): uses `statSync` + a positioned `readSync` from the offset
 * rather than reading/parsing the whole file. Stops at the last complete line
 * so a concurrently-appending writer never yields a partial JSON line; the
 * returned `nextOffset` should be persisted and passed on the next call.
 */
export function readLogFrom(logPath: string, byteOffset: number): IncrementalLogRead {
  const streamPath = join(logPath, "stream.jsonl");
  if (!existsSync(streamPath)) {
    return { content: "", nextOffset: byteOffset };
  }

  const size = statSync(streamPath).size;
  // Reset to 0 if the file shrank (truncated/rewritten) so we re-read from start.
  const start = size < byteOffset ? 0 : byteOffset;
  if (size <= start) {
    return { content: "", nextOffset: start };
  }

  // Cap the read so a large accumulated tail is processed over several passes.
  const length = Math.min(size - start, MAX_INCREMENTAL_READ_BYTES);
  const buffer = Buffer.allocUnsafe(length);
  const fd = openSync(streamPath, "r");
  let bytesRead: number;
  try {
    bytesRead = readSync(fd, buffer, 0, length, start);
  } finally {
    closeSync(fd);
  }

  const text = buffer.toString("utf-8", 0, bytesRead);
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline === -1) {
    // No complete line within this window — either a partial append, or (rare) a
    // single line longer than the cap. Consume nothing so we never emit a
    // partial JSON line; the cursor stays put.
    return { content: "", nextOffset: start };
  }

  const consumed = text.slice(0, lastNewline + 1);
  return {
    content: text.slice(0, lastNewline),
    nextOffset: start + Buffer.byteLength(consumed, "utf-8"),
  };
}
