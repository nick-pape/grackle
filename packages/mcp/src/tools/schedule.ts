import { z } from "zod";
import type { GrackleClients, ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

/** Serialize a Schedule proto message to a plain object. */
function serializeSchedule(s: {
  id: string;
  title: string;
  description: string;
  scheduleExpression: string;
  personaId: string;
  environmentId: string;
  workspaceId: string;
  parentTaskId: string;
  enabled: boolean;
  lastRunAt: string;
  nextRunAt: string;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}): Record<string, unknown> {
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    scheduleExpression: s.scheduleExpression,
    personaId: s.personaId,
    environmentId: s.environmentId || "",
    workspaceId: s.workspaceId || "",
    parentTaskId: s.parentTaskId || "",
    enabled: s.enabled,
    lastRunAt: s.lastRunAt || "",
    nextRunAt: s.nextRunAt || "",
    runCount: s.runCount,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** MCP tools for Grackle schedule management. */
export const scheduleTools: ToolDefinition[] = [
  {
    name: "schedule_list",
    group: "schedule",
    description: "List all scheduled triggers, optionally filtered by workspace.",
    inputSchema: z.object({
      workspaceId: z.string().optional().describe("Filter by workspace ID"),
    }),
    rpcMethod: "listSchedules",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { scheduling: client }: GrackleClients) {
      try {
        const response = await client.listSchedules({
          workspaceId: (args.workspaceId as string | undefined) ?? "",
        });
        return jsonResult(response.schedules.map(serializeSchedule));
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "schedule_create",
    group: "schedule",
    description: "Create a new scheduled trigger that fires a persona on a cadence. Use interval shorthand (e.g. '30s', '5m', '1h') or cron expressions (e.g. '0 9 * * MON').",
    inputSchema: z.object({
      title: z.string().describe("Human-readable title for the schedule"),
      scheduleExpression: z.string().describe("Interval shorthand (e.g. '30s', '5m') or 5-field cron expression (e.g. '0 9 * * MON')"),
      personaId: z.string().describe("Persona ID to use when firing"),
      description: z.string().optional().describe("Optional description"),
      environmentId: z.string().optional().describe("Environment to run on (empty = auto-select)"),
      workspaceId: z.string().optional().describe("Workspace scope (empty = system-level)"),
      parentTaskId: z.string().optional().describe("Parent task for spawned children (empty = root task)"),
    }),
    rpcMethod: "createSchedule",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { scheduling: client }: GrackleClients) {
      try {
        const response = await client.createSchedule({
          title: args.title as string,
          scheduleExpression: args.scheduleExpression as string,
          personaId: args.personaId as string,
          description: (args.description as string | undefined) ?? "",
          environmentId: (args.environmentId as string | undefined) ?? "",
          workspaceId: (args.workspaceId as string | undefined) ?? "",
          parentTaskId: (args.parentTaskId as string | undefined) ?? "",
        });
        return jsonResult(serializeSchedule(response));
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "schedule_show",
    group: "schedule",
    description: "Get details of a specific schedule by ID.",
    inputSchema: z.object({
      scheduleId: z.string().describe("Schedule ID"),
    }),
    rpcMethod: "getSchedule",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { scheduling: client }: GrackleClients) {
      try {
        const response = await client.getSchedule({
          id: args.scheduleId as string,
        });
        return jsonResult(serializeSchedule(response));
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "schedule_update",
    group: "schedule",
    description: "Update a schedule's configuration. Only provided fields are changed.",
    inputSchema: z.object({
      scheduleId: z.string().describe("Schedule ID"),
      title: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      scheduleExpression: z.string().optional().describe("New schedule expression"),
      personaId: z.string().optional().describe("New persona ID"),
      environmentId: z.string().optional().describe("New environment ID"),
      enabled: z.boolean().optional().describe("Enable or disable the schedule"),
    }),
    rpcMethod: "updateSchedule",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { scheduling: client }: GrackleClients) {
      try {
        const response = await client.updateSchedule({
          id: args.scheduleId as string,
          title: (args.title as string | undefined) ?? undefined,
          description: (args.description as string | undefined) ?? undefined,
          scheduleExpression: (args.scheduleExpression as string | undefined) ?? undefined,
          personaId: (args.personaId as string | undefined) ?? undefined,
          environmentId: (args.environmentId as string | undefined) ?? undefined,
          enabled: args.enabled as boolean | undefined,
        });
        return jsonResult(serializeSchedule(response));
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "schedule_delete",
    group: "schedule",
    description: "Delete a schedule. Running tasks spawned by this schedule are not affected.",
    inputSchema: z.object({
      scheduleId: z.string().describe("Schedule ID"),
    }),
    rpcMethod: "deleteSchedule",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { scheduling: client }: GrackleClients) {
      try {
        await client.deleteSchedule({
          id: args.scheduleId as string,
        });
        return jsonResult({ deleted: true });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
