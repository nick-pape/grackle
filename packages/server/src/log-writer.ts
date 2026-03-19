import { createWriteStream, mkdirSync, readFileSync, existsSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { type grackle, eventTypeToString } from "@grackle-ai/common";

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
export function writeEvent(logPath: string, event: grackle.SessionEvent): void {
  const ws = openStreams.get(logPath);
  if (!ws) return;

  const line = JSON.stringify({
    session_id: event.sessionId,
    type: eventTypeToString(event.type),
    timestamp: event.timestamp,
    content: event.content,
    raw: event.raw || undefined,
  });

  ws.write(line + "\n");
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
