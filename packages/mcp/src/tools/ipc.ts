import type { Client } from "@connectrpc/connect";
import { z } from "zod";
import { grackle } from "@grackle-ai/common";
import type { ToolDefinition } from "../tool-registry.js";
import type { AuthContext } from "../auth-context.js";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

/** MCP tools for agent inter-process communication (streams/pipes). */
export const ipcTools: ToolDefinition[] = [
  {
    name: "ipc_spawn",
    group: "ipc",
    description: "Spawn a child agent session with optional IPC pipe. Use pipe:'sync' to block until the child completes, 'async' to receive results between your turns, or 'detach' for fire-and-forget.",
    inputSchema: z.object({
      prompt: z.string().describe("The task/prompt for the child agent"),
      pipe: z.enum(["sync", "async", "detach"]).default("detach").describe("IPC pipe mode"),
      environmentId: z.string().describe("Environment to spawn in"),
      personaId: z.string().optional().describe("Persona for the child agent"),
      maxTurns: z.number().int().positive().optional().describe("Maximum turns for the child"),
    }),
    rpcMethod: "spawnAgent",
    mutating: true,
    annotations: { openWorldHint: true },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>, authContext?: AuthContext) {
      try {
        const pipe = (args.pipe as string) || "detach";
        const parentSessionId = authContext?.type === "scoped" ? authContext.taskSessionId : "";

        // sync/async pipe modes require scoped auth (need parent session ID)
        if (pipe !== "detach" && !parentSessionId) {
          return {
            content: [{ type: "text" as const, text: "Error: sync and async pipe modes require scoped auth (agent context)" }],
            isError: true,
          };
        }

        const session = await client.spawnAgent({
          environmentId: args.environmentId as string,
          prompt: args.prompt as string,
          pipe,
          parentSessionId,
          personaId: (args.personaId as string) || "",
          maxTurns: (args.maxTurns as number) || 0,
        });

        if (pipe === "sync") {
          // Block until child publishes result via the IPC stream
          const result = await client.waitForPipe({
            sessionId: parentSessionId,
            fd: session.pipeFd,
          });
          return jsonResult({
            sessionId: session.id,
            output: result.content,
            senderSessionId: result.senderSessionId,
          });
        }

        if (pipe === "async") {
          return jsonResult({
            sessionId: session.id,
            fd: session.pipeFd,
          });
        }

        // detach
        return jsonResult({ sessionId: session.id });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "ipc_write",
    group: "ipc",
    description: "Write a message to a child session via an open file descriptor. The message is delivered to the child via sendInput.",
    inputSchema: z.object({
      fd: z.number().int().describe("File descriptor (from ipc_spawn)"),
      message: z.string().describe("Message content to send"),
    }),
    rpcMethod: "writeToFd",
    mutating: true,
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>, authContext?: AuthContext) {
      try {
        const sessionId = authContext?.type === "scoped" ? authContext.taskSessionId : "";
        if (!sessionId) {
          return {
            content: [{ type: "text" as const, text: "Error: ipc_write requires scoped auth (agent context)" }],
            isError: true,
          };
        }

        await client.writeToFd({
          sessionId,
          fd: args.fd as number,
          message: args.message as string,
        });
        return jsonResult({ success: true });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "ipc_close",
    group: "ipc",
    description: "Close a file descriptor, dropping the connection to the child session. If this is the last fd to the child, the child is hibernated. Fails if there are undelivered messages — process them first.",
    inputSchema: z.object({
      fd: z.number().int().describe("File descriptor to close"),
    }),
    rpcMethod: "closeFd",
    mutating: true,
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>, authContext?: AuthContext) {
      try {
        const sessionId = authContext?.type === "scoped" ? authContext.taskSessionId : "";
        if (!sessionId) {
          return {
            content: [{ type: "text" as const, text: "Error: ipc_close requires scoped auth (agent context)" }],
            isError: true,
          };
        }

        const result = await client.closeFd({
          sessionId,
          fd: args.fd as number,
        });
        return jsonResult({ success: true, hibernated: result.hibernated });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
