import type { Client } from "@connectrpc/connect";
import { ConnectError, Code } from "@connectrpc/connect";
import { z } from "zod";
import { grackle, eventTypeToString, SESSION_STATUS } from "@grackle-ai/common";
import type { ToolDefinition } from "../tool-registry.js";
import type { AuthContext } from "@grackle-ai/auth";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";
import { assertCallerIsAncestor } from "../scope-enforcement.js";

/** Default timeout in seconds for session_attach streaming. */
const DEFAULT_TIMEOUT_SECONDS: number = 30;

/** Maximum allowed timeout in seconds for session_attach streaming. */
const MAX_TIMEOUT_SECONDS: number = 300;

/** Session statuses considered "active" for filtering purposes. */
const ACTIVE_STATUSES: string[] = [SESSION_STATUS.PENDING, SESSION_STATUS.RUNNING, SESSION_STATUS.IDLE];


/** MCP tools for managing Grackle agent sessions. */
export const sessionTools: ToolDefinition[] = [
  {
    name: "session_spawn",
    group: "session",
    description: "Spawn a new AI agent session in a Grackle environment with a given prompt and optional model configuration.",
    inputSchema: z.object({
      environmentId: z.string().describe("The environment ID to spawn the agent in"),
      prompt: z.string().describe("The prompt or task description for the agent"),
      maxTurns: z.number().int().positive().optional().describe("Maximum number of turns the agent may take"),
      personaId: z.string().optional().describe("Persona ID to configure agent behavior (falls back to app default)"),
      workingDirectory: z.string().optional().describe("Working directory / repo root hint for the agent (e.g. /workspaces/my-repo)"),
    }),
    rpcMethod: "spawnAgent",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const session = await client.spawnAgent({
          environmentId: args.environmentId as string,
          prompt: args.prompt as string,
          maxTurns: args.maxTurns as number | undefined,
          personaId: args.personaId as string | undefined,
          workingDirectory: (args.workingDirectory as string | undefined) ?? "",
        });
        return jsonResult(session);
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  {
    name: "session_resume",
    group: "session",
    description: "Resume a stopped agent session. Starts a new runtime process that loads the existing conversation via the runtime's native resume mechanism, returning the session in running state. Errors if the session is still active (idle, running, or pending).",
    inputSchema: z.object({
      sessionId: z.string().describe("The ID of the session to resume"),
    }),
    rpcMethod: "resumeAgent",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const session = await client.resumeAgent({
          sessionId: args.sessionId as string,
        });
        return jsonResult(session);
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  {
    name: "session_status",
    group: "session",
    description: "List agent sessions with optional filtering by environment and status. By default shows only active sessions.",
    inputSchema: z.object({
      environmentId: z.string().optional().describe("Filter sessions by environment ID"),
      all: z.boolean().default(false).describe("When true, include sessions in all statuses; when false, show only active sessions"),
    }),
    rpcMethod: "listSessions",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const response = await client.listSessions({
          environmentId: args.environmentId as string | undefined,
          status: "",
        });
        let sessions = response.sessions;
        if (!args.all) {
          sessions = sessions.filter((session) =>
            ACTIVE_STATUSES.includes(session.status),
          );
        }
        const summaries = sessions.map((session) => ({
          id: session.id,
          environmentId: session.environmentId,
          runtime: session.runtime,
          status: session.status,
          endReason: session.endReason || undefined,
          prompt: session.prompt,
          model: session.model,
          turns: session.turns,
          startedAt: session.startedAt,
          taskId: session.taskId,
        }));
        return jsonResult(summaries);
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  {
    name: "session_kill",
    group: "session",
    description: "Terminate a running agent session immediately, stopping any in-progress work.",
    inputSchema: z.object({
      sessionId: z.string().describe("The ID of the session to kill"),
    }),
    rpcMethod: "killAgent",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        await client.killAgent({
          id: args.sessionId as string,
        });
        return jsonResult({ success: true });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  {
    name: "session_attach",
    group: "session",
    description: "Attach to a running session and stream events for a limited duration. Returns collected events and whether the stream timed out.",
    inputSchema: z.object({
      sessionId: z.string().describe("The ID of the session to stream events from"),
      timeoutSeconds: z.number().int().positive().max(MAX_TIMEOUT_SECONDS).default(DEFAULT_TIMEOUT_SECONDS)
        .describe("Maximum seconds to wait for events before returning (default 30, max 300)"),
      maxEvents: z.number().int().positive().optional().describe("Maximum number of events to collect before returning"),
    }),
    rpcMethod: "streamSession",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
        const timeout = Math.min(
          (args.timeoutSeconds as number | undefined) ?? DEFAULT_TIMEOUT_SECONDS,
          MAX_TIMEOUT_SECONDS,
        );
        const maxEvents = args.maxEvents as number | undefined;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout * 1000);
        const events: Array<{ type: string; timestamp: string; content: string }> = [];
        let timedOut = false;

        try {
          for await (const event of client.streamSession(
            { id: args.sessionId as string },
            { signal: controller.signal },
          )) {
            events.push({
              type: eventTypeToString(event.type) || String(event.type),
              timestamp: event.timestamp,
              content: event.content,
            });
            if (maxEvents && events.length >= maxEvents) {
              break;
            }
            if (event.type === grackle.EventType.STATUS && ["completed", "killed", "failed"].includes(event.content)) {
              break;
            }
          }
        } catch (err) {
          if (controller.signal.aborted) {
            timedOut = true;
          } else {
            throw err;
          }
        } finally {
          clearTimeout(timer);
        }

        return jsonResult({ events, timedOut });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },

  {
    name: "session_send_input",
    group: "session",
    description: "Send a text message as input to a session that is waiting for user interaction.",
    inputSchema: z.object({
      sessionId: z.string().describe("The ID of the session to send input to"),
      text: z.string().describe("The text message to send to the agent"),
    }),
    rpcMethod: "sendInput",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>, authContext?: AuthContext) {
      try {
        if (authContext?.type === "scoped") {
          const session = await client.getSession({ id: args.sessionId as string });
          if (!session.taskId) {
            throw new ConnectError("Cannot send input to a taskless session via scoped auth", Code.PermissionDenied);
          }
          await assertCallerIsAncestor(client, authContext, session.taskId);
        }
        await client.sendInput({
          sessionId: args.sessionId as string,
          text: args.text as string,
        });
        return jsonResult({ success: true });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
