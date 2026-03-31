import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ConnectError, Code } from "@connectrpc/connect";
import { eventTypeToString } from "@grackle-ai/common";
import type { AuthContext } from "@grackle-ai/auth";
import { z } from "zod";
import type { GrackleClients, ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";
import { assertCallerIsAncestor } from "../scope-enforcement.js";

/** Default timeout in seconds for tail mode. */
const DEFAULT_TAIL_TIMEOUT_SECONDS: number = 10;

/** Maximum timeout in seconds for tail mode. */
const MAX_TAIL_TIMEOUT_SECONDS: number = 60;

/** MCP tools for reading session logs. */
export const logsTools: ToolDefinition[] = [
  {
    name: "logs_get",
    group: "logs",
    description: "Retrieve session logs — raw stream events, formatted transcript, or live tail with timeout.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID to retrieve logs for"),
      transcript: z.boolean().optional().describe("Return formatted transcript instead of raw events"),
      tail: z.boolean().optional().describe("Live-tail the session stream with a timeout"),
      timeoutSeconds: z.number().int().positive().max(MAX_TAIL_TIMEOUT_SECONDS).default(DEFAULT_TAIL_TIMEOUT_SECONDS).describe("Timeout in seconds for tail mode (default 10, max 60)"),
      maxEvents: z.number().int().positive().optional().describe("Maximum events to return in tail mode"),
    }),
    rpcMethod: "getSession",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { core: client, orchestration }: GrackleClients, authContext?: AuthContext) {
      try {
        // Fetch the session directly by ID
        let session: Awaited<ReturnType<typeof client.getSession>> | undefined;
        try {
          session = await client.getSession({ id: args.sessionId as string });
        } catch (error) {
          if (error instanceof ConnectError && error.code === Code.NotFound) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    { error: "Session not found", code: "NOT_FOUND" },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }
          throw error;
        }

        // Scope enforcement: scoped agents can only read logs of descendant sessions
        if (authContext?.type === "scoped") {
          if (!session.taskId) {
            throw new ConnectError("Cannot read logs for a taskless session via scoped auth", Code.PermissionDenied);
          }
          await assertCallerIsAncestor(orchestration, authContext, session.taskId);
        }

        if (!session.logPath) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: "Session has no log path", code: "NOT_FOUND" },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        // Tail mode: stream live events with timeout
        if (args.tail) {
          const timeout = Math.min(
            (args.timeoutSeconds as number | undefined) ?? DEFAULT_TAIL_TIMEOUT_SECONDS,
            MAX_TAIL_TIMEOUT_SECONDS,
          );
          const maxEvents = args.maxEvents as number | undefined;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout * 1000);
          const events: Array<{ type: string; timestamp: string; content: string }> = [];
          let timedOut = false;

          try {
            const stream = client.streamSession(
              { id: args.sessionId as string },
              { signal: controller.signal },
            );
            for await (const event of stream) {
              events.push({
                type: eventTypeToString(event.type) || String(event.type),
                timestamp: event.timestamp,
                content: event.content,
              });
              if (maxEvents && events.length >= maxEvents) {
                break;
              }
            }
          } catch (err: unknown) {
            if (controller.signal.aborted) {
              timedOut = true;
            } else {
              clearTimeout(timer);
              throw err;
            }
          } finally {
            clearTimeout(timer);
          }

          return jsonResult({ events, timedOut });
        }

        // Transcript mode: read transcript.md
        if (args.transcript) {
          const transcriptPath = join(session.logPath, "transcript.md");
          try {
            const content = await readFile(transcriptPath, "utf-8");
            return jsonResult({ sessionId: session.id, transcript: content });
          } catch {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    { error: "Transcript file not found", code: "NOT_FOUND" },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }
        }

        // Default: read stream.jsonl
        // TODO: Add GetSessionLogs RPC for proper streaming log access
        const streamPath = join(session.logPath, "stream.jsonl");
        try {
          const content = await readFile(streamPath, "utf-8");
          const events = content
            .trim()
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line) as unknown);
          return jsonResult({ sessionId: session.id, events });
        } catch (err: unknown) {
          const isNotFound = err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
          const errorMessage = isNotFound ? "Log file not found" : `Failed to read log file: ${err instanceof Error ? err.message : String(err)}`;
          const errorCode = isNotFound ? "NOT_FOUND" : "INTERNAL";
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: errorMessage, code: errorCode },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
