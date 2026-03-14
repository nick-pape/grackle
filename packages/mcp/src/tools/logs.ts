import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import { z } from "zod";
import type { ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

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
      timeoutSeconds: z.number().int().positive().optional().describe("Timeout in seconds for tail mode (default 10, max 60)"),
      maxEvents: z.number().int().positive().optional().describe("Maximum events to return in tail mode"),
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
        // Find the session to get its logPath
        const sessionsResponse = await client.listSessions({
          environmentId: "",
          status: "",
        });
        const session = sessionsResponse.sessions.find(
          (s) => s.id === (args.sessionId as string),
        );
        if (!session) {
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
            (args.timeoutSeconds as number) ?? DEFAULT_TAIL_TIMEOUT_SECONDS,
            MAX_TAIL_TIMEOUT_SECONDS,
          );
          const maxEvents = args.maxEvents as number | undefined;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout * 1000);
          const events: Array<{ type: number; timestamp: string; content: string }> = [];
          let timedOut = false;

          try {
            const stream = client.streamSession(
              { id: args.sessionId as string },
              { signal: controller.signal },
            );
            for await (const event of stream) {
              events.push({
                type: event.type,
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
            .map((line) => JSON.parse(line));
          return jsonResult({ sessionId: session.id, events });
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: "Log file not found", code: "NOT_FOUND" },
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
