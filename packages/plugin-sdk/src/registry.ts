/**
 * Plugin registry — self-registration pattern for plugin discovery.
 *
 * Each plugin calls {@link registerPlugin} at module scope to declare its
 * metadata and factory function. The server then calls
 * {@link resolveEnabledPlugins} to build the `GracklePlugin[]` array for
 * {@link loadPlugins}, replacing the hardcoded if/else chain.
 *
 * @module
 */

import type { GracklePlugin } from "./plugin.js";

/**
 * Environment variable override for a plugin's default-enabled state.
 *
 * Used only during DB seeding (first run). After that, the DB is authoritative.
 */
export interface PluginEnvOverride {
  /** Environment variable name (e.g., "GRACKLE_SKIP_ORCHESTRATION"). */
  variable: string;
  /**
   * How the env var controls the plugin:
   * - `"skip"`: plugin is disabled when the variable is `"1"` (e.g., `GRACKLE_SKIP_*`)
   * - `"enable"`: plugin is enabled when the variable is `"true"` or `"1"` (e.g., `GRACKLE_KNOWLEDGE_ENABLED`)
   */
  semantics: "skip" | "enable";
}

/**
 * A plugin registration — metadata plus factory, declared once by the plugin
 * package itself. Unifies the old static `PLUGIN_REGISTRY` array and the
 * factory functions that were manually wired in `server/index.ts`.
 */
export interface PluginRegistration {
  /** Unique identifier (must match the name returned by the `GracklePlugin`). */
  name: string;
  /** Human-readable description shown in the UI and CLI. */
  description: string;
  /** True for the core plugin — required and cannot be disabled. */
  required: boolean;
  /** Default enabled state (fallback when no DB row exists). */
  defaultEnabled: boolean;
  /** Optional env var that overrides default-enabled during first-run DB seeding. */
  envOverride?: PluginEnvOverride;
  /** Factory that creates the `GracklePlugin` instance. */
  create: () => GracklePlugin;
}

/** Module-level singleton registry. Insertion order is preserved by Map. */
const registry = new Map<string, PluginRegistration>();

/**
 * Register a plugin with the global registry.
 *
 * Call this at module scope in each plugin package's entry point — the
 * registration fires as a side effect when the server imports the package.
 *
 * @param registration - The plugin's metadata and factory.
 * @throws If a plugin with the same name is already registered.
 */
export function registerPlugin(registration: PluginRegistration): void {
  if (registry.has(registration.name)) {
    throw new Error(
      `Plugin "${registration.name}" is already registered. Each plugin name must be unique.`,
    );
  }
  registry.set(registration.name, registration);
}

/**
 * Return all registered plugins in insertion order.
 *
 * The returned array is a snapshot — mutations do not affect the registry.
 */
export function getRegisteredPlugins(): ReadonlyArray<PluginRegistration> {
  return [...registry.values()].map((reg) => ({ ...reg }));
}

/**
 * Look up a single plugin registration by name.
 *
 * @param name - Plugin name to look up.
 */
export function getRegistration(name: string): PluginRegistration | undefined {
  return registry.get(name);
}

/**
 * Build the `GracklePlugin[]` array by consulting DB-persisted enabled state.
 *
 * For each registered plugin:
 * - Required plugins are always included regardless of DB state.
 * - Optional plugins are included when the DB says enabled, or when the DB
 *   has no row and `defaultEnabled` is true.
 *
 * @param getPluginEnabled - Callback that returns the DB-persisted enabled
 *   state for a plugin, or `undefined` if no row exists. Typically
 *   `pluginStore.getPluginEnabled`.
 * @returns Array of `GracklePlugin` instances ready for `loadPlugins()`.
 */
export function resolveEnabledPlugins(
  getPluginEnabled: (name: string) => boolean | undefined,
): GracklePlugin[] {
  const plugins: GracklePlugin[] = [];

  for (const registration of registry.values()) {
    const dbEnabled = getPluginEnabled(registration.name);
    const enabled = registration.required || (dbEnabled ?? registration.defaultEnabled);

    if (enabled) {
      plugins.push(registration.create());
    }
  }

  return plugins;
}

/**
 * Clear the registry. **Test-only** — resets state between test cases.
 */
export function clearRegistry(): void {
  registry.clear();
}
