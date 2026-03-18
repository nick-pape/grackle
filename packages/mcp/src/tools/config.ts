import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import { z } from "zod";
import type { ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

/** MCP tools for Grackle configuration settings. */
export const configTools: ToolDefinition[] = [
  // ── config_get_default_persona ──────────────────────────────────────────
  {
    name: "config_get_default_persona",
    group: "config",
    description:
      "Get the default persona ID used for new sessions when no persona is explicitly specified.",
    inputSchema: z.object({}),
    rpcMethod: "getSetting",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(_args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const response = await client.getSetting({ key: "default_persona_id" });
        return jsonResult({ key: response.key, value: response.value });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── config_set_default_persona ──────────────────────────────────────────
  {
    name: "config_set_default_persona",
    group: "config",
    description:
      "Set the default persona used for new sessions when no persona is explicitly specified.",
    inputSchema: z.object({
      personaId: z.string().describe("Persona ID to use as the default"),
    }),
    rpcMethod: "setSetting",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const { personaId } = args as { personaId: string };
        await client.setSetting({ key: "default_persona_id", value: personaId });
        return jsonResult({ success: true });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
