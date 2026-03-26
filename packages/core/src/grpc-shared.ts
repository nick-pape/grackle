import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle, powerline } from "@grackle-ai/common";
import {
  MAX_TASK_DEPTH,
  SESSION_STATUS,
  TERMINAL_SESSION_STATUSES,
  type SessionStatus,
  END_REASON,
} from "@grackle-ai/common";
import type { SessionRow } from "@grackle-ai/database";
import { sessionStore, taskStore } from "@grackle-ai/database";
import * as adapterManager from "./adapter-manager.js";
import * as streamHub from "./stream-hub.js";
import * as streamRegistry from "./stream-registry.js";
import { cleanupLifecycleStream } from "./lifecycle.js";
import { logger } from "./logger.js";
import { emit } from "./event-bus.js";

/** Valid pipe mode values for SpawnRequest and StartTaskRequest. */
export const VALID_PIPE_MODES: ReadonlySet<string> = new Set(["", "sync", "async", "detach"]);

/** Validate pipe mode and parentSessionId. Throws ConnectError on invalid input. */
export function validatePipeInputs(pipe: string, parentSessionId: string): void {
  if (pipe && !VALID_PIPE_MODES.has(pipe)) {
    throw new ConnectError(
      `Invalid pipe mode: "${pipe}". Must be "sync", "async", "detach", or empty.`,
      Code.InvalidArgument,
    );
  }
  if (pipe && pipe !== "detach" && !parentSessionId) {
    throw new ConnectError(
      `Pipe mode "${pipe}" requires parent_session_id`,
      Code.InvalidArgument,
    );
  }
}

/**
 * Map a bind host to a dialable URL host. Wildcard addresses become loopback,
 * unless GRACKLE_DOCKER_HOST is set (DooD mode) — in that case, use that value
 * so sibling containers can reach the server by container name.
 */
export function toDialableHost(bindHost: string): string {
  if (bindHost === "0.0.0.0" || bindHost === "::") {
    const dockerHost = process.env.GRACKLE_DOCKER_HOST;
    if (dockerHost) {
      if (dockerHost.startsWith("[") && dockerHost.endsWith("]")) {
        return dockerHost;
      }
      return dockerHost.includes(":") ? `[${dockerHost}]` : dockerHost;
    }
    return bindHost === "::" ? "[::1]" : "127.0.0.1";
  }
  return bindHost.includes(":") ? `[${bindHost}]` : bindHost;
}

/**
 * Walk up the task parent chain and return the environmentId from the first
 * ancestor that has a session. Returns empty string if no ancestor has one.
 */
export function resolveAncestorEnvironmentId(parentTaskId: string): string {
  let currentId = parentTaskId;
  for (let i = 0; i < MAX_TASK_DEPTH && currentId; i++) {
    const session = sessionStore.getLatestSessionForTask(currentId);
    if (session?.environmentId) {
      return session.environmentId;
    }
    const parent = taskStore.getTask(currentId);
    if (!parent) {
      break;
    }
    currentId = parent.parentTaskId;
  }
  return "";
}

/**
 * Terminate a session and clean up all associated streams and subscriptions.
 *
 * If the session is already in a terminal state the status update is skipped,
 * but lifecycle and subscription streams are always removed so stale handles
 * do not accumulate.
 */
export function killSessionAndCleanup(session: SessionRow): void {
  if (!TERMINAL_SESSION_STATUSES.has(session.status as SessionStatus)) {
    sessionStore.updateSession(session.id, SESSION_STATUS.STOPPED, undefined, undefined, END_REASON.KILLED);
    streamHub.publish(
      create(grackle.SessionEventSchema, {
        sessionId: session.id,
        type: grackle.EventType.STATUS,
        timestamp: new Date().toISOString(),
        content: END_REASON.KILLED,
        raw: "",
      }),
    );
    if (session.taskId) {
      const task = taskStore.getTask(session.taskId);
      if (task) {
        emit("task.updated", { taskId: task.id, workspaceId: task.workspaceId || "" });
      }
    }
  }

  // Forward kill to PowerLine so the agent process is actually terminated.
  // The orphan callback also sends a kill, but that fires asynchronously
  // after subscription cleanup — this ensures immediate process termination.
  const conn = adapterManager.getConnection(session.environmentId);
  if (conn) {
    conn.client.kill(
      create(powerline.KillRequestSchema, { id: session.id, reason: END_REASON.KILLED }),
    ).catch((err: unknown) => {
      logger.debug({ err, sessionId: session.id }, "PowerLine kill failed (process may have already exited)");
    });
  }

  cleanupLifecycleStream(session.id);
  const subs = streamRegistry.getSubscriptionsForSession(session.id);
  for (const sub of subs) {
    streamRegistry.unsubscribe(sub.id);
  }
}
