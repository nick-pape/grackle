import { create } from "@bufbuild/protobuf";
import { grackle, powerline, eventTypeToEnum, SESSION_STATUS, LOGS_DIR } from "@grackle-ai/common";
import type { PowerLineConnection } from "@grackle-ai/adapter-sdk";
import { join } from "node:path";
import * as sessionStore from "./session-store.js";
import * as logWriter from "./log-writer.js";
import { reanimateAgent } from "./reanimate-agent.js";
import { grackleHome } from "./paths.js";
import { logger } from "./logger.js";
import { emit } from "./event-bus.js";

/** Set of environment IDs currently undergoing recovery to prevent concurrent attempts. */
const recoveringEnvironments: Set<string> = new Set<string>();

/**
 * Recover suspended sessions for a newly reconnected environment.
 *
 * Drains buffered events from PowerLine (parked during the disconnect),
 * writes them to the session JSONL, then reanimates each session via
 * the standard resume flow. Sessions are recovered sequentially since
 * only one active session is allowed per environment.
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

  const suspended = sessionStore.getSuspendedForEnv(environmentId);
  if (suspended.length === 0) {
    return;
  }

  recoveringEnvironments.add(environmentId);
  logger.info({ environmentId, count: suspended.length }, "Beginning recovery of suspended sessions");

  try {
    for (const session of suspended) {
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
            const sessionEvent = create(grackle.SessionEventSchema, {
              sessionId: session.id,
              type: eventTypeToEnum(event.type),
              timestamp: event.timestamp,
              content: event.content,
              raw: event.raw,
            });
            logWriter.writeEvent(logPath, sessionEvent);
            drainedCount++;
          }

          logWriter.endSession(logPath);
        } catch (drainErr) {
          // Drain may fail if PowerLine was restarted (no parked events).
          // This is expected — continue to reanimate anyway.
          logger.info(
            { sessionId: session.id, err: drainErr },
            "Drain returned no buffered events (PowerLine may have restarted)",
          );
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
        emit("task.updated", { taskId: session.taskId, workspaceId: "" });

      } catch (err) {
        logger.error(
          { sessionId: session.id, err },
          "Failed to recover suspended session — marking failed",
        );
        sessionStore.updateSession(session.id, SESSION_STATUS.FAILED, undefined, `Recovery failed: ${String(err)}`);
        emit("task.updated", { taskId: session.taskId, workspaceId: "" });
      }
    }
  } finally {
    recoveringEnvironments.delete(environmentId);
  }
}

/** @internal Reset the recovery lock for testing. */
export function _resetForTesting(): void {
  recoveringEnvironments.clear();
}
