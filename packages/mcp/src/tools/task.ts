import type { Client } from "@connectrpc/connect";
import {
  type grackle,
  taskStatusToEnum,
  taskStatusToString,
  ROOT_TASK_ID,
} from "@grackle-ai/common";
import { z } from "zod";
import type { ToolDefinition } from "../tool-registry.js";
import type { AuthContext } from "@grackle-ai/auth";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";
import { assertCallerIsAncestor } from "../scope-enforcement.js";

/** Convert a proto Task message to a plain object with human-readable status. */
function taskToJson(task: grackle.Task): Record<string, unknown> {
  return {
    ...task,
    status: taskStatusToString(task.status) || task.status,
  };
}

/** MCP tools for Grackle task management (list, create, show, update, start, delete, complete, resume, import). */
export const taskTools: ToolDefinition[] = [
  // ── task_list ───────────────────────────────────────────────────────────
  {
    name: "task_list",
    group: "task",
    description:
      "List all tasks in a Grackle workspace with their status, title, and assignment information. Supports optional search and status filters.",
    inputSchema: z.object({
      workspaceId: z.string().optional().describe("The workspace ID to list tasks for (optional — omit to list all tasks)"),
      search: z.string().optional().describe("Case-insensitive substring filter on task title or description"),
      status: z.string().optional().describe("Filter by task status: not_started, working, paused, complete, failed"),
    }),
    rpcMethod: "listTasks",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const response = await client.listTasks({
          workspaceId: (args.workspaceId as string | undefined) ?? "",
          search: (args.search as string) || "",
          status: (args.status as string) || "",
        });
        const summaries = response.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: taskStatusToString(task.status) || task.status,
          branch: task.branch,
          latestSessionId: task.latestSessionId,
          sortOrder: task.sortOrder,
          parentTaskId: task.parentTaskId,
          depth: task.depth,
          childTaskIds: task.childTaskIds,
        }));
        return jsonResult(summaries);
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── task_create ─────────────────────────────────────────────────────────
  {
    name: "task_create",
    group: "task",
    description:
      "Create a new task in a Grackle workspace with a title, optional description, and dependency configuration.",
    inputSchema: z.object({
      workspaceId: z.string().optional().describe("The workspace ID to create the task in (optional — omit for root tasks)"),
      title: z.string().describe("Short descriptive title for the task"),
      description: z
        .string()
        .optional()
        .describe("Detailed description of what the task involves"),
      dependsOn: z
        .array(z.string())
        .optional()
        .describe("Array of task IDs that this task depends on"),
      parentTaskId: z
        .string()
        .optional()
        .describe("Parent task ID (auto-set when called by an agent working on a task)"),
      canDecompose: z
        .boolean()
        .optional()
        .describe("Allow this task to create subtasks"),
      defaultPersonaId: z
        .string()
        .optional()
        .describe("Default persona for this task (overrides workspace default)"),
      tokenBudget: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Token budget (input + output); 0 = unlimited"),
      costBudgetMillicents: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Cost budget in millicents ($0.00001 units); 0 = unlimited"),
    }),
    rpcMethod: "createTask",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const task = await client.createTask({
          workspaceId: (args.workspaceId as string | undefined) ?? "",
          title: args.title as string,
          description: (args.description as string | undefined) ?? "",
          dependsOn: (args.dependsOn as string[] | undefined) ?? [],
          parentTaskId: (args.parentTaskId as string | undefined) ?? "",
          canDecompose: (args.canDecompose as boolean | undefined) ?? false,
          defaultPersonaId: (args.defaultPersonaId as string | undefined) ?? "",
          tokenBudget: (args.tokenBudget as number | undefined) ?? 0,
          costBudgetMillicents: (args.costBudgetMillicents as number | undefined) ?? 0,
        });
        return jsonResult(taskToJson(task));
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── task_show ───────────────────────────────────────────────────────────
  {
    name: "task_show",
    group: "task",
    description:
      "Get full details of a specific task including its status, dependencies, timestamps, and review notes.",
    inputSchema: z.object({
      taskId: z.string().describe("The ID of the task to retrieve"),
    }),
    rpcMethod: "getTask",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const task = await client.getTask({
          id: args.taskId as string,
        });
        return jsonResult(taskToJson(task));
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── task_update ─────────────────────────────────────────────────────────
  {
    name: "task_update",
    group: "task",
    description:
      "Update a task's title, description, status, dependencies, or bind a running session to it.",
    inputSchema: z.object({
      taskId: z.string().describe("The ID of the task to update"),
      title: z.string().optional().describe("New title for the task"),
      description: z
        .string()
        .optional()
        .describe("New description for the task"),
      status: z
        .enum([
          "not_started",
          "working",
          "paused",
          "complete",
          "failed",
        ])
        .optional()
        .describe(
          "New status for the task (not_started, working, paused, complete, failed)",
        ),
      dependsOn: z
        .array(z.string())
        .optional()
        .describe("Updated array of task IDs that this task depends on"),
      sessionId: z
        .string()
        .optional()
        .describe("Bind an existing running session to this task (late-bind)"),
      tokenBudget: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Token budget (input + output); 0 = unlimited"),
      costBudgetMillicents: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Cost budget in millicents ($0.00001 units); 0 = unlimited"),
    }),
    rpcMethod: "updateTask",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const taskId = args.taskId as string;
        if (taskId === ROOT_TASK_ID && args.status) {
          return { content: [{ type: "text", text: "Cannot change the status of the system task" }], isError: true };
        }
        const statusString = args.status as string | undefined;
        const statusValue = statusString
          ? taskStatusToEnum(statusString)
          : 0;
        const task = await client.updateTask({
          id: args.taskId as string,
          title: (args.title as string | undefined) ?? "",
          description: (args.description as string | undefined) ?? "",
          status: statusValue,
          dependsOn: (args.dependsOn as string[] | undefined) ?? [],
          sessionId: (args.sessionId as string | undefined) ?? "",
          tokenBudget: (args.tokenBudget as number | undefined) ?? 0,
          costBudgetMillicents: (args.costBudgetMillicents as number | undefined) ?? 0,
        });
        return jsonResult(taskToJson(task));
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── task_start ──────────────────────────────────────────────────────────
  {
    name: "task_start",
    group: "task",
    description:
      "Start a task by spawning an AI agent session to work on it. Runtime and model come from the resolved persona.",
    inputSchema: z.object({
      taskId: z.string().describe("The ID of the task to start"),
      personaId: z
        .string()
        .optional()
        .describe("Persona ID override (falls back to task/workspace/app default)"),
      environmentId: z
        .string()
        .optional()
        .describe("Environment ID to run the task on (defaults to workspace default)"),
      notes: z
        .string()
        .optional()
        .describe("Feedback/instructions for retry (included in system context)"),
      pipe: z
        .enum(["sync", "async", "detach"])
        .optional()
        .describe("IPC pipe mode: sync (block until done), async (receive results between turns), detach (fire-and-forget)"),
    }),
    rpcMethod: "startTask",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>, authContext?: AuthContext) {
      try {
        await assertCallerIsAncestor(client, authContext, args.taskId as string);
        const pipe = (args.pipe as string) || "";
        const parentSessionId = authContext?.type === "scoped" ? authContext.taskSessionId : "";

        // Reject sync/async pipe modes without scoped auth (same guard as ipc_spawn)
        if (pipe && pipe !== "detach" && !parentSessionId) {
          return {
            content: [{ type: "text" as const, text: "Error: sync and async pipe modes require scoped auth (agent context)" }],
            isError: true,
          };
        }

        const response = await client.startTask({
          taskId: args.taskId as string,
          personaId: (args.personaId as string | undefined) ?? "",
          environmentId: (args.environmentId as string | undefined) ?? "",
          notes: (args.notes as string | undefined) ?? "",
          pipe,
          parentSessionId,
        });

        // Consistent response envelope across all pipe modes
        const base = { sessionId: response.id, taskId: args.taskId as string };

        if (pipe === "sync") {
          const result = await client.waitForPipe({
            sessionId: parentSessionId,
            fd: response.pipeFd,
          });
          return jsonResult({
            ...base,
            output: result.content,
            senderSessionId: result.senderSessionId,
          });
        }

        if (pipe === "async") {
          return jsonResult({
            ...base,
            fd: response.pipeFd,
          });
        }

        return jsonResult(base);
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── task_delete ─────────────────────────────────────────────────────────
  {
    name: "task_delete",
    group: "task",
    description:
      "Permanently delete a task from the workspace. This action cannot be undone.",
    inputSchema: z.object({
      taskId: z.string().describe("The ID of the task to delete"),
    }),
    rpcMethod: "deleteTask",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const taskId = args.taskId as string;
        if (taskId === ROOT_TASK_ID) {
          return { content: [{ type: "text", text: "Cannot delete the system task" }], isError: true };
        }
        await client.deleteTask({ id: taskId });
        return jsonResult({ success: true });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── task_complete ────────────────────────────────────────────────────────
  {
    name: "task_complete",
    group: "task",
    description:
      "Mark a child or descendant task as complete. Cannot be used on your own task — only ancestors can complete a task. Human-authoritative (sticky status).",
    inputSchema: z.object({
      taskId: z.string().describe("The ID of the task to complete"),
    }),
    rpcMethod: "completeTask",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>, authContext?: AuthContext) {
      try {
        const taskId = args.taskId as string;
        if (taskId === ROOT_TASK_ID) {
          return { content: [{ type: "text", text: "Cannot complete the system task" }], isError: true };
        }
        await assertCallerIsAncestor(client, authContext, taskId);
        const task = await client.completeTask({ id: taskId });
        return jsonResult(taskToJson(task));
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  // ── task_resume ─────────────────────────────────────────────────────────
  {
    name: "task_resume",
    group: "task",
    description:
      "Resume the latest interrupted or completed session for a task.",
    inputSchema: z.object({
      taskId: z.string().describe("The ID of the task to resume"),
    }),
    rpcMethod: "resumeTask",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const session = await client.resumeTask({
          id: args.taskId as string,
        });
        return jsonResult(session);
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

];
