/**
 * Server-side plugin registry — static metadata for all known plugins, plus
 * runtime tracking of which plugins are currently loaded.
 *
 * @module
 */

/** Metadata for a single plugin known to the server. */
export interface PluginRegistryEntry {
  /** Plugin name (matches the name used in `loadPlugins` and the `plugins` DB table). */
  name: string;
  /** Human-readable description shown in the UI and CLI. */
  description: string;
  /** True for the core plugin — required and cannot be disabled. */
  required: boolean;
  /** Default enabled state (used as fallback when no DB row exists). */
  defaultEnabled: boolean;
}

/**
 * Static registry of all plugins known to the server.
 *
 * The order determines display order in list outputs.
 */
export const PLUGIN_REGISTRY: ReadonlyArray<PluginRegistryEntry> = [
  {
    name: "core",
    description: "Core infrastructure — environments, sessions, workspaces, tokens, settings",
    required: true,
    defaultEnabled: true,
  },
  {
    name: "orchestration",
    description: "Task orchestration — tasks, personas, findings, escalations",
    required: false,
    defaultEnabled: true,
  },
  {
    name: "scheduling",
    description: "Scheduled triggers — cron and interval-based task automation",
    required: false,
    defaultEnabled: true,
  },
  {
    name: "knowledge",
    description: "Knowledge graph — semantic search and relationship mapping",
    required: false,
    defaultEnabled: true,
  },
];

/** Set of plugin names that are currently loaded (running) in this server instance. */
let loadedPluginNames: Set<string> = new Set();

/**
 * Update the set of loaded plugin names.
 * Called by the server after `loadPlugins()` completes.
 *
 * @param names - The set of plugin names that successfully loaded.
 */
export function setLoadedPluginNames(names: Set<string>): void {
  loadedPluginNames = names;
}

/**
 * Check whether a plugin is currently loaded (running) in this server instance.
 *
 * @param name - Plugin name to check.
 */
export function isPluginLoaded(name: string): boolean {
  return loadedPluginNames.has(name);
}
