/**
 * Concurrency limit resolution for agent dispatch.
 *
 * Pure functions with dependency injection for testability.
 * Determines whether an environment has capacity for another agent session
 * based on per-environment overrides, global settings, and defaults.
 */

import { DEFAULT_MAX_CONCURRENT_SESSIONS, SETTINGS_KEY_MAX_CONCURRENT_SESSIONS } from "@grackle-ai/common";

/** Dependencies for concurrency checks, injected for testability. */
export interface ConcurrencyDeps {
  /** Count active (pending/running/idle) sessions for an environment. */
  countActiveForEnvironment: (environmentId: string) => number;
  /** Look up an environment's concurrency override. */
  getEnvironment: (id: string) => { maxConcurrentSessions: number } | undefined;
  /** Read a server setting by key. */
  getSetting: (key: string) => string | undefined;
}

/**
 * Resolve the effective concurrent session limit for an environment.
 *
 * Cascade:
 * 1. Environment's `maxConcurrentSessions` column (non-zero wins)
 * 2. Global `max_concurrent_sessions` setting
 * 3. {@link DEFAULT_MAX_CONCURRENT_SESSIONS} constant
 */
export function getEffectiveLimit(environmentId: string, deps: ConcurrencyDeps): number {
  const env = deps.getEnvironment(environmentId);
  if (env && env.maxConcurrentSessions > 0) {
    return env.maxConcurrentSessions;
  }

  const globalSetting = deps.getSetting(SETTINGS_KEY_MAX_CONCURRENT_SESSIONS);
  if (globalSetting !== undefined) {
    const parsed = parseInt(globalSetting, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return DEFAULT_MAX_CONCURRENT_SESSIONS;
}

/**
 * Check whether an environment has capacity for another agent session.
 *
 * @returns `true` if the active session count is below the effective limit.
 */
export function hasCapacity(environmentId: string, deps: ConcurrencyDeps): boolean {
  const limit = getEffectiveLimit(environmentId, deps);
  const active = deps.countActiveForEnvironment(environmentId);
  return active < limit;
}
