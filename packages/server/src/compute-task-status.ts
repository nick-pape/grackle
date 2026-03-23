import type { SessionRow } from "@grackle-ai/database";
import { SESSION_STATUS, TASK_STATUS } from "@grackle-ai/common";

/** Result of computing a task's effective status from its session history. */
export interface TaskStatusResult {
  /** The computed effective status string (e.g. "working", "paused", "not_started"). */
  status: string;
  /** The ID of the most recent session (by startedAt), or empty string if none. */
  latestSessionId: string;
}

/** Session statuses that indicate the session is actively running. */
const ACTIVE_SESSION_STATUSES: ReadonlySet<string> = new Set([
  SESSION_STATUS.PENDING,
  SESSION_STATUS.RUNNING,
  SESSION_STATUS.IDLE,
]);

/**
 * Compute the effective task status from the stored DB status and the task's
 * session history. Pure function — no DB access, no side effects.
 *
 * Rules:
 * 1. "complete" is sticky — once a human marks done, always returned as-is.
 * 2. "failed" is sticky when no sessions exist (preserves human-set failure).
 *    With active sessions, active status takes precedence.
 * 3. No sessions → "not_started" (clamp any stale transient status).
 * 4. Any active session (pending/running/idle):
 *    - Any "idle" → "paused"
 *    - Otherwise → "working"
 * 5. All sessions terminal → "paused" (work was done, now stopped)
 *
 * @param storedStatus - The task's status as stored in the DB.
 * @param sessions - All sessions for this task, in any order.
 * @returns Computed status and the ID of the latest session.
 */
export function computeTaskStatus(
  storedStatus: string,
  sessions: Pick<SessionRow, "id" | "status" | "startedAt">[],
): TaskStatusResult {
  // "complete" and "failed" are sticky — human-authoritative when no sessions contradict
  if (storedStatus === TASK_STATUS.COMPLETE || storedStatus === TASK_STATUS.FAILED) {
    const latestSessionId = sessions.length > 0
      ? getLatestSession(sessions).id
      : "";
    // If there are active sessions, they take precedence over failed (but not complete)
    if (storedStatus === TASK_STATUS.COMPLETE) {
      return { status: TASK_STATUS.COMPLETE, latestSessionId };
    }
    // For "failed" without sessions, keep it; with active sessions, fall through
    if (sessions.length === 0) {
      return { status: TASK_STATUS.FAILED, latestSessionId: "" };
    }
  }

  // No sessions → not_started (clamp any stale transient status)
  if (sessions.length === 0) {
    return { status: TASK_STATUS.NOT_STARTED, latestSessionId: "" };
  }

  // Check for any active sessions
  const activeSessions = sessions.filter((s) =>
    ACTIVE_SESSION_STATUSES.has(s.status),
  );

  if (activeSessions.length > 0) {
    const hasIdle = activeSessions.some((s) => s.status === SESSION_STATUS.IDLE);
    return {
      status: hasIdle ? TASK_STATUS.PAUSED : TASK_STATUS.WORKING,
      latestSessionId: getLatestSession(sessions).id,
    };
  }

  // All sessions are terminal — task is paused (work was done, now stopped)
  const latest = getLatestSession(sessions);

  return { status: TASK_STATUS.PAUSED, latestSessionId: latest.id };
}

/** Get the most recent session by startedAt (descending), breaking ties by ID. */
function getLatestSession(
  sessions: Pick<SessionRow, "id" | "status" | "startedAt">[],
): Pick<SessionRow, "id" | "status" | "startedAt"> {
  return sessions.reduce((latest, current) => {
    if (current.startedAt > latest.startedAt) {
      return current;
    }
    if (current.startedAt === latest.startedAt && current.id > latest.id) {
      return current;
    }
    return latest;
  });
}
