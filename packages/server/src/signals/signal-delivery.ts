import { create } from "@bufbuild/protobuf";
import { grackle, powerline, SESSION_STATUS } from "@grackle-ai/common";
import * as sessionStore from "../session-store.js";
import * as adapterManager from "../adapter-manager.js";
import { reanimateAgent } from "../reanimate-agent.js";
import * as streamHub from "../stream-hub.js";
import * as logWriter from "../log-writer.js";
import { logger } from "../logger.js";

/** Timeout (ms) to wait for a reanimated session to reach IDLE. */
const REANIMATE_IDLE_TIMEOUT_MS: number = 60_000;

/** Statuses considered active (the agent can accept input). */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  SESSION_STATUS.IDLE,
  SESSION_STATUS.RUNNING,
  SESSION_STATUS.PENDING,
]);

/**
 * Deliver a signal message to a task's agent session.
 *
 * Active session (IDLE/RUNNING/PENDING) → sendInput bypassing the IDLE guard.
 * Dead session (COMPLETED/FAILED/INTERRUPTED) → reanimate + wait for IDLE + sendInput.
 * No session at all → log warning, return false.
 *
 * @param taskId - Target task whose session should receive the signal.
 * @param signalType - Signal kind for logging (e.g. "sigchld").
 * @param message - The text content to deliver as user input.
 * @returns true if the message was sent, false otherwise.
 */
export async function deliverSignalToTask(
  taskId: string,
  signalType: string,
  message: string,
): Promise<boolean> {
  // ── 1. Try an active session ──────────────────────────────
  const activeSessions = sessionStore.getActiveSessionsForTask(taskId);
  if (activeSessions.length > 0) {
    const session = activeSessions[0];
    return await sendInputToSession(session.id, session.environmentId, message, signalType);
  }

  // ── 2. Try reanimating the latest terminal session ────────
  const latest = sessionStore.getLatestSessionForTask(taskId);
  if (!latest) {
    logger.warn({ taskId, signalType }, "No session exists for task — signal dropped");
    return false;
  }

  if (ACTIVE_STATUSES.has(latest.status)) {
    // Should not happen (getActiveSessionsForTask would have found it),
    // but handle it defensively.
    return await sendInputToSession(latest.id, latest.environmentId, message, signalType);
  }

  if (!latest.runtimeSessionId) {
    logger.warn(
      { taskId, sessionId: latest.id, signalType },
      "Latest session has no runtimeSessionId — cannot reanimate, signal dropped",
    );
    return false;
  }

  // Subscribe to the session stream BEFORE reanimating so we don't miss
  // the waiting_input event if the runtime reaches IDLE quickly (e.g. stub).
  const idleWaiter = waitForSessionIdle(latest.id, REANIMATE_IDLE_TIMEOUT_MS);

  try {
    reanimateAgent(latest.id);
  } catch (err) {
    idleWaiter.cancel();
    logger.error(
      { err, taskId, sessionId: latest.id, signalType },
      "Failed to reanimate session for signal delivery",
    );
    return false;
  }

  // Wait for the reanimated session to reach IDLE
  const reachedIdle = await idleWaiter.promise;
  if (!reachedIdle) {
    logger.error(
      { taskId, sessionId: latest.id, signalType },
      "Reanimated session did not reach IDLE within timeout — signal dropped",
    );
    return false;
  }

  return await sendInputToSession(latest.id, latest.environmentId, message, signalType);
}

/**
 * Send input text to a session via its environment's PowerLine connection.
 * Bypasses the server-side IDLE guard — the agent runtime accepts input at any
 * time and picks it up at the next turn boundary.
 */
async function sendInputToSession(
  sessionId: string,
  environmentId: string,
  text: string,
  signalType: string,
): Promise<boolean> {
  const conn = adapterManager.getConnection(environmentId);
  if (!conn) {
    logger.error(
      { sessionId, environmentId, signalType },
      "Environment not connected — signal delivery failed",
    );
    return false;
  }

  try {
    // Record the signal as a SIGNAL event in the session log and stream.
    const session = sessionStore.getSession(sessionId);
    const signalEvent = create(grackle.SessionEventSchema, {
      sessionId,
      type: grackle.EventType.SIGNAL,
      timestamp: new Date().toISOString(),
      content: text,
    });
    if (session?.logPath) {
      // Ensure the stream is open before writing — the session may still be
      // PENDING and processEventStream may not have called initLog yet.
      logWriter.ensureLogInitialized(session.logPath);
      logWriter.writeEvent(session.logPath, signalEvent);
    }
    streamHub.publish(signalEvent);

    await conn.client.sendInput(
      create(powerline.InputMessageSchema, { sessionId, text }),
    );
    logger.info({ sessionId, signalType }, "Signal delivered to session");
    return true;
  } catch (err) {
    logger.error(
      { err, sessionId, signalType },
      "sendInput failed during signal delivery",
    );
    return false;
  }
}

/** Handle returned by waitForSessionIdle for pre-subscribe + cancel support. */
interface IdleWaiter {
  /** Resolves to true if IDLE reached, false on timeout or terminal status. */
  promise: Promise<boolean>;
  /** Cancel the waiter early (e.g. if reanimate fails). */
  cancel: () => void;
}

/**
 * Begin watching for a session to reach IDLE status via StreamHub events.
 * Subscribes immediately so events are captured even before the caller starts
 * the session (e.g. via reanimateAgent).
 */
function waitForSessionIdle(
  sessionId: string,
  timeoutMs: number,
): IdleWaiter {
  const stream = streamHub.createStream(sessionId);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const promise = (async () => {
    // Check DB after subscribing to close the race window.
    const current = sessionStore.getSession(sessionId);
    if (current?.status === SESSION_STATUS.IDLE) {
      stream.cancel();
      return true;
    }

    try {
      return await Promise.race<boolean>([
        (async () => {
          for await (const event of stream) {
            // Only inspect status events — other event types (text, tool_use, etc.)
            // can have arbitrary content that might accidentally match status strings.
            if (event.type !== grackle.EventType.STATUS) {
              continue;
            }
            // "waiting_input" is the runtime status that maps to IDLE in the session store.
            if (event.content === "waiting_input") {
              return true;
            }
            // If the session hit a terminal state, stop waiting
            if (["completed", "failed", "killed", "interrupted"].includes(event.content)) {
              return false;
            }
          }
          return false;
        })(),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => {
            stream.cancel();
            resolve(false);
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      stream.cancel();
    }
  })();

  return {
    promise,
    cancel: () => {
      stream.cancel();
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    },
  };
}
