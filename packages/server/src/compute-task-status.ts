import type { SessionRow } from "./schema.js";

/** Result of computing a task's effective status from its session history. */
export interface TaskStatusResult {
  /** The computed effective status string (e.g. "in_progress", "review", "pending"). */
  status: string;
  /** The ID of the most recent session (by startedAt), or empty string if none. */
  latestSessionId: string;
}

/** Session statuses that indicate the session is actively running. */
const ACTIVE_SESSION_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "running",
  "waiting_input",
]);

/**
 * Human-authoritative task statuses. These are sticky — once a human sets
 * these statuses, session state does not override them.
 */
const HUMAN_AUTHORITATIVE_STATUSES: ReadonlySet<string> = new Set([
  "done",
  "assigned",
]);

/**
 * Compute the effective task status from the stored DB status and the task's
 * session history. Pure function — no DB access, no side effects.
 *
 * Rules:
 * 1. Human-authoritative statuses ("done", "assigned") are sticky — always returned as-is.
 * 2. No sessions → return storedStatus unchanged.
 * 3. Any active session (pending/running/waiting_input) → prefer waiting_input > in_progress.
 * 4. Latest terminal session determines status:
 *    - completed → "review"
 *    - failed → "failed"
 *    - killed → "pending" (retryable)
 *
 * @param storedStatus - The task's status as stored in the DB.
 * @param sessions - All sessions for this task, in any order.
 * @returns Computed status and the ID of the latest session.
 */
export function computeTaskStatus(
  storedStatus: string,
  sessions: Pick<SessionRow, "id" | "status" | "startedAt">[],
): TaskStatusResult {
  // Human-authoritative statuses are always sticky
  if (HUMAN_AUTHORITATIVE_STATUSES.has(storedStatus)) {
    const latestSessionId = sessions.length > 0
      ? getLatestSession(sessions).id
      : "";
    return { status: storedStatus, latestSessionId };
  }

  // No sessions → return stored status
  if (sessions.length === 0) {
    return { status: storedStatus, latestSessionId: "" };
  }

  // Check for any active sessions
  const activeSessions = sessions.filter((s) =>
    ACTIVE_SESSION_STATUSES.has(s.status),
  );

  if (activeSessions.length > 0) {
    // Prefer waiting_input over in_progress if any session is waiting
    const hasWaitingInput = activeSessions.some(
      (s) => s.status === "waiting_input",
    );
    return {
      status: hasWaitingInput ? "waiting_input" : "in_progress",
      latestSessionId: getLatestSession(sessions).id,
    };
  }

  // All sessions are terminal — use the latest one to determine status
  const latest = getLatestSession(sessions);

  let status: string;
  switch (latest.status) {
    case "completed":
      status = "review";
      break;
    case "failed":
      status = "failed";
      break;
    case "killed":
      status = "pending";
      break;
    default:
      status = storedStatus;
      break;
  }

  return { status, latestSessionId: latest.id };
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
