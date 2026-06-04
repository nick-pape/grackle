/**
 * Find the first connected environment, preferring local adapters.
 *
 * Extracted from the root task boot listener in server/src/index.ts
 * so that the cron phase and other server-internal code can reuse the logic.
 */

import { envRegistry } from "@grackle-ai/database";
import type { EnvironmentModel } from "./domain/index.js";
import { toEnvironmentModel } from "./domain/index.js";

/**
 * Return the first connected environment, preferring local adapter type.
 * Returns undefined if no environment is connected.
 */
export function findFirstConnectedEnvironment(): EnvironmentModel | undefined {
  const all = envRegistry.listEnvironments();
  const found =
    all.find((e) => e.status === "connected" && e.adapterType === "local") ||
    all.find((e) => e.status === "connected");
  return found ? toEnvironmentModel(found) : undefined;
}
