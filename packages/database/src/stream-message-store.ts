import { and, desc, eq, lt, type SQL } from "drizzle-orm";
import db from "./db.js";
import { streamMessages, type StreamMessageRow } from "./schema.js";

/**
 * A stream message to persist — the durable observation log for IPC stream rooms
 * (RFC #1264 Phase 2). Separate lifecycle from the in-memory delivery buffer.
 */
export interface StreamMessageRecord {
  /** ULID — monotonic, chronologically-sortable transcript sequence key. */
  seq: string;
  /** The stream (room) this message belongs to. */
  streamId: string;
  /** Session id of the sender. */
  senderId: string;
  /** Message content. */
  content: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

/** Default rows returned by {@link queryStreamMessages} when no limit is given. */
const DEFAULT_STREAM_MESSAGE_LIMIT: number = 100;
/** Hard cap on rows returned by {@link queryStreamMessages}. */
const MAX_STREAM_MESSAGE_LIMIT: number = 1000;

/** Filters for {@link queryStreamMessages}. */
export interface StreamMessageQuery {
  /** The stream (room) to read. */
  streamId: string;
  /** Return only messages whose `seq` sorts before this value (exclusive) — page into older history. */
  beforeSeq?: string;
  /** Max rows to return (default {@link DEFAULT_STREAM_MESSAGE_LIMIT}, capped at {@link MAX_STREAM_MESSAGE_LIMIT}). */
  limit?: number;
}

/** Prepared statement for inserting stream messages (lazy-initialized). */
let insertStmt: ReturnType<typeof db.$client.prepare> | undefined;

/**
 * Persist a stream message to the `stream_messages` table — the durable
 * observation log for IPC stream rooms (RFC #1264 Phase 2). Synchronous; called
 * best-effort from `publish()` so a write failure never breaks message delivery.
 *
 * @param message - The sequenced stream message to persist.
 */
export function persistStreamMessage(message: StreamMessageRecord): void {
  if (!insertStmt) {
    insertStmt = db.$client.prepare(
      "INSERT INTO stream_messages (seq, stream_id, sender_id, content, timestamp) VALUES (?, ?, ?, ?, ?)",
    );
  }
  insertStmt.run([message.seq, message.streamId, message.senderId, message.content, message.timestamp]);
}

/**
 * Query a stream's persisted transcript, **most recent first** (ordered by `seq`
 * descending — `seq` is a monotonic ULID, so seq order is chronological). `beforeSeq`
 * pages into older history. The read side of the durable stream log (RFC #1264 Phase 2).
 *
 * @param query - Stream id, optional `beforeSeq` cursor, and limit.
 * @returns Matching rows, newest first.
 */
export function queryStreamMessages(query: StreamMessageQuery): StreamMessageRow[] {
  const conditions: SQL[] = [eq(streamMessages.streamId, query.streamId)];
  if (query.beforeSeq) {
    conditions.push(lt(streamMessages.seq, query.beforeSeq));
  }
  const limit: number = Math.min(
    query.limit && query.limit > 0 ? query.limit : DEFAULT_STREAM_MESSAGE_LIMIT,
    MAX_STREAM_MESSAGE_LIMIT,
  );
  return db
    .select()
    .from(streamMessages)
    .where(and(...conditions))
    .orderBy(desc(streamMessages.seq))
    .limit(limit)
    .all();
}
