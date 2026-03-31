/**
 * Domain hook for plugin management.
 *
 * Uses ConnectRPC for listing and toggling plugins. Domain events
 * (plugin.changed) from the event bus trigger re-fetches.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { PluginData, UsePluginsResult, GrackleEvent } from "@grackle-ai/web-components";
import type { DomainHook } from "./domainHook.js";
import { coreClient as grackleClient } from "./useGrackleClient.js";
import { useLoadingState } from "./useLoadingState.js";

export type { UsePluginsResult } from "@grackle-ai/web-components";

/**
 * Hook that manages plugin state and enable/disable actions via ConnectRPC.
 *
 * @returns Plugin state, actions, and the domain hook lifecycle object.
 */
export function usePlugins(): UsePluginsResult {
  const [plugins, setPlugins] = useState<PluginData[]>([]);
  const { loading: pluginsLoading, track: trackPlugins } = useLoadingState();

  const loadPlugins = useCallback(async () => {
    try {
      const resp = await trackPlugins(grackleClient.listPlugins({}));
      setPlugins(
        resp.plugins.map((p) => ({
          name: p.name,
          description: p.description,
          enabled: p.enabled,
          required: p.required,
          loaded: p.loaded,
        })),
      );
    } catch {
      // empty
    }
  }, [trackPlugins]);

  const handleEvent = useCallback((event: GrackleEvent): boolean => {
    if (event.type === "plugin.changed") {
      loadPlugins().catch(() => {});
      return true;
    }
    return false;
  }, [loadPlugins]);

  const setPluginEnabled = useCallback(async (name: string, enabled: boolean): Promise<void> => {
    try {
      const resp = await grackleClient.setPluginEnabled({ name, enabled });
      setPlugins((prev) =>
        prev.map((p) =>
          p.name === resp.name ? { ...p, enabled: resp.enabled } : p,
        ),
      );
    } catch {
      // empty
    }
  }, []);

  const domainHook: DomainHook = {
    onConnect: () => loadPlugins(),
    onDisconnect: () => {},
    handleEvent,
  };

  return { plugins, pluginsLoading, loadPlugins, setPluginEnabled, domainHook };
}
