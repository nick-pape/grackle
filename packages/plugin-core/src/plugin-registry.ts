/**
 * Server-side plugin registry — delegates to the plugin-sdk global registry
 * for metadata, plus runtime tracking of which plugins are currently loaded.
 *
 * @module
 */

import { getRegisteredPlugins } from "@grackle-ai/plugin-sdk";

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
 * Get all registered plugin metadata from the global plugin registry.
 *
 * Returns entries in registration order (deterministic — set by import order
 * in the server). Replaces the old static `PLUGIN_REGISTRY` array.
 */
export function getPluginRegistry(): ReadonlyArray<PluginRegistryEntry> {
  return getRegisteredPlugins().map((reg) => ({
    name: reg.name,
    description: reg.description,
    required: reg.required,
    defaultEnabled: reg.defaultEnabled,
  }));
}

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
