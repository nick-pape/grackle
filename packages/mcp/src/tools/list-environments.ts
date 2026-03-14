import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import type { ToolDefinition, ToolResult } from "../tool-registry.js";

/** MCP tool that lists all registered Grackle environments. */
export const listEnvironmentsTool: ToolDefinition = {
  name: "list_environments",
  description: "List all registered Grackle environments with their connection status, adapter type, and configuration.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(_args: Record<string, unknown>, client: Client<typeof grackle.Grackle>): Promise<ToolResult> {
    const response = await client.listEnvironments({});
    const environments = response.environments.map((env) => ({
      id: env.id,
      displayName: env.displayName,
      adapterType: env.adapterType,
      status: env.status,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(environments, null, 2) }],
    };
  },
};
