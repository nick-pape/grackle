import { and, asc, eq, gt, type SQL } from "drizzle-orm";
import db from "./db.js";
import { sessionActions, type SessionActionRow } from "./schema.js";

/**
 * A session action (one agent-conversation event) to persist — the durable,
 * server-sequenced session log (RFC #1264 / AHP HR1a #1276). This is the
 * "replay buffer" half of the AHP host model; the reducer/SessionState/snapshots
 * are HR1b (#1292). Coexists with the per-session JSONL log for now.
 */
export interface SessionActionRecord {
  /** ULID — monotonic server sequence (`serverSeq`), chronologically sortable. */
  seq: string;
  /** The session this action belongs to. */
  sessionId: string;
  /** Event type (e.g. "text", "tool_use", "status"). */
  type: string;
  /** Event content. */
  content: string;
  /** Optional raw JSON payload ("" when absent). */
  raw: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Tool call ID from the originating AgentEvent ("" when absent). Used by the AHP mapper for tool-call pairing during reconstruction. */
  toolCallId: string;
  /** Turn ID from the originating AgentEvent ("" when absent). Used by the AHP mapper for turn attribution during reconstruction. */
  turnId: string;
}

/** Default rows returned by {@link querySessionActions} when no limit is given. */
const DEFAULT_SESSION_ACTION_LIMIT: number = 500;
/** Hard cap on rows returned by {@link querySessionActions}. */
const MAX_SESSION_ACTION_LIMIT: number = 5000;

/** Filters for {@link querySessionActions}. */
export interface SessionActionQuery {
  /** The session to read. */
  sessionId: string;
  /** Return only actions whose `seq` sorts after this value (exclusive) — resume from a cursor. */
  fromSeq?: string;
  /** Max rows to return (default {@link DEFAULT_SESSION_ACTION_LIMIT}, capped at {@link MAX_SESSION_ACTION_LIMIT}). */
  limit?: number;
}

/** Prepared statement for inserting session actions (lazy-initialized). */
let insertStmt: ReturnType<typeof db.$client.prepare> | undefined;

/**
 * Persist a session action to the `session_actions` table — the durable,
 * server-sequenced session log (RFC #1264 / AHP HR1a). Synchronous; called
 * best-effort from `processEventStream` so a write failure never breaks event
 * processing or delivery.
 *
 * @param action - The sequenced session action to persist.
 */
export function persistSessionAction(action: SessionActionRecord): void {
  if (!insertStmt) {
    insertStmt = db.$client.prepare(
      "INSERT INTO session_actions (seq, session_id, type, content, raw, timestamp, tool_call_id, turn_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
  }
  insertStmt.run([
    action.seq,
    action.sessionId,
    action.type,
    action.content,
    action.raw,
    action.timestamp,
    action.toolCallId,
    action.turnId,
  ]);
}

/**
 * Query a session's durable action log, **oldest first** (ascending `seq`, i.e.
 * replay/catch-up order — `seq` is a monotonic ULID, so it's chronological).
 * `fromSeq` resumes after a cursor. The read side of the durable session log.
 *
 * @param query - Session id, optional `fromSeq` cursor, and limit.
 * @returns Matching rows, oldest first.
 */
export function querySessionActions(query: SessionActionQuery): SessionActionRow[] {
  const conditions: SQL[] = [eq(sessionActions.sessionId, query.sessionId)];
  if (query.fromSeq) {
    conditions.push(gt(sessionActions.seq, query.fromSeq));
  }
  const limit: number = Math.min(
    query.limit && query.limit > 0 ? query.limit : DEFAULT_SESSION_ACTION_LIMIT,
    MAX_SESSION_ACTION_LIMIT,
  );
  return db
    .select()
    .from(sessionActions)
    .where(and(...conditions))
    .orderBy(asc(sessionActions.seq))
    .limit(limit)
    .all();
}
