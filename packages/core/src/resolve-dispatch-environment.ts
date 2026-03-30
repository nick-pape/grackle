/**
 * Automatic environment resolution for the dispatch phase.
 *
 * When a queued task has no explicit environmentId, this function resolves
 * one using a priority cascade: ancestor session → workspace legacy env →
 * workspace linked envs (load balanced) → global fallback.
 */

import { logger } from "./logger.js";

/** Dependencies for environment resolution, injected for testability. */
export interface ResolveEnvironmentDeps {
  /** Walk the parent task chain for an ancestor with a session environment. */
  resolveAncestorEnvironmentId: (parentTaskId: string) => string;
  /** Look up a workspace by ID. */
  getWorkspace: (id: string) => { environmentId: string } | undefined;
  /** Get all environment IDs linked to a workspace (#814). */
  getLinkedEnvironmentIds: (workspaceId: string) => string[];
  /** Check if an environment is connected. */
  isEnvironmentConnected: (id: string) => boolean;
  /** Count active (pending/running/idle) sessions for an environment. */
  countActiveForEnvironment: (id: string) => number;
  /** Global fallback: find any connected environment (prefers local). */
  findFirstConnectedEnvironment: () => { id: string } | undefined;
}

/**
 * Resolve an environment for a task that has no explicit environmentId.
 *
 * Cascade:
 * 1. Ancestor task's session environment (parent chain walk)
 * 2. Workspace's legacy `environmentId` field (if connected)
 * 3. Workspace's linked environments (pick connected with fewest active sessions)
 * 4. Global fallback (`findFirstConnectedEnvironment`)
 *
 * @returns The resolved environment ID, or `undefined` if none available.
 */
export function resolveDispatchEnvironment(
  // eslint-disable-next-line @rushstack/no-new-null
  task: { workspaceId: string | null; parentTaskId: string },
  deps: ResolveEnvironmentDeps,
): string | undefined {
  // 1. Ancestor environment — inherit from parent chain
  if (task.parentTaskId) {
    const ancestorEnvId = deps.resolveAncestorEnvironmentId(task.parentTaskId);
    if (ancestorEnvId && deps.isEnvironmentConnected(ancestorEnvId)) {
      logger.debug({ taskParentId: task.parentTaskId, environmentId: ancestorEnvId }, "Dispatch resolve: ancestor environment");
      return ancestorEnvId;
    }
  }

  // 2 & 3. Workspace-scoped resolution (only if task has a workspace)
  if (task.workspaceId) {
    const workspace = deps.getWorkspace(task.workspaceId);

    // 2. Workspace legacy environmentId
    if (workspace?.environmentId && deps.isEnvironmentConnected(workspace.environmentId)) {
      logger.debug({ workspaceId: task.workspaceId, environmentId: workspace.environmentId }, "Dispatch resolve: workspace default environment");
      return workspace.environmentId;
    }

    // 3. Workspace linked environments — pick connected with fewest active sessions
    const linkedIds = deps.getLinkedEnvironmentIds(task.workspaceId);
    const connectedLinked = linkedIds.filter((id) => deps.isEnvironmentConnected(id));
    if (connectedLinked.length > 0) {
      // Sort by active session count ascending (load balance)
      connectedLinked.sort((a, b) => deps.countActiveForEnvironment(a) - deps.countActiveForEnvironment(b));
      const picked = connectedLinked[0]!;
      logger.debug(
        { workspaceId: task.workspaceId, environmentId: picked, candidates: connectedLinked.length },
        "Dispatch resolve: linked environment (load balanced)",
      );
      return picked;
    }
  }

  // 4. Global fallback — any connected environment
  const fallback = deps.findFirstConnectedEnvironment();
  if (fallback) {
    logger.debug({ environmentId: fallback.id }, "Dispatch resolve: global fallback");
    return fallback.id;
  }

  // 5. No environment available
  return undefined;
}
