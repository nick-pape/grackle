/**
 * Session transcript chunker that splits JSONL session logs by conversation turn.
 *
 * Accepts the raw JSONL content of a session's `stream.jsonl` file and groups
 * events into semantic turns (user input → agent response) for embedding.
 *
 * @module
 */

import type { Chunk, Chunker } from "./chunker.js";

/** Deserialized shape of a single line in a session's `stream.jsonl` log. */
interface LogEntry {
  /** Session ID. */
  session_id: string;
  /** Event type (text, tool_use, tool_result, user_input, error, system, finding, etc.). */
  type: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Text content of the event. */
  content: string;
  /** Optional raw JSON payload. */
  raw?: string;
}

/** Options for the session transcript chunker. */
export interface TranscriptChunkerOptions {
  /** Max characters per chunk before splitting (default 4000). */
  maxChunkSize?: number;
  /** Event types to skip (default: status, signal, usage, system). */
  skipEventTypes?: string[];
}

/** Default event types that are excluded from chunks. */
const DEFAULT_SKIP_TYPES: string[] = ["status", "signal", "usage", "system"];

/** Default maximum characters per chunk. */
const DEFAULT_MAX_CHUNK_SIZE: number = 4000;

/** Labels used when rendering events into readable text. */
const EVENT_LABELS: Record<string, string> = {
  user_input: "User",
  text: "Assistant",
  tool_use: "Tool",
  tool_result: "Result",
  error: "Error",
  finding: "Finding",
  subtask_create: "Subtask",
};

/**
 * Create a chunker that splits JSONL session transcripts by conversation turn.
 *
 * A "turn" starts at a `user_input` event and includes all subsequent events
 * until the next `user_input`. Events before the first `user_input` are grouped
 * into an initial turn (turn 0). Turns exceeding {@link TranscriptChunkerOptions.maxChunkSize}
 * are split into sub-chunks.
 *
 * @param options - Optional chunker configuration.
 * @returns A {@link Chunker} for session transcript JSONL content.
 */
export function createTranscriptChunker(options?: TranscriptChunkerOptions): Chunker {
  const maxChunkSize: number = options?.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;
  const skipTypes: Set<string> = new Set(options?.skipEventTypes ?? DEFAULT_SKIP_TYPES);

  return {
    chunk(content: string, metadata?: Record<string, unknown>): Chunk[] {
      const entries: LogEntry[] = parseJsonl(content);

      if (entries.length === 0) {
        return [];
      }

      // Group on all entries first so user_input boundaries are preserved
      // even if user_input is in skipTypes. Filter when rendering.
      const turns: LogEntry[][] = groupByTurn(entries);
      const chunks: Chunk[] = [];

      for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
        const turnEntries: LogEntry[] = turns[turnIndex];
        const visible: LogEntry[] = turnEntries.filter((e) => !skipTypes.has(e.type));

        if (visible.length === 0) {
          continue;
        }

        const text: string = renderTurn(visible);
        const timestamps: string[] = visible.map((e) => e.timestamp);
        const eventTypes: string[] = [...new Set(visible.map((e) => e.type))];

        const turnMetadata: Record<string, unknown> = {
          ...metadata,
          turnIndex,
          timestampStart: timestamps[0],
          timestampEnd: timestamps[timestamps.length - 1],
          eventTypes,
        };

        if (text.length <= maxChunkSize) {
          chunks.push({ text, index: chunks.length, metadata: turnMetadata });
        } else {
          const subChunks: string[] = splitText(text, maxChunkSize);
          for (const subChunk of subChunks) {
            chunks.push({ text: subChunk, index: chunks.length, metadata: turnMetadata });
          }
        }
      }

      return chunks;
    },
  };
}

/** Parse a JSONL string into an array of log entries, skipping malformed lines. */
function parseJsonl(content: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed: string = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      entries.push(JSON.parse(trimmed) as LogEntry);
    } catch {
      // Skip malformed lines
    }
  }
  return entries;
}

/** Group log entries into turns, splitting on `user_input` events. */
function groupByTurn(entries: LogEntry[]): LogEntry[][] {
  const turns: LogEntry[][] = [];
  let current: LogEntry[] = [];

  for (const entry of entries) {
    if (entry.type === "user_input" && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(entry);
  }

  if (current.length > 0) {
    turns.push(current);
  }

  return turns;
}

/** Render a turn's events into human-readable text. */
function renderTurn(entries: LogEntry[]): string {
  return entries
    .map((e) => {
      const label: string = EVENT_LABELS[e.type] ?? e.type;
      return `${label}: ${e.content}`;
    })
    .join("\n");
}

/**
 * Split text into sub-chunks at line boundaries, targeting at most maxSize characters.
 * A single line longer than maxSize will be emitted as-is (not split mid-line).
 */
function splitText(text: string, maxSize: number): string[] {
  const lines: string[] = text.split("\n");
  const subChunks: string[] = [];
  let current: string = "";

  for (const line of lines) {
    const candidate: string = current ? current + "\n" + line : line;
    if (candidate.length > maxSize && current) {
      subChunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current) {
    subChunks.push(current);
  }

  return subChunks;
}
