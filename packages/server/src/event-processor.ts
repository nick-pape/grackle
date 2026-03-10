import { create } from "@bufbuild/protobuf";
import { grackle, powerline } from "@grackle-ai/common";
import { agentEventTypeToEventType } from "@grackle-ai/common";
import { v4 as uuid } from "uuid";
import * as sessionStore from "./session-store.js";
import * as streamHub from "./stream-hub.js";
import * as logWriter from "./log-writer.js";
import * as findingStore from "./finding-store.js";
import { writeTranscript } from "./transcript.js";
import { broadcast } from "./ws-bridge.js";
import { logger } from "./logger.js";

/** Terminal session statuses that indicate the session has already ended. */
const TERMINAL_STATUSES: string[] = ["completed", "failed", "killed"];

/** Options for processing an agent event stream. */
export interface EventStreamOptions {
  sessionId: string;
  logPath: string;
  projectId?: string;
  taskId?: string;
  onComplete?: () => void;
  onError?: (error: unknown) => void;
}

/**
 * Process an async iterable of agent events from a PowerLine spawn or resume stream.
 * Handles event transformation, logging, finding interception, status updates, and cleanup.
 *
 * This function is fire-and-forget: it runs in the background and does not throw.
 * Callers should use `onComplete` and `onError` callbacks for post-processing.
 */
export function processEventStream(
  events: AsyncIterable<powerline.AgentEvent>,
  options: EventStreamOptions,
): void {
  const { sessionId, logPath, projectId, taskId, onComplete, onError } = options;

  logWriter.initLog(logPath);

  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  (async () => {
    try {
      sessionStore.updateSession(sessionId, "running");

      for await (const event of events) {
        const sessionEvent = create(grackle.SessionEventSchema, {
          sessionId,
          type: agentEventTypeToEventType(event.type),
          timestamp: event.timestamp,
          content: event.content,
          raw: event.raw,
        });
        logWriter.writeEvent(logPath, sessionEvent);
        streamHub.publish(sessionEvent);

        // Intercept finding events and store + broadcast them
        if (event.type === powerline.AgentEventType.FINDING && projectId) {
          try {
            const data = JSON.parse(event.content);
            const findingId = uuid();
            findingStore.postFinding(
              findingId, projectId, taskId || "", sessionId,
              data.category || "general", data.title || "Untitled",
              data.content || "", data.tags || [],
            );
            broadcast({ type: "finding_posted", payload: { projectId, findingId } });
            logger.info({ findingId, projectId, title: data.title }, "Finding stored");
          } catch (err) {
            logger.error({ err, projectId, taskId }, "Failed to store finding");
          }
        }

        if (event.type === powerline.AgentEventType.STATUS) {
          if (event.content === "waiting_input") {
            sessionStore.updateSessionStatus(sessionId, "waiting_input");
          } else if (event.content === "running") {
            sessionStore.updateSessionStatus(sessionId, "running");
          } else if (event.content === "completed") {
            sessionStore.updateSession(sessionId, "completed");
          } else if (event.content === "failed") {
            sessionStore.updateSession(sessionId, "failed");
          } else if (event.content === "killed") {
            sessionStore.updateSession(sessionId, "killed");
          }
        }
      }

      // Fallback: if stream ended without a terminal status event, mark completed
      const current = sessionStore.getSession(sessionId);
      if (current && !TERMINAL_STATUSES.includes(current.status)) {
        sessionStore.updateSession(sessionId, "completed");
      }
    } catch (err) {
      sessionStore.updateSession(sessionId, "failed", undefined, String(err));

      // Publish a failure event so streaming clients are notified
      streamHub.publish(create(grackle.SessionEventSchema, {
        sessionId,
        type: grackle.EventType.STATUS,
        timestamp: new Date().toISOString(),
        content: "failed",
        raw: String(err),
      }));

      onError?.(err);
    } finally {
      logWriter.endSession(logPath);
      try { writeTranscript(logPath); } catch { /* non-critical */ }
      onComplete?.();
    }
  })();
}
