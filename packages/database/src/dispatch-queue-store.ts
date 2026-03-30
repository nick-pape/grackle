/**
 * Dispatch queue store — tracks tasks that have been requested to start but are
 * waiting for concurrency capacity on their target environment.
 *
 * Entries are ephemeral: inserted by `startTask()` when at capacity, removed by
 * the dispatch reconciliation phase when the task is spawned (or if the task is
 * deleted/completed).
 */

import db from "./db.js";
import { dispatchQueue, type DispatchQueueRow } from "./schema.js";
import { eq, asc } from "drizzle-orm";

export type { DispatchQueueRow };

/** Fields accepted when enqueuing a dispatch request. */
export interface EnqueueEntry {
  /** Unique ID for this queue entry. */
  id: string;
  /** The task to be dispatched. */
  taskId: string;
  /** Target environment for the task. */
  environmentId?: string;
  /** Persona to use when spawning. */
  personaId?: string;
  /** Optional notes/instructions for the session. */
  notes?: string;
  /** Pipe mode (sync/async/detach/""). */
  pipe?: string;
  /** Parent session ID for IPC. */
  parentSessionId?: string;
}

/**
 * Insert a task into the dispatch queue.
 * If the task is already enqueued (same taskId), this is a no-op.
 */
export function enqueue(entry: EnqueueEntry): void {
  db.insert(dispatchQueue)
    .values({
      id: entry.id,
      taskId: entry.taskId,
      environmentId: entry.environmentId ?? "",
      personaId: entry.personaId ?? "",
      notes: entry.notes ?? "",
      pipe: entry.pipe ?? "",
      parentSessionId: entry.parentSessionId ?? "",
      enqueuedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();
}

/** Remove a task from the dispatch queue by taskId. */
export function dequeue(taskId: string): void {
  db.delete(dispatchQueue).where(eq(dispatchQueue.taskId, taskId)).run();
}

/** Check if a task is in the dispatch queue. */
export function getByTaskId(taskId: string): DispatchQueueRow | undefined {
  return db.select().from(dispatchQueue).where(eq(dispatchQueue.taskId, taskId)).get();
}

/** List all pending dispatch entries in FIFO order (oldest first, deterministic). */
export function listPending(): DispatchQueueRow[] {
  return db.select().from(dispatchQueue).orderBy(asc(dispatchQueue.enqueuedAt), asc(dispatchQueue.id)).all();
}

/** List pending dispatch entries for a specific environment in FIFO order. */
export function listPendingForEnvironment(environmentId: string): DispatchQueueRow[] {
  return db.select()
    .from(dispatchQueue)
    .where(eq(dispatchQueue.environmentId, environmentId))
    .orderBy(asc(dispatchQueue.enqueuedAt), asc(dispatchQueue.id))
    .all();
}
