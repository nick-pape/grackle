import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import { z } from "zod";
import type { ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

/** MCP tools for Grackle environment management (list, add, provision, stop, destroy, remove, wake). */
export const envTools: ToolDefinition[] = [
  // ── env_list ─────────────────────────────────────────────────────────────
  {
    name: "env_list",
    group: "env",
    description:
      "List all registered Grackle environments with their status, adapter type, and default runtime.",
    inputSchema: z.object({}),
    rpcMethod: "listEnvironments",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(_args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const response = await client.listEnvironments({});
        return jsonResult(
          response.environments.map((e) => ({
            id: e.id,
            displayName: e.displayName,
            adapterType: e.adapterType,
            status: e.status,
          })),
        );
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── env_add ──────────────────────────────────────────────────────────────
  {
    name: "env_add",
    group: "env",
    description:
      "Register a new environment with Grackle by specifying its adapter type, display name, and optional configuration.",
    inputSchema: z.object({
      displayName: z.string().describe("Human-readable name for the environment"),
      adapterType: z.string().describe("Adapter type (e.g. 'ssh', 'codespace', 'local')"),
      adapterConfig: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Adapter-specific configuration as a JSON object"),
    }),
    rpcMethod: "addEnvironment",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const parsed = args as {
          displayName: string;
          adapterType: string;
          adapterConfig?: Record<string, unknown>;
        };
        const response = await client.addEnvironment({
          displayName: parsed.displayName,
          adapterType: parsed.adapterType,
          adapterConfig: parsed.adapterConfig
            ? JSON.stringify(parsed.adapterConfig)
            : "",
        });
        return jsonResult(response);
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── env_provision ────────────────────────────────────────────────────────
  {
    name: "env_provision",
    group: "env",
    description:
      "Provision an environment — start its backing resources, install the PowerLine agent, and connect it to the server.",
    inputSchema: z.object({
      environmentId: z.string().describe("ID of the environment to provision"),
    }),
    rpcMethod: "provisionEnvironment",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      const { environmentId } = args as { environmentId: string };
      const events: { stage: string; message: string; progress: number }[] = [];
      try {
        for await (const event of client.provisionEnvironment({
          id: environmentId,
        })) {
          events.push({
            stage: event.stage,
            message: event.message,
            progress: event.progress,
          });
        }
        return jsonResult({ events, finalStatus: "success" });
      } catch (error) {
        try {
          return grpcErrorToToolResult(error);
        } catch {
          // grpcErrorToToolResult re-throws non-ConnectError; wrap with collected events
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  events,
                  finalStatus: "error",
                  error: error instanceof Error ? error.message : String(error),
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
      }
    },
  },

  // ── env_stop ─────────────────────────────────────────────────────────────
  {
    name: "env_stop",
    group: "env",
    description:
      "Stop a running environment without destroying its backing resources. It can be woken later.",
    inputSchema: z.object({
      environmentId: z.string().describe("ID of the environment to stop"),
    }),
    rpcMethod: "stopEnvironment",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const { environmentId } = args as { environmentId: string };
        await client.stopEnvironment({ id: environmentId });
        return jsonResult({ success: true });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── env_destroy ──────────────────────────────────────────────────────────
  {
    name: "env_destroy",
    group: "env",
    description:
      "Destroy an environment's backing resources (e.g. delete the codespace or VM). The environment registration is kept.",
    inputSchema: z.object({
      environmentId: z.string().describe("ID of the environment to destroy"),
    }),
    rpcMethod: "destroyEnvironment",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const { environmentId } = args as { environmentId: string };
        await client.destroyEnvironment({ id: environmentId });
        return jsonResult({ success: true });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── env_remove ───────────────────────────────────────────────────────────
  {
    name: "env_remove",
    group: "env",
    description:
      "Remove an environment registration from Grackle. The environment must be stopped first.",
    inputSchema: z.object({
      environmentId: z.string().describe("ID of the environment to remove"),
    }),
    rpcMethod: "removeEnvironment",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const { environmentId } = args as { environmentId: string };
        await client.removeEnvironment({ id: environmentId });
        return jsonResult({ success: true });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── env_wake ─────────────────────────────────────────────────────────────
  {
    name: "env_wake",
    group: "env",
    description:
      "Wake a stopped environment by re-provisioning it. This starts its backing resources and reconnects the PowerLine agent.",
    inputSchema: z.object({
      environmentId: z
        .string()
        .describe("ID of the stopped environment to wake"),
    }),
    rpcMethod: "provisionEnvironment",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      const { environmentId } = args as { environmentId: string };
      const events: { stage: string; message: string; progress: number }[] = [];
      try {
        for await (const event of client.provisionEnvironment({
          id: environmentId,
        })) {
          events.push({
            stage: event.stage,
            message: event.message,
            progress: event.progress,
          });
        }
        return jsonResult({ events, finalStatus: "success" });
      } catch (error) {
        try {
          return grpcErrorToToolResult(error);
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  events,
                  finalStatus: "error",
                  error: error instanceof Error ? error.message : String(error),
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
      }
    },
  },
];
