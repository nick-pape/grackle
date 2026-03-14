import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import type { ToolDefinition, ToolResult } from "../tool-registry.js";

/** MCP tool that lists all Grackle projects. */
export const listProjectsTool: ToolDefinition = {
  name: "list_projects",
  description: "List all Grackle projects with their names, descriptions, and associated repositories.",
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
    const response = await client.listProjects({});
    const projects = response.projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      repoUrl: project.repoUrl,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
    };
  },
};
