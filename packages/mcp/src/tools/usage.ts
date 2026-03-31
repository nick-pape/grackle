import { z } from "zod";
import type { GrackleClients, ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

/** MCP tools for querying session usage and cost data. */
export const usageTools: ToolDefinition[] = [
  {
    name: "usage_get",
    group: "usage",
    description: "Get aggregated token usage and cost for a session, task, task tree, workspace, or environment. Returns input/output token counts, USD cost, and session count.",
    inputSchema: z.object({
      scope: z.enum(["session", "task", "task_tree", "workspace", "environment"])
        .describe("What to aggregate over: a single session, a task's sessions, a task and all subtasks, a workspace, or an environment"),
      id: z.string().min(1)
        .describe("The ID of the entity to query (session ID, task ID, workspace ID, or environment ID)"),
    }),
    rpcMethod: "getUsage",
    mutating: false,
    annotations: { readOnlyHint: true },
    handler: async (args: Record<string, unknown>, { core: client }: GrackleClients) => {
      try {
        const result = await client.getUsage({ scope: args.scope as string, id: args.id as string });
        return jsonResult(result);
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
