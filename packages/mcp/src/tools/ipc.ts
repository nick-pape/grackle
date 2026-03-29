import type { Client } from "@connectrpc/connect";
import { z } from "zod";
import { grackle } from "@grackle-ai/common";
import type { ToolDefinition } from "../tool-registry.js";
import type { AuthContext } from "@grackle-ai/auth";
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
    description: "Close a file descriptor, dropping the connection to the child session. If this is the last fd to the child, the child is stopped. Fails if there are undelivered messages — process them first.",
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
        return jsonResult({ success: true, stopped: result.stopped });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "ipc_list_fds",
    group: "ipc",
    description: "List your open file descriptors (IPC pipe connections). Check this before exiting to ensure all owned child fds are closed. Owned fds (owned=true) must be closed with ipc_close before you stop working.",
    inputSchema: z.object({}),
    rpcMethod: "getSessionFds",
    mutating: false,
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>, authContext?: AuthContext) {
      try {
        const sessionId = authContext?.type === "scoped" ? authContext.taskSessionId : "";
        if (!sessionId) {
          return {
            content: [{ type: "text" as const, text: "Error: ipc_list_fds requires scoped auth (agent context)" }],
            isError: true,
          };
        }

        const result = await client.getSessionFds({ id: sessionId });
        return jsonResult({
          fds: result.fds.map((fd) => ({
            fd: fd.fd,
            streamName: fd.streamName,
            permission: fd.permission,
            deliveryMode: fd.deliveryMode,
            owned: fd.owned,
            targetSessionId: fd.targetSessionId,
          })),
        });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "ipc_terminate",
    group: "ipc",
    description: "Send a graceful termination signal (SIGTERM) to a child session via its file descriptor. The child receives a [SIGTERM] message and is expected to wrap up, save work, and stop. The fd stays open — use ipc_close to close it after.",
    inputSchema: z.object({
      fd: z.number().int().describe("File descriptor of the child session to terminate"),
    }),
    rpcMethod: "killAgent",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>, authContext?: AuthContext) {
      try {
        const sessionId = authContext?.type === "scoped" ? authContext.taskSessionId : "";
        if (!sessionId) {
          return {
            content: [{ type: "text" as const, text: "Error: ipc_terminate requires scoped auth (agent context)" }],
            isError: true,
          };
        }

        // Resolve fd → target session
        const fd = args.fd as number;
        const fdsResult = await client.getSessionFds({ id: sessionId });
        const fdInfo = fdsResult.fds.find((f) => f.fd === fd);
        if (!fdInfo) {
          return {
            content: [{ type: "text" as const, text: `Error: fd ${String(fd)} not found` }],
            isError: true,
          };
        }
        if (!fdInfo.targetSessionId) {
          return {
            content: [{ type: "text" as const, text: `Error: fd ${String(fd)} has no target session` }],
            isError: true,
          };
        }
        if (!fdInfo.owned) {
          return {
            content: [{ type: "text" as const, text: `Error: fd ${String(fd)} is not an owned child fd — only owned fds from ipc_spawn can be terminated` }],
            isError: true,
          };
        }

        // Send graceful kill (SIGTERM)
        await client.killAgent({ id: fdInfo.targetSessionId, graceful: true });
        return jsonResult({ success: true, targetSessionId: fdInfo.targetSessionId });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "ipc_list_streams",
    group: "ipc",
    description:
      "List all active IPC streams with subscriber details and message buffer depth. Useful for debugging inter-session communication.",
    inputSchema: z.object({}),
    rpcMethod: "listStreams",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(
      _args: Record<string, unknown>,
      client: Client<typeof grackle.Grackle>,
    ) {
      try {
        const result = await client.listStreams({});
        return jsonResult({
          streams: result.streams.map((s) => ({
            id: s.id,
            name: s.name,
            subscriberCount: s.subscriberCount,
            messageBufferDepth: s.messageBufferDepth,
            subscribers: s.subscribers.map((sub) => ({
              subscriptionId: sub.subscriptionId,
              sessionId: sub.sessionId,
              fd: sub.fd,
              permission: sub.permission,
              deliveryMode: sub.deliveryMode,
              createdBySpawn: sub.createdBySpawn,
            })),
          })),
        });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "ipc_create_stream",
    group: "ipc",
    description: "Create a new named stream for inter-session communication. You get an rw file descriptor on the stream. Use ipc_attach to grant other sessions access, and ipc_write/ipc_close to send messages and close the fd.",
    inputSchema: z.object({
      name: z.string().describe("Human-readable name for the stream (must be unique)"),
    }),
    rpcMethod: "createStream",
    mutating: true,
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>, authContext?: AuthContext) {
      try {
        const sessionId = authContext?.type === "scoped" ? authContext.taskSessionId : "";
        if (!sessionId) {
          return {
            content: [{ type: "text" as const, text: "Error: ipc_create_stream requires scoped auth (agent context)" }],
            isError: true,
          };
        }

        const result = await client.createStream({
          sessionId,
          name: args.name as string,
        });
        return jsonResult({ streamId: result.streamId, fd: result.fd });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "ipc_attach",
    group: "ipc",
    description: "Grant another session access to a stream you hold an fd on. The target session receives a new fd with the specified permission and delivery mode. Permission must be equal to or less than your own (e.g., you can grant 'r' if you have 'rw', but not 'rw' if you only have 'r'). Write-only permission ('w') requires deliveryMode 'detach'.",
    inputSchema: z.object({
      fd: z.number().int().describe("Your file descriptor on the stream"),
      targetSessionId: z.string().describe("Session ID to grant access to"),
      permission: z.enum(["r", "w", "rw"]).default("rw").describe("Permission level for the target"),
      deliveryMode: z.enum(["sync", "async", "detach"]).default("async").describe("How the target receives messages"),
    }),
    rpcMethod: "attachStream",
    mutating: true,
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>, authContext?: AuthContext) {
      try {
        const sessionId = authContext?.type === "scoped" ? authContext.taskSessionId : "";
        if (!sessionId) {
          return {
            content: [{ type: "text" as const, text: "Error: ipc_attach requires scoped auth (agent context)" }],
            isError: true,
          };
        }

        const result = await client.attachStream({
          sessionId,
          fd: args.fd as number,
          targetSessionId: args.targetSessionId as string,
          permission: (args.permission as string) || "rw",
          deliveryMode: (args.deliveryMode as string) || "async",
        });
        return jsonResult({ fd: result.fd });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
