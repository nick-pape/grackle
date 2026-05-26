/**
 * Session snapshot store (AHP HR1b / RFC #1292).
 *
 * Owns the persist and query operations for the `session_snapshots` table.
 * Snapshots are serialized key fields from `SessionState`, used as
 * reconstruction checkpoints so delta actions need only cover the gap
 * between the last snapshot and the present.
 */

import { and, asc, desc, eq, gt, lt, type SQL } from "drizzle-orm";
import db from "./db.js";
import { sessionSnapshots, type SessionSnapshotRow } from "./schema.js";

/**
 * A snapshot row to persist — the key fields of a `SessionState`
 * serialized to JSON, anchored to the ULID of the last action
 * included in the snapshot.
 */
export interface SnapshotRecord {
  /** ULID of the last session action included in this snapshot. */
  seq: string;
  /** The session this snapshot belongs to. */
  sessionId: string;
  /** ISO 8601 timestamp of the snapshot capture. */
  snapshotAt: string;
  /** JSON-serialized SessionState key fields. */
  state: string;
}

/** Default rows returned by {@link querySnapshot} when no limit is given. */
const DEFAULT_SNAPSHOT_LIMIT: number = 10;

/**
 * Persist a snapshot to the `session_snapshots` table. Best-effort:
 * a persistence failure is logged but never interrupts event processing.
 *
 * @param snapshot - The snapshot record to persist.
 */
export function persistSnapshot(snapshot: SnapshotRecord): void {
  const stmt = db.$client.prepare(
    "INSERT INTO session_snapshots (seq, session_id, snapshot_at, state) VALUES (?, ?, ?, ?)",
  );
  stmt.run([snapshot.seq, snapshot.sessionId, snapshot.snapshotAt, snapshot.state]);
}

/**
 * Query the latest snapshot for a session, ordered by `seq` descending.
 * Returns the most recent checkpoint so delta actions can be replayed
 * from that point forward.
 *
 * @param sessionId - The session to query.
 * @param limit - Max rows to return (default {@link DEFAULT_SNAPSHOT_LIMIT}).
 * @returns Matching rows, newest first.
 */
export function querySnapshot(
  sessionId: string,
  limit: number = DEFAULT_SNAPSHOT_LIMIT,
): SessionSnapshotRow[] {
  return db
    .select()
    .from(sessionSnapshots)
    .where(eq(sessionSnapshots.sessionId, sessionId))
    .orderBy(desc(sessionSnapshots.seq))
    .limit(limit)
    .all();
}

/**
 * Query all snapshots for a session with optional fromSeq cursor.
 * Returns rows ordered newest-first for replay ordering.
 *
 * @param sessionId - The session to query.
 * @param fromSeq - Return only snapshots whose `seq` sorts before this value (exclusive) — older checkpoints.
 * @returns Matching rows, newest first.
 */
export function querySnapshots(
  sessionId: string,
  fromSeq?: string,
): SessionSnapshotRow[] {
  const conditions: SQL[] = [eq(sessionSnapshots.sessionId, sessionId)];
  if (fromSeq) {
    // We want older snapshots, so seq must be less than fromSeq
    conditions.push(lt(sessionSnapshots.seq, fromSeq));
  }
  return db
    .select()
    .from(sessionSnapshots)
    .where(and(...conditions))
    .orderBy(desc(sessionSnapshots.seq))
    .all();
}
