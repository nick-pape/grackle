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
      environmentId: z.string().optional().describe("Environment to spawn in (defaults to caller's environment)"),
      personaId: z.string().optional().describe("Persona for the child agent"),
      maxTurns: z.number().int().positive().optional().describe("Maximum turns for the child"),
    }),
    rpcMethod: "spawnAgent",
    mutating: true,
    annotations: { openWorldHint: true },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>, authContext?: AuthContext) {
      try {
        const parentSessionId = authContext?.type === "scoped" ? authContext.taskSessionId : "";
        const pipe = (args.pipe as string) || "detach";

        // Resolve environment: if not specified and caller is scoped, we need to pass one.
        // The server will reject if environmentId is empty, so we require it.
        const environmentId = args.environmentId as string | undefined;
        if (!environmentId) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "environmentId is required" }) }] };
        }

        const session = await client.spawnAgent({
          environmentId,
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
];
