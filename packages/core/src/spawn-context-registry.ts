/**
 * Spawn-context provider registry (#1259).
 *
 * Plugins contribute system-prompt sections at session spawn via the
 * `systemPromptContributors` plugin hook; the server collects them and calls
 * {@link setSpawnContextProviders}. Both spawn paths then call
 * {@link runSpawnContextProviders} to gather sections — best-effort, bounded by
 * a per-provider timeout so a slow or unavailable provider never blocks spawn.
 *
 * Kept in `@grackle-ai/core` (not plugin-sdk) so both spawn call sites — the
 * gRPC `startTask` in plugin-core and the auto-start `startTaskSession` in core
 * — can read it without depending on the loader's `LoadedPlugins` (or on the
 * contributing plugin). Mirrors the existing server-set module-singleton pattern
 * (e.g. `isPluginLoaded`).
 *
 * @module
 */

import type { SpawnContextInput, SystemPromptContributor } from "@grackle-ai/plugin-sdk";
import { logger } from "./logger.js";

/** Default per-provider timeout (ms); override with `GRACKLE_KG_SPAWN_CONTEXT_TIMEOUT_MS`. */
const DEFAULT_SPAWN_CONTEXT_TIMEOUT_MS: number = 1500;

/** Providers registered by the server from loaded plugins (load order preserved). */
let providers: SystemPromptContributor[] = [];

/** Replace the registered spawn-context providers (called once by the server at startup). */
export function setSpawnContextProviders(next: SystemPromptContributor[]): void {
  providers = next;
}

/** Clear all registered providers (test helper). */
export function clearSpawnContextProviders(): void {
  providers = [];
}

/**
 * Whether any spawn-context provider is registered. Used as the spawn-path
 * signal that knowledge context is available (the knowledge plugin registers a
 * provider), without importing plugin load state into core.
 */
export function hasSpawnContextProviders(): boolean {
  return providers.length > 0;
}

/** Resolve the configured per-provider timeout. */
function resolveTimeoutMs(override?: number): number {
  if (override !== undefined) {
    return override;
  }
  const env: number = Number(process.env.GRACKLE_KG_SPAWN_CONTEXT_TIMEOUT_MS);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_SPAWN_CONTEXT_TIMEOUT_MS;
}

/**
 * Run all registered providers for a spawn and collect their non-empty sections,
 * in registration order. Best-effort: each provider races a timeout, and any
 * rejection or timeout is logged at debug and contributes nothing. Never rejects.
 */
export async function runSpawnContextProviders(
  input: SpawnContextInput,
  options?: { timeoutMs?: number },
): Promise<string[]> {
  if (providers.length === 0) {
    return [];
  }
  const timeoutMs: number = resolveTimeoutMs(options?.timeoutMs);
  const sections = await Promise.all(
    providers.map((provider) => runOne(provider, input, timeoutMs)),
  );
  return sections.filter((section): section is string => typeof section === "string" && section.length > 0);
}

/** Run a single provider, bounded by `timeoutMs`; never throws. */
async function runOne(
  provider: SystemPromptContributor,
  input: SpawnContextInput,
  timeoutMs: number,
): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Attach the catch to the work promise itself so a late rejection (after the
  // timeout already won the race) is still handled rather than going unhandled.
  const work: Promise<string | undefined> = provider.contribute(input).catch((err: unknown) => {
    logger.debug({ err }, "Spawn-context provider failed; skipping");
    return undefined;
  });
  const timeout: Promise<undefined> = new Promise((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
