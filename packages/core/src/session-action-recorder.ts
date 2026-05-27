/**
 * Durable session-action recorder (AHP HR1a / RFC #1264).
 *
 * Owns the single, process-wide monotonic `serverSeq` generator and the
 * best-effort write into the `session_actions` log. Every site that publishes a
 * `SessionEvent` for live delivery (the PowerLine event stream, injected
 * system/prompt, injected input/signals, and widget renders) also calls
 * {@link recordSessionAction} so the durable log is an exhaustive, ordered
 * replay buffer for the session — the foundation for seq-based resume (HR8).
 *
 * Centralizing the generator here guarantees a *single* monotonic sequence
 * across all those sources; if each publisher minted its own ULID factory,
 * events emitted in the same millisecond from different sources could not be
 * totally ordered.
 */

import type { grackle } from "@grackle-ai/common";
import { eventTypeToString } from "@grackle-ai/common";
import { monotonicFactory } from "ulid";
import { persistSessionAction } from "@grackle-ai/database";
import { logger } from "./logger.js";

/**
 * Monotonic ULID generator for the durable session-action log's `serverSeq`.
 * Strictly increasing even when multiple events arrive within the same
 * millisecond, so `seq` always reflects emission order under bursty traffic.
 */
const nextServerSeq: () => string = monotonicFactory();

/**
 * Append a session event to the durable, server-sequenced action log
 * (`session_actions`), assigning the next monotonic `serverSeq`. Best-effort:
 * a persistence failure is logged but never interrupts event processing or live
 * delivery. The JSONL log + stream-hub publish remain the primary live paths.
 *
 * @param event - The session event to record.
 * @returns The monotonic ULID assigned to this action, or `undefined` on failure.
 */
export function recordSessionAction(event: grackle.SessionEvent): string | undefined {
  const seq = nextServerSeq();
  try {
    persistSessionAction({
      seq,
      sessionId: event.sessionId,
      type: eventTypeToString(event.type),
      content: event.content,
      raw: event.raw,
      timestamp: event.timestamp,
    });
    return seq;
  } catch (err) {
    logger.error({ err, sessionId: event.sessionId }, "Failed to persist session action");
    return undefined;
  }
}
