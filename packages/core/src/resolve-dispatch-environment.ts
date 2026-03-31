/**
 * Automatic environment resolution for the dispatch phase.
 *
 * When a queued task has no explicit environmentId, this function resolves
 * one using a priority cascade: ancestor session → workspace linked envs
 * (load balanced) → global fallback.
 *
 * This module is side-effect-free; logging is left to the caller.
 */

/** Dependencies for environment resolution, injected for testability. */
export interface ResolveEnvironmentDeps {
  /** Walk the parent task chain for an ancestor with a session environment. */
  resolveAncestorEnvironmentId: (parentTaskId: string) => string;
  /** Get all environment IDs linked to a workspace. */
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
 * 2. Workspace's linked environments (pick connected with fewest active sessions)
 * 3. Global fallback (`findFirstConnectedEnvironment`)
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
      return ancestorEnvId;
    }
  }

  // 2. Workspace linked environments — pick connected with fewest active sessions
  if (task.workspaceId) {
    const linkedIds = deps.getLinkedEnvironmentIds(task.workspaceId);
    const connectedLinked = linkedIds.filter((id) => deps.isEnvironmentConnected(id));
    if (connectedLinked.length > 0) {
      // Precompute active session counts once to avoid repeated DB hits during sort.
      const activeCounts = new Map<string, number>();
      for (const id of connectedLinked) {
        activeCounts.set(id, deps.countActiveForEnvironment(id));
      }

      // Sort by active session count ascending (load balance), with deterministic tie-breaker.
      connectedLinked.sort((a, b) => {
        const countA = activeCounts.get(a)!;
        const countB = activeCounts.get(b)!;
        if (countA !== countB) {
          return countA - countB;
        }
        // Tie-break on ID to keep ordering deterministic when counts are equal.
        return a.localeCompare(b);
      });
      return connectedLinked[0]!;
    }
  }

  // 3. Global fallback — any connected environment
  const fallback = deps.findFirstConnectedEnvironment();
  if (fallback) {
    return fallback.id;
  }

  // 4. No environment available
  return undefined;
}
