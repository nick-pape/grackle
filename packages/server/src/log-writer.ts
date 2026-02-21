import { createWriteStream, mkdirSync, readFileSync, existsSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import type { grackle } from "@grackle/common";

const openStreams = new Map<string, WriteStream>();

export function initLog(logPath: string): void {
  mkdirSync(logPath, { recursive: true });
  const streamPath = join(logPath, "stream.jsonl");
  const ws = createWriteStream(streamPath, { flags: "a" });
  openStreams.set(logPath, ws);
}

export function writeEvent(logPath: string, event: grackle.SessionEvent): void {
  const ws = openStreams.get(logPath);
  if (!ws) return;

  const line = JSON.stringify({
    session_id: event.sessionId,
    type: event.type,
    timestamp: event.timestamp,
    content: event.content,
    raw: event.raw || undefined,
  });

  ws.write(line + "\n");
}

export function endSession(logPath: string): void {
  const ws = openStreams.get(logPath);
  if (ws) {
    ws.end();
    openStreams.delete(logPath);
  }
}

export interface LogEntry {
  session_id: string;
  type: string;
  timestamp: string;
  content: string;
  raw?: string;
}

export function readLog(logPath: string): LogEntry[] {
  const streamPath = join(logPath, "stream.jsonl");
  if (!existsSync(streamPath)) return [];

  const content = readFileSync(streamPath, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as LogEntry);
}
