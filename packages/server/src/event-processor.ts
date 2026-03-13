import { create } from "@bufbuild/protobuf";
import { grackle, powerline, eventTypeToEnum } from "@grackle-ai/common";
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
          type: eventTypeToEnum(event.type),
          timestamp: event.timestamp,
          content: event.content,
          raw: event.raw,
        });
        logWriter.writeEvent(logPath, sessionEvent);
        streamHub.publish(sessionEvent);

        // Intercept finding events and store + broadcast them
        if (event.type === "finding" && projectId) {
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
        if (event.type === "subtask_create" && taskId) {
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
                // Validate required fields
                const title = typeof data.title === "string" ? data.title.trim() : "";
                const description = typeof data.description === "string" ? data.description.trim() : "";

                if (!title || !description) {
                  logger.warn(
                    { taskId, rawTitle: data.title, rawDescription: data.description },
                    "Subtask creation failed: invalid title or description",
                  );
                } else {
                  // Normalize and validate depends_on, local_id, and can_decompose
                  const dependsOn = Array.isArray(data.depends_on)
                    ? data.depends_on.filter((d): d is string => typeof d === "string").map(d => d.trim()).filter(Boolean)
                    : [];
                  const localId = typeof data.local_id === "string" ? data.local_id.trim() : "";
                  const canDecompose = typeof data.can_decompose === "boolean" ? data.can_decompose : false;

                  // Resolve depends_on local IDs to real task IDs
                  const resolvedDeps: string[] = [];
                  for (const localDep of dependsOn) {
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
                    title,
                    description,
                    environmentId,
                    resolvedDeps,
                    slugify(project.name),
                    taskId,
                    canDecompose,
                  );

                  // Record the local_id → real ID mapping, detecting duplicates
                  if (localId) {
                    if (subtaskLocalIdMap.has(localId)) {
                      logger.warn(
                        {
                          localId,
                          existingSubtaskId: subtaskLocalIdMap.get(localId),
                          newSubtaskId: subtaskId,
                          parentTaskId: taskId,
                        },
                        "Duplicate subtask local_id encountered; keeping existing mapping",
                      );
                    } else {
                      subtaskLocalIdMap.set(localId, subtaskId);
                    }
                  }

                  const row = taskStore.getTask(subtaskId);
                  broadcast({
                    type: "task_created",
                    payload: { task: row ? { ...row, dependsOn: safeParseJsonArray(row.dependsOn) } : null },
                  });
                  logger.info({ subtaskId, parentTaskId: taskId, title }, "Subtask created");
                }
              }
            }
          } catch (err) {
            logger.error({ err, taskId }, "Failed to create subtask");
          }
        }

        if (event.type === "status") {
          if (event.content === "waiting_input") {
            sessionStore.updateSessionStatus(sessionId, "waiting_input");
            if (taskId) {
              const t = taskStore.getTask(taskId);
              if (t && t.status === "in_progress") {
                taskStore.updateTaskStatus(taskId, "waiting_input");
                broadcast({ type: "task_updated", payload: { taskId, projectId } });
              }
            }
          } else if (event.content === "running") {
            sessionStore.updateSessionStatus(sessionId, "running");
            if (taskId) {
              const t = taskStore.getTask(taskId);
              if (t && t.status === "waiting_input") {
                taskStore.updateTaskStatus(taskId, "in_progress");
                broadcast({ type: "task_updated", payload: { taskId, projectId } });
              }
            }
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
      const current = sessionStore.getSession(sessionId);
      if (current && current.status === "waiting_input") {
        // Session was idle (agent finished work). Transport error is not a task failure.
        logger.info({ sessionId, err: String(err) }, "Stream ended while session idle — marking completed");
        sessionStore.updateSession(sessionId, "completed");
        streamHub.publish(create(grackle.SessionEventSchema, {
          sessionId,
          type: grackle.EventType.STATUS,
          timestamp: new Date().toISOString(),
          content: "completed",
        }));
      } else {
        // Genuine failure during active work.
        sessionStore.updateSession(sessionId, "failed", undefined, String(err));
        streamHub.publish(create(grackle.SessionEventSchema, {
          sessionId,
          type: grackle.EventType.STATUS,
          timestamp: new Date().toISOString(),
          content: "failed",
          raw: String(err),
        }));
        onError?.(err);
      }
    } finally {
      logWriter.endSession(logPath);
      try { writeTranscript(logPath); } catch { /* non-critical */ }
      onComplete?.();
    }
  })();
}
