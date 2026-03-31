/**
 * Client-side plugin registry — maps plugin names to their UI contributions.
 *
 * For Phase 1 (static bundling), all plugin UI lives in this package.
 * The manifest tells the app which plugins are active; this registry
 * maps names to nav tabs and domain hook keys.
 *
 * @module
 */

import type { AppTab } from "@grackle-ai/web-components";
import { TABS } from "@grackle-ai/web-components";

/** Views contributed by the core plugin. */
const CORE_VIEWS: ReadonlySet<string> = new Set(["dashboard", "chat", "environments", "settings"]);

/** Views contributed by the orchestration plugin. */
const ORCHESTRATION_VIEWS: ReadonlySet<string> = new Set(["tasks", "findings"]);

/** Views contributed by the knowledge plugin. */
const KNOWLEDGE_VIEWS: ReadonlySet<string> = new Set(["knowledge"]);

/** Client-side UI entry for a single plugin. */
export interface PluginClientEntry {
  /** Navigation tabs contributed by this plugin, in display order. */
  navItems: AppTab[];
  /** Keys of domain hooks that belong to this plugin (used to filter useGrackleSocket). */
  domainHookKeys: string[];
}

/**
 * Static registry mapping plugin names to their web UI contributions.
 *
 * When the manifest says a plugin is active, its nav items appear in the
 * sidebar and its domain hooks are registered for event handling.
 *
 * Nav items are derived from the canonical TABS definition in AppNav so
 * icons, routes, and test IDs remain a single source of truth.
 */
export const PLUGIN_REGISTRY: Readonly<Record<string, PluginClientEntry | undefined>> = {
  core: {
    navItems: TABS.filter((t) => CORE_VIEWS.has(t.view)),
    domainHookKeys: ["environments", "sessions", "workspaces", "tokens", "credentials", "codespaces", "plugins"],
  },
  orchestration: {
    navItems: TABS.filter((t) => ORCHESTRATION_VIEWS.has(t.view)),
    domainHookKeys: ["tasks", "findings", "personas", "notifications"],
  },
  scheduling: {
    navItems: [],
    domainHookKeys: ["schedules"],
  },
  knowledge: {
    navItems: TABS.filter((t) => KNOWLEDGE_VIEWS.has(t.view)),
    domainHookKeys: ["knowledge"],
  },
};

/**
 * Build the ordered list of nav tabs for the given active plugin names.
 *
 * Tabs appear in the order defined in each plugin's `navItems` array,
 * with plugins applied in the order they appear in `pluginNames`.
 */
export function buildTabs(pluginNames: string[]): AppTab[] {
  return pluginNames.flatMap((name) => PLUGIN_REGISTRY[name]?.navItems ?? []);
}

/**
 * Build the set of active domain hook keys for the given active plugin names.
 */
export function buildActiveHookKeys(pluginNames: string[]): Set<string> {
  return new Set(pluginNames.flatMap((name) => PLUGIN_REGISTRY[name]?.domainHookKeys ?? []));
}
