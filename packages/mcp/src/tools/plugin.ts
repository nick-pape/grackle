import { z } from "zod";
import type { GrackleClients, ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

/** MCP tools for managing Grackle plugins. */
export const pluginTools: ToolDefinition[] = [
  {
    name: "plugin_list",
    group: "system",
    description:
      "List all known Grackle plugins with their current state (enabled, loaded, required).",
    inputSchema: z.object({}),
    rpcMethod: "listPlugins",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(_args: Record<string, unknown>, { core: client }: GrackleClients) {
      try {
        const res = await client.listPlugins({});
        return jsonResult(res.plugins);
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "plugin_set_enabled",
    group: "system",
    description:
      "Enable or disable a Grackle plugin. The change is persisted but a server restart is required for it to take effect. Core plugins cannot be disabled.",
    inputSchema: z.object({
      name: z.string().describe("Plugin name (e.g. orchestration, scheduling, knowledge)"),
      enabled: z.boolean().describe("True to enable the plugin, false to disable it"),
    }),
    rpcMethod: "setPluginEnabled",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { core: client }: GrackleClients) {
      try {
        const { name, enabled } = args as { name: string; enabled: boolean };
        const res = await client.setPluginEnabled({ name, enabled });
        return jsonResult({
          name: res.name,
          enabled: res.enabled,
          loaded: res.loaded,
          restartRequired: res.enabled !== res.loaded,
        });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
