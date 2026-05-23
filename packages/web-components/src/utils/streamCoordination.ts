/**
 * Pure helpers for the Coordination surface: classifying IPC streams by kind
 * and attributing them to the task that owns their subscribers.
 *
 * No React or DOM dependencies — safe to unit test in isolation.
 *
 * @module
 */

import type { Session, StreamData } from "../hooks/types.js";

/** Internal IPC plumbing prefixes (mirrors the server's RESERVED_PREFIXES). */
export const INTERNAL_STREAM_PREFIXES: readonly string[] = ["lifecycle:", "pipe:", "stdin:"];

/** Display kind of a stream, derived from its shape. */
export type StreamKind = "chatroom" | "pipe" | "channel";

/** Ownership classification of a stream, derived from its subscribers' sessions. */
export type StreamOwnership =
  | { kind: "task"; taskId: string }
  | { kind: "unattached" }
  | { kind: "external" };

/**
 * Classify a stream's kind:
 * - `chatroom` — self-echo streams (N-party rooms where senders see their own messages).
 * - `pipe` — internal point-to-point pipes (`pipe:` prefix).
 * - `channel` — any other named stream.
 */
export function streamKind(stream: StreamData): StreamKind {
  if (stream.selfEcho) {
    return "chatroom";
  }
  if (stream.name.startsWith("pipe:")) {
    return "pipe";
  }
  return "channel";
}

/** Returns true when a stream is internal IPC plumbing (reserved prefix). */
export function isInternalStream(stream: StreamData): boolean {
  return INTERNAL_STREAM_PREFIXES.some((prefix) => stream.name.startsWith(prefix));
}

/**
 * Attribute a stream to the task that owns it, by resolving its subscribers'
 * sessions:
 * - the first subscriber whose session has a `taskId` wins → `{ kind: "task" }`;
 * - else if any subscriber's session is known (but task-less) → `unattached`;
 * - else (no subscriber session resolvable — e.g. CLI/MCP-created) → `external`.
 */
export function attributeStream(stream: StreamData, sessions: readonly Session[]): StreamOwnership {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  let sawKnownSession = false;
  for (const sub of stream.subscribers) {
    const session = byId.get(sub.sessionId);
    if (session) {
      sawKnownSession = true;
      if (session.taskId) {
        return { kind: "task", taskId: session.taskId };
      }
    }
  }
  return sawKnownSession ? { kind: "unattached" } : { kind: "external" };
}

/** A group of streams sharing an owning task (or the unattached/external bucket). */
export interface StreamGroup {
  /** Owning task id, or `undefined` for the combined unattached/external bucket. */
  taskId?: string;
  /** Streams in this group, in their incoming order. */
  streams: StreamData[];
}

/**
 * Group streams by owning task, preserving first-seen order of tasks. Streams
 * that are unattached or external are collected into a single trailing bucket
 * with `taskId === undefined`.
 */
export function groupStreamsByTask(streams: readonly StreamData[], sessions: readonly Session[]): StreamGroup[] {
  const taskGroups = new Map<string, StreamData[]>();
  const orphans: StreamData[] = [];

  for (const stream of streams) {
    const ownership = attributeStream(stream, sessions);
    if (ownership.kind === "task") {
      const existing = taskGroups.get(ownership.taskId);
      if (existing) {
        existing.push(stream);
      } else {
        taskGroups.set(ownership.taskId, [stream]);
      }
    } else {
      orphans.push(stream);
    }
  }

  const groups: StreamGroup[] = Array.from(taskGroups, ([taskId, groupStreams]) => ({ taskId, streams: groupStreams }));
  if (orphans.length > 0) {
    groups.push({ taskId: undefined, streams: orphans });
  }
  return groups;
}
