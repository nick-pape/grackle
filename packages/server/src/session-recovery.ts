import { create } from "@bufbuild/protobuf";
import { grackle, powerline, eventTypeToEnum, SESSION_STATUS, LOGS_DIR, END_REASON } from "@grackle-ai/common";
import type { PowerLineConnection } from "@grackle-ai/adapter-sdk";
import { join } from "node:path";
import { sessionStore, taskStore, grackleHome } from "@grackle-ai/database";
import * as logWriter from "./log-writer.js";
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
  connection: PowerLineConnection,
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
  logger.info({ environmentId, count: suspended.length }, "Beginning recovery of suspended sessions");

  try {
    // Only reanimate the first session — the one-active-session-per-env
    // constraint means subsequent sessions would fail. Leave the rest
    // SUSPENDED for manual reanimate or future recovery.
    const session = suspended[0]!;
    try {
      // Step 1: Drain buffered events from PowerLine and append to JSONL
      const logPath = session.logPath || join(grackleHome, LOGS_DIR, session.id);
      const drainReq = create(powerline.DrainRequestSchema, {
        sessionId: session.id,
      });

      let drainedCount = 0;
      try {
        const drainStream = connection.client.drainBufferedEvents(drainReq);
        logWriter.ensureLogInitialized(logPath);

        for await (const event of drainStream) {
          // Skip internal events (e.g. runtime_session_id) that would map
          // to UNSPECIFIED — those are handled by processEventStream, not the drain.
          const eventType = eventTypeToEnum(event.type);
          if (eventType === grackle.EventType.UNSPECIFIED) {
            continue;
          }
          const sessionEvent = create(grackle.SessionEventSchema, {
            sessionId: session.id,
            type: eventType,
            timestamp: event.timestamp,
            content: event.content,
            raw: event.raw,
          });
          logWriter.writeEvent(logPath, sessionEvent);
          drainedCount++;
        }
      } catch (drainErr) {
        // Drain may fail if PowerLine was restarted (no parked events).
        // This is expected — continue to reanimate anyway.
        logger.info(
          { sessionId: session.id, err: drainErr },
          "Drain returned no buffered events (PowerLine may have restarted)",
        );
      } finally {
        // Always close the log stream to avoid leaking file descriptors.
        logWriter.endSession(logPath);
      }

      if (drainedCount > 0) {
        logger.info(
          { sessionId: session.id, drainedCount },
          "Drained buffered events for suspended session",
        );
      }

      // Step 2: Reanimate the session (starts resume stream + processEventStream)
      reanimateAgent(session.id);
      logger.info({ sessionId: session.id }, "Successfully reanimated suspended session");
      emitTaskUpdated(session.taskId);

    } catch (err) {
      logger.error(
        { sessionId: session.id, err },
        "Failed to recover suspended session — marking stopped (interrupted)",
      );
      sessionStore.updateSession(session.id, SESSION_STATUS.STOPPED, undefined, `Recovery failed: ${String(err)}`, END_REASON.INTERRUPTED);
      emitTaskUpdated(session.taskId);
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
