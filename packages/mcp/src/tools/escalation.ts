import { z } from "zod";
import type { GrackleClients, ToolDefinition } from "../tool-registry.js";
import type { AuthContext } from "@grackle-ai/auth";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

/** MCP tools for human escalation and notification management. */
export const escalationTools: ToolDefinition[] = [
  {
    name: "escalate_to_human",
    group: "escalation",
    description: "Escalate a question or decision to the human. Use when you cannot proceed without human input. The message is delivered via configured notification channels (browser notification, webhook, etc.).",
    inputSchema: z.object({
      message: z.string().describe("The question or context the human needs to address"),
      urgency: z.enum(["low", "normal", "high"]).optional().describe("Urgency hint for notification routing (default: normal)"),
    }),
    rpcMethod: "createEscalation",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async handler(args: Record<string, unknown>, { orchestration: client }: GrackleClients, authContext?: AuthContext) {
      const message = args.message as string;
      if (!message) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "message is required", code: "INVALID_ARGUMENT" }, null, 2) }],
          isError: true,
        };
      }
      try {
        const escalation = await client.createEscalation({
          workspaceId: authContext?.type === "scoped" ? authContext.workspaceId ?? "" : "",
          taskId: authContext?.type === "scoped" ? authContext.taskId : "",
          title: "Human escalation",
          message,
          urgency: (args.urgency as string | undefined) ?? "normal",
        });
        return jsonResult({
          id: escalation.id,
          status: escalation.status,
          message: "Escalation persisted and routed to available notification channels.",
        });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "escalation_list",
    group: "escalation",
    description: "List recent escalations and their delivery status.",
    inputSchema: z.object({
      workspaceId: z.string().optional().describe("Filter by workspace ID"),
      status: z.enum(["pending", "delivered", "acknowledged"]).optional().describe("Filter by status"),
      limit: z.number().int().positive().optional().describe("Maximum number of results"),
    }),
    rpcMethod: "listEscalations",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { orchestration: client }: GrackleClients) {
      try {
        const response = await client.listEscalations({
          workspaceId: (args.workspaceId as string | undefined) ?? "",
          status: (args.status as string | undefined) ?? "",
          limit: (args.limit as number | undefined) ?? 0,
        });
        return jsonResult(
          response.escalations.map((e) => ({
            id: e.id,
            taskId: e.taskId,
            title: e.title,
            message: e.message,
            source: e.source,
            urgency: e.urgency,
            status: e.status,
            createdAt: e.createdAt,
            deliveredAt: e.deliveredAt,
          })),
        );
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "escalation_acknowledge",
    group: "escalation",
    description: "Acknowledge an escalation (mark as seen by the human).",
    inputSchema: z.object({
      id: z.string().describe("Escalation ID to acknowledge"),
    }),
    rpcMethod: "acknowledgeEscalation",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { orchestration: client }: GrackleClients) {
      try {
        const escalation = await client.acknowledgeEscalation({
          id: args.id as string,
        });
        return jsonResult({
          id: escalation.id,
          status: escalation.status,
          acknowledgedAt: escalation.acknowledgedAt,
        });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
