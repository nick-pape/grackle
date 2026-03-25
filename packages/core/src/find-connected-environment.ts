/**
 * Find the first connected environment, preferring local adapters.
 *
 * Extracted from the root task boot listener in server/src/index.ts
 * so that CronManager and other server-internal code can reuse the logic.
 */

import { envRegistry, type EnvironmentRow } from "@grackle-ai/database";

/**
 * Return the first connected environment, preferring local adapter type.
 * Returns undefined if no environment is connected.
 */
export function findFirstConnectedEnvironment(): EnvironmentRow | undefined {
  const all = envRegistry.listEnvironments();
  return (
    all.find((e) => e.status === "connected" && e.adapterType === "local") ||
    all.find((e) => e.status === "connected")
  );
}
