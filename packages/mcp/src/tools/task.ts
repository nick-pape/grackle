import type { Client } from "@connectrpc/connect";
import {
  type grackle,
  taskStatusToEnum,
  taskStatusToString,
  issueStateToEnum,
} from "@grackle-ai/common";
import { z } from "zod";
import type { ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

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
      "List all tasks in a Grackle project with their status, title, and assignment information. Supports optional search and status filters.",
    inputSchema: z.object({
      projectId: z.string().describe("The project ID to list tasks for"),
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
          projectId: args.projectId as string,
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
      "Create a new task in a Grackle project with a title, optional description, and dependency configuration.",
    inputSchema: z.object({
      projectId: z.string().describe("The project ID to create the task in"),
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
      defaultPersonaId: z
        .string()
        .optional()
        .describe("Default persona for this task (overrides project default)"),
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
          projectId: args.projectId as string,
          title: args.title as string,
          description: (args.description as string | undefined) ?? "",
          dependsOn: (args.dependsOn as string[] | undefined) ?? [],
          parentTaskId: (args.parentTaskId as string | undefined) ?? "",
          defaultPersonaId: (args.defaultPersonaId as string | undefined) ?? "",
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
      "Start a task by spawning an AI agent session to work on it, with optional runtime and model configuration.",
    inputSchema: z.object({
      taskId: z.string().describe("The ID of the task to start"),
      personaId: z
        .string()
        .optional()
        .describe("Persona ID override (falls back to task/project/app default)"),
      environmentId: z
        .string()
        .optional()
        .describe("Environment ID to run the task on (defaults to project default)"),
      notes: z
        .string()
        .optional()
        .describe("Feedback/instructions for retry (included in system context)"),
    }),
    rpcMethod: "startTask",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const response = await client.startTask({
          taskId: args.taskId as string,
          personaId: (args.personaId as string | undefined) ?? "",
          environmentId: (args.environmentId as string | undefined) ?? "",
          notes: (args.notes as string | undefined) ?? "",
        });
        return jsonResult(response);
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
      "Permanently delete a task from the project. This action cannot be undone.",
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
        await client.deleteTask({
          id: args.taskId as string,
        });
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
      "Mark a task as complete (human-authoritative — sticky status).",
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
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const task = await client.completeTask({
          id: args.taskId as string,
        });
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

  // ── task_import_github ──────────────────────────────────────────────────
  {
    name: "task_import_github",
    group: "task",
    description:
      "Import GitHub issues from a repository as tasks into a Grackle project, with optional label and state filtering.",
    inputSchema: z.object({
      projectId: z.string().describe("The project ID to import tasks into"),
      repo: z
        .string()
        .describe("GitHub repository in owner/repo format (e.g. octocat/hello-world)"),
      label: z
        .string()
        .optional()
        .describe("Only import issues with this label"),
      state: z
        .enum(["open", "closed"])
        .optional()
        .default("open")
        .describe("Issue state to filter by (open or closed, defaults to open)"),
      environmentId: z
        .string()
        .optional()
        .describe("Environment ID to associate with imported tasks"),
      includeComments: z
        .boolean()
        .optional()
        .describe("Whether to include issue comments in the task description"),
    }),
    rpcMethod: "importGitHubIssues",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const stateString = (args.state as string | undefined) ?? "open";
        const stateValue = issueStateToEnum(stateString);
        const response = await client.importGitHubIssues({
          projectId: args.projectId as string,
          repo: args.repo as string,
          label: (args.label as string | undefined) ?? "",
          state: stateValue,
          environmentId: (args.environmentId as string | undefined) ?? "",
          includeComments: (args.includeComments as boolean | undefined) ?? true,
        });
        return jsonResult({
          imported: response.imported,
          linked: response.linked,
          skipped: response.skipped,
        });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
