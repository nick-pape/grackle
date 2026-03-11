import { create } from "@bufbuild/protobuf";
import { grackle, powerline } from "@grackle-ai/common";
import { agentEventTypeToEventType } from "@grackle-ai/common";
import { v4 as uuid } from "uuid";
import * as sessionStore from "./session-store.js";
import * as streamHub from "./stream-hub.js";
import * as logWriter from "./log-writer.js";
import * as findingStore from "./finding-store.js";
import * as taskStore from "./task-store.js";
import * as projectStore from "./project-store.js";
import { slugify } from "./utils/slugify.js";
import { writeTranscript } from "./transcript.js";
import { broadcast } from "./ws-broadcast.js";
import { safeParseJsonArray } from "./json-helpers.js";
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

  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  (async () => {
    /** Maps local_id strings (assigned by the agent) to real task IDs, scoped to this stream. */
    const subtaskLocalIdMap = new Map<string, string>();

    try {
      logWriter.initLog(logPath);
      sessionStore.updateSessionStatus(sessionId, "running");

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

        // Intercept subtask creation events and create child tasks
        if (event.type === powerline.AgentEventType.SUBTASK_CREATE && taskId) {
          try {
            const data = JSON.parse(event.content) as {
              title: string;
              description: string;
              local_id?: string;
              depends_on?: string[];
              can_decompose?: boolean;
            };

            const parentTask = taskStore.getTask(taskId);
            if (!parentTask) {
              logger.warn({ taskId }, "Subtask creation failed: parent task not found");
            } else if (!parentTask.canDecompose) {
              logger.warn({ taskId }, "Subtask creation failed: parent task cannot decompose");
            } else {
              const project = projectStore.getProject(parentTask.projectId);
              if (!project) {
                logger.warn({ projectId: parentTask.projectId }, "Subtask creation failed: project not found");
              } else {
                // Resolve depends_on local IDs to real task IDs
                const resolvedDeps: string[] = [];
                for (const localDep of (data.depends_on || [])) {
                  const realId = subtaskLocalIdMap.get(localDep);
                  if (realId) {
                    resolvedDeps.push(realId);
                  } else {
                    logger.warn({ localDep, taskId }, "Subtask dependency local_id not found, skipping");
                  }
                }

                const subtaskId = uuid().slice(0, 8);
                const environmentId = parentTask.environmentId || project.defaultEnvironmentId;
                taskStore.createTask(
                  subtaskId,
                  parentTask.projectId,
                  data.title,
                  data.description,
                  environmentId,
                  resolvedDeps,
                  slugify(project.name),
                  taskId,
                  data.can_decompose,
                );

                // Record the local_id → real ID mapping
                if (data.local_id) {
                  subtaskLocalIdMap.set(data.local_id, subtaskId);
                }

                const row = taskStore.getTask(subtaskId);
                broadcast({
                  type: "task_created",
                  payload: { task: row ? { ...row, dependsOn: safeParseJsonArray(row.dependsOn) } : null },
                });
                logger.info({ subtaskId, parentTaskId: taskId, title: data.title }, "Subtask created");
              }
            }
          } catch (err) {
            logger.error({ err, taskId }, "Failed to create subtask");
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
