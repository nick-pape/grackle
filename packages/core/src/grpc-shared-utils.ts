/**
 * Shared gRPC utility functions used by core infrastructure and plugin-core handlers.
 *
 * @module
 */

import { ConnectError, Code } from "@connectrpc/connect";
import { MAX_TASK_DEPTH } from "@grackle-ai/common";
import { sessionStore, taskStore } from "@grackle-ai/database";

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
