import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import { z } from "zod";
import type { ToolDefinition } from "../tool-registry.js";
import type { AuthContext } from "@grackle-ai/auth";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

/** MCP tools for Grackle finding management. */
export const findingTools: ToolDefinition[] = [
  {
    name: "finding_list",
    group: "finding",
    description: "Query findings for a workspace, optionally filtering by category and tags.",
    inputSchema: z.object({
      workspaceId: z.string().optional().describe("Workspace ID (auto-injected from session context when omitted)"),
      category: z.string().optional().describe("Filter by finding category"),
      tag: z.string().optional().describe("Filter by tag"),
      limit: z.number().int().positive().optional().describe("Maximum number of findings to return"),
    }),
    rpcMethod: "queryFindings",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      const workspaceId = args.workspaceId as string | undefined;
      if (!workspaceId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "workspaceId is required but was not provided or auto-injected. This session may not be associated with a workspace.", code: "INVALID_ARGUMENT" }, null, 2) }],
          isError: true,
        };
      }
      try {
        const response = await client.queryFindings({
          workspaceId,
          categories: args.category ? [args.category as string] : [],
          tags: args.tag ? [args.tag as string] : [],
          limit: (args.limit as number | undefined) ?? 0,
        });
        return jsonResult(
          response.findings.map((f) => ({
            id: f.id,
            workspaceId: f.workspaceId,
            taskId: f.taskId,
            sessionId: f.sessionId,
            category: f.category,
            title: f.title,
            content: f.content,
            tags: [...f.tags],
            createdAt: f.createdAt,
          })),
        );
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "finding_post",
    group: "finding",
    description: "Post a new finding to a workspace with a title, category, content, and tags.",
    inputSchema: z.object({
      workspaceId: z.string().optional().describe("Workspace ID (auto-injected from session context when omitted)"),
      title: z.string().describe("Finding title"),
      category: z.string().optional().describe("Finding category (e.g. 'bug', 'insight', 'risk')"),
      content: z.string().optional().describe("Detailed finding content"),
      tags: z.array(z.string()).optional().describe("Tags for the finding"),
    }),
    rpcMethod: "postFinding",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>, authContext?: AuthContext) {
      const workspaceId = args.workspaceId as string | undefined;
      if (!workspaceId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "workspaceId is required but was not provided or auto-injected. This session may not be associated with a workspace.", code: "INVALID_ARGUMENT" }, null, 2) }],
          isError: true,
        };
      }
      try {
        const finding = await client.postFinding({
          workspaceId,
          title: args.title as string,
          category: (args.category as string | undefined) ?? "",
          content: (args.content as string | undefined) ?? "",
          tags: (args.tags as string[] | undefined) ?? [],
          taskId: authContext?.type === "scoped" ? authContext.taskId : ((args.taskId as string | undefined) ?? ""),
          sessionId: authContext?.type === "scoped" ? authContext.taskSessionId : ((args.sessionId as string | undefined) ?? ""),
        });
        return jsonResult({
          id: finding.id,
          workspaceId: finding.workspaceId,
          category: finding.category,
          title: finding.title,
          content: finding.content,
          tags: [...finding.tags],
          createdAt: finding.createdAt,
        });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
