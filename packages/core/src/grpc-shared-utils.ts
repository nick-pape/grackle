/**
 * Shared gRPC utility functions used by core infrastructure and plugin-core handlers.
 *
 * @module
 */

import { ValidationError } from "@grackle-ai/common";
import { sessionStore, taskStore } from "@grackle-ai/database";

/** Valid pipe mode values for SpawnRequest and StartTaskRequest. */
export const VALID_PIPE_MODES: ReadonlySet<string> = new Set(["", "sync", "async", "detach"]);

/** Validate pipe mode and parentSessionId. Throws ValidationError on invalid input. */
export function validatePipeInputs(pipe: string, parentSessionId: string): void {
  if (pipe && !VALID_PIPE_MODES.has(pipe)) {
    throw new ValidationError(
      `Invalid pipe mode: "${pipe}". Must be "sync", "async", "detach", or empty.`,
    );
  }
  if (pipe && pipe !== "detach" && !parentSessionId) {
    throw new ValidationError(`Pipe mode "${pipe}" requires parent_session_id`);
  }
}

/**
 * Map a bind host to a dialable URL host. Wildcard addresses become loopback,
 * unless `dockerHost` is provided (DooD mode) — in that case, use that value
 * so sibling containers can reach the server by container name.
 *
 * Falls back to `GRACKLE_DOCKER_HOST` env var when `dockerHost` is not
 * explicitly passed (backward compat during config migration).
 */
export function toDialableHost(bindHost: string, dockerHost?: string): string {
  if (bindHost === "0.0.0.0" || bindHost === "::") {
    const resolved = dockerHost ?? process.env.GRACKLE_DOCKER_HOST;
    if (resolved) {
      if (resolved.startsWith("[") && resolved.endsWith("]")) {
        return resolved;
      }
      return resolved.includes(":") ? `[${resolved}]` : resolved;
    }
    return bindHost === "::" ? "[::1]" : "127.0.0.1";
  }
  return bindHost.includes(":") ? `[${bindHost}]` : bindHost;
}

/**
 * Walk up the task parent chain and return the environmentId from the first
 * ancestor that has a session. Returns empty string if no ancestor has one.
 *
 * Uses batch queries: getAncestors (1 getTask + 1 listTasks) + getLatestSessionsByTaskIds
 * (1 session query) = 3 total instead of up to 2×MAX_TASK_DEPTH.
 */
export function resolveAncestorEnvironmentId(parentTaskId: string): string {
  if (!parentTaskId) {
    return "";
  }
  const ancestors = taskStore.getAncestors(parentTaskId);
  const ancestorIds = [parentTaskId, ...[...ancestors].reverse().map((a) => a.id)];

  const sessionMap = sessionStore.getLatestSessionsByTaskIds(ancestorIds);

  for (const id of ancestorIds) {
    const session = sessionMap.get(id);
    if (session?.environmentId) {
      return session.environmentId;
    }
  }
  return "";
}
