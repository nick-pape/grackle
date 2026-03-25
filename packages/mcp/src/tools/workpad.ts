import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import { z } from "zod";
import type { ToolDefinition } from "../tool-registry.js";
import type { AuthContext } from "@grackle-ai/auth";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";
import { assertCallerIsSelfOrAncestor } from "../scope-enforcement.js";

/** Resolve the effective taskId from explicit args or scoped auth context. */
function resolveTaskId(args: Record<string, unknown>, authContext?: AuthContext): string | undefined {
  if (args.taskId) {
    return args.taskId as string;
  }
  if (authContext?.type === "scoped") {
    return authContext.taskId;
  }
  return undefined;
}

/** MCP tools for reading and writing task workpads. */
export const workpadTools: ToolDefinition[] = [
  {
    name: "workpad_write",
    group: "workpad",
    description: "Write persistent structured context (workpad) to a task. Call before completing your work to record what was accomplished.",
    inputSchema: z.object({
      taskId: z.string().optional().describe("Task ID to write workpad for (defaults to current task)"),
      status: z.string().optional().describe("Agent-reported status (e.g. 'in progress', 'completed', 'blocked')"),
      summary: z.string().optional().describe("Human-readable summary of what has been accomplished"),
      extra: z.record(z.string(), z.unknown()).optional().describe("Freeform structured data (branch, PR, files, blockers, etc.)"),
    }),
    rpcMethod: "setWorkpad",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>, authContext?: AuthContext) {
      const taskId = resolveTaskId(args, authContext);
      if (!taskId) {
        return {
          content: [{ type: "text" as const, text: "No task context. Provide taskId explicitly or run from a task session." }],
          isError: true,
        };
      }

      try {
        await assertCallerIsSelfOrAncestor(client, authContext, taskId);

        const workpadObject: Record<string, unknown> = {};
        if (args.status !== undefined) {
          workpadObject.status = args.status;
        }
        if (args.summary !== undefined) {
          workpadObject.summary = args.summary;
        }
        if (args.extra !== undefined) {
          workpadObject.extra = args.extra;
        }

        const task = await client.setWorkpad({
          taskId,
          workpad: JSON.stringify(workpadObject),
        });

        return jsonResult({ taskId: task.id, workpad: workpadObject });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  {
    name: "workpad_read",
    group: "workpad",
    description: "Read a task's workpad (persistent structured context). Defaults to the current task; can read child tasks by passing taskId.",
    inputSchema: z.object({
      taskId: z.string().optional().describe("Task ID to read workpad from (defaults to current task)"),
    }),
    rpcMethod: "getTask",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>, authContext?: AuthContext) {
      const taskId = resolveTaskId(args, authContext);
      if (!taskId) {
        return {
          content: [{ type: "text" as const, text: "No task context. Provide taskId explicitly or run from a task session." }],
          isError: true,
        };
      }

      try {
        await assertCallerIsSelfOrAncestor(client, authContext, taskId);

        const task = await client.getTask({ id: taskId });
        const workpad: Record<string, unknown> = task.workpad ? JSON.parse(task.workpad) as Record<string, unknown> : {};
        return jsonResult(workpad);
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
