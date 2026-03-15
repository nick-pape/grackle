import type { Client } from "@connectrpc/connect";
import { z } from "zod";
import { grackle, eventTypeToString, SESSION_STATUS } from "@grackle-ai/common";
import type { ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

/** Default timeout in seconds for session_attach streaming. */
const DEFAULT_TIMEOUT_SECONDS: number = 30;

/** Maximum allowed timeout in seconds for session_attach streaming. */
const MAX_TIMEOUT_SECONDS: number = 300;

/** Session statuses considered "active" for filtering purposes. */
const ACTIVE_STATUSES: string[] = [SESSION_STATUS.PENDING, SESSION_STATUS.RUNNING, SESSION_STATUS.IDLE];

/** Session statuses that indicate no further events will arrive. */
const TERMINAL_STATUSES: string[] = [SESSION_STATUS.COMPLETED, SESSION_STATUS.FAILED, SESSION_STATUS.INTERRUPTED];

/** MCP tools for managing Grackle agent sessions. */
export const sessionTools: ToolDefinition[] = [
  {
    name: "session_spawn",
    group: "session",
    description: "Spawn a new AI agent session in a Grackle environment with a given prompt and optional model configuration.",
    inputSchema: z.object({
      environmentId: z.string().describe("The environment ID to spawn the agent in"),
      prompt: z.string().describe("The prompt or task description for the agent"),
      model: z.string().optional().describe("The AI model to use (e.g. claude-sonnet-4-20250514)"),
      maxTurns: z.number().int().positive().optional().describe("Maximum number of turns the agent may take"),
      runtime: z.string().optional().describe("The runtime to use (e.g. claude-code)"),
      personaId: z.string().optional().describe("Persona ID to configure agent behavior"),
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
          model: args.model as string | undefined,
          maxTurns: args.maxTurns as number | undefined,
          runtime: args.runtime as string | undefined,
          personaId: args.personaId as string | undefined,
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
    description: "Resume a previously suspended agent session, continuing from where it left off.",
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
            if (event.type === grackle.EventType.STATUS && TERMINAL_STATUSES.includes(event.content)) {
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
    async handler(args: Record<string, unknown>, client: Client<typeof grackle.Grackle>) {
      try {
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
