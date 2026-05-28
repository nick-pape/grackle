import { ConnectError, Code } from "@connectrpc/connect";
import { SESSION_STATUS, END_REASON } from "@grackle-ai/common";
import { type PowerLineConnection } from "@grackle-ai/adapter-sdk";
import { sessionStore, taskStore } from "@grackle-ai/database";
import { reanimateAgent } from "./reanimate-agent.js";
import { logger } from "./logger.js";
import { emit } from "./event-bus.js";

/** Set of environment IDs currently undergoing recovery to prevent concurrent attempts. */
const recoveringEnvironments: Set<string> = new Set<string>();

/**
 * Recover disconnected sessions for a newly reconnected environment.
 *
 * Finds sessions in SUSPENDED, RUNNING, or IDLE state (RUNNING/IDLE handles
 * the "server died" scenario where sessions never got suspended). Drains
 * buffered events from PowerLine, writes them to the session JSONL, then
 * reanimates the first recoverable session. Remaining sessions are left
 * SUSPENDED for later recovery (only one active session per environment).
 *
 * Fire-and-forget: logs errors but does not throw.
 */
export async function recoverSuspendedSessions(
  environmentId: string,
  _connection: PowerLineConnection,
): Promise<void> {
  if (recoveringEnvironments.has(environmentId)) {
    logger.warn({ environmentId }, "Recovery already in progress — skipping");
    return;
  }

  // Find sessions that need recovery: SUSPENDED (normal path) plus
  // RUNNING/IDLE (server-died path where sessions were never suspended).
  const suspended = sessionStore.getSuspendedForEnv(environmentId);
  const active = sessionStore.getActiveForEnv(environmentId);

  // Transition any stale active session to SUSPENDED first so reanimate accepts it.
  if (active) {
    sessionStore.suspendSession(active.id);
    suspended.unshift(active);
  }

  if (suspended.length === 0) {
    return;
  }

  recoveringEnvironments.add(environmentId);
  logger.info(
    { environmentId, count: suspended.length },
    "Beginning recovery of suspended sessions",
  );

  try {
    // Only reanimate the first session — the one-active-session-per-env
    // constraint means subsequent sessions would fail. Leave the rest
    // SUSPENDED for manual reanimate or future recovery.
    const session = suspended[0]!;
    try {
      // HR8d: drain of parked events is no longer an explicit step. The
      // AHP wire's `subscribe` (issued by AhpHostTransport.reanimate) replays
      // any parked events as leading `action` notifications, so the
      // recovery's processEventStream sees them as the first events on
      // the resume stream — identical end behavior, simpler call site.

      // Re-check: a new session may have started during the recovery setup window
      const currentActive = sessionStore.getActiveForEnv(environmentId);
      if (currentActive) {
        logger.info(
          { sessionId: session.id, activeSessionId: currentActive.id, environmentId },
          "Skipping recovery — environment acquired a new active session during setup",
        );
        return;
      }

      // Reanimate the session (starts resume stream + processEventStream).
      // Any parked events from a prior disconnect arrive as the first
      // envelopes on the resume stream (via AhpHostTransport's subscribe
      // replay).
      reanimateAgent(session.id);
      logger.info({ sessionId: session.id }, "Successfully reanimated suspended session");
      emitTaskUpdated(session.taskId);
    } catch (err) {
      // If the environment acquired an active session between our check and
      // reanimateAgent's check, this is a benign race — leave the session
      // SUSPENDED for future recovery instead of marking it permanently failed.
      if (
        err instanceof ConnectError &&
        err.code === Code.FailedPrecondition &&
        err.message.includes("already has active session")
      ) {
        logger.info(
          { sessionId: session.id, environmentId },
          "Recovery skipped — environment already has an active session",
        );
      } else {
        logger.error(
          { sessionId: session.id, err },
          "Failed to recover suspended session — marking stopped (interrupted)",
        );
        sessionStore.updateSession(
          session.id,
          SESSION_STATUS.STOPPED,
          undefined,
          `Recovery failed: ${String(err)}`,
          END_REASON.INTERRUPTED,
        );
        emitTaskUpdated(session.taskId);
      }
    }
  } finally {
    recoveringEnvironments.delete(environmentId);
  }
}

/** Emit a task.updated event with the correct workspaceId, if the session has a task. */
function emitTaskUpdated(taskId: string | undefined): void {
  if (!taskId) {
    return;
  }
  const task = taskStore.getTask(taskId);
  emit("task.updated", { taskId, workspaceId: task?.workspaceId || "" });
}

/** @internal Reset the recovery lock for testing. */
export function _resetForTesting(): void {
  recoveringEnvironments.clear();
}
