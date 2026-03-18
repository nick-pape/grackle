import { create } from "@bufbuild/protobuf";
import { grackle, powerline, eventTypeToEnum, SESSION_STATUS } from "@grackle-ai/common";
import { v4 as uuid } from "uuid";
import * as sessionStore from "./session-store.js";
import * as streamHub from "./stream-hub.js";
import * as logWriter from "./log-writer.js";
import * as findingStore from "./finding-store.js";
import * as taskStore from "./task-store.js";
import * as projectStore from "./project-store.js";
import * as processorRegistry from "./processor-registry.js";
import { slugify } from "./utils/slugify.js";
import { writeTranscript } from "./transcript.js";
import { broadcast } from "./ws-broadcast.js";
import { safeParseJsonArray } from "./json-helpers.js";
import { logger } from "./logger.js";
import type { ProcessorContext } from "./processor-registry.js";

/** Terminal session statuses that indicate the session has already ended. */
const TERMINAL_STATUSES: string[] = [SESSION_STATUS.COMPLETED, SESSION_STATUS.FAILED, SESSION_STATUS.INTERRUPTED];

/** Options for processing an agent event stream. */
export interface EventStreamOptions {
  sessionId: string;
  logPath: string;
  projectId?: string;
  taskId?: string;
  onError?: (error: unknown) => void;
}

/**
 * Process a finding event, storing it in the finding store and broadcasting.
 * Shared between live event processing and replay on late-bind.
 */
export function processFindingEvent(
  ctx: ProcessorContext,
  content: string,
  sessionId: string,
): void {
  if (!ctx.projectId) {
    return;
  }
  try {
    const data = JSON.parse(content) as {
      category?: string; title?: string; content?: string; tags?: string[];
    };
    const findingId = uuid();
    findingStore.postFinding(
      findingId, ctx.projectId, ctx.taskId || "", sessionId,
      data.category || "general", data.title || "Untitled",
      data.content || "", data.tags || [],
    );
    broadcast({ type: "finding_posted", payload: { projectId: ctx.projectId, findingId } });
    logger.info({ findingId, projectId: ctx.projectId, title: data.title }, "Finding stored");
  } catch (err) {
    logger.error({ err, projectId: ctx.projectId, taskId: ctx.taskId }, "Failed to store finding");
  }
}

/**
 * Process a subtask creation event, creating a child task and broadcasting.
 * Shared between live event processing and replay on late-bind.
 */
export function processSubtaskEvent(
  ctx: ProcessorContext,
  content: string,
  subtaskLocalIdMap: Map<string, string>,
): void {
  if (!ctx.taskId) {
    return;
  }
  try {
    const data = JSON.parse(content) as {
      title: string;
      description: string;
      local_id?: string;
      depends_on?: string[];
      can_decompose?: boolean;
    };

    const parentTask = taskStore.getTask(ctx.taskId);
    if (!parentTask) {
      logger.warn({ taskId: ctx.taskId }, "Subtask creation failed: parent task not found");
      return;
    }
    if (!parentTask.canDecompose) {
      logger.warn({ taskId: ctx.taskId }, "Subtask creation failed: parent task cannot decompose");
      return;
    }

    const project = projectStore.getProject(parentTask.projectId);
    if (!project) {
      logger.warn({ projectId: parentTask.projectId }, "Subtask creation failed: project not found");
      return;
    }

    // Validate required fields
    const title = typeof data.title === "string" ? data.title.trim() : "";
    const description = typeof data.description === "string" ? data.description.trim() : "";

    if (!title || !description) {
      logger.warn(
        { taskId: ctx.taskId, rawTitle: data.title, rawDescription: data.description },
        "Subtask creation failed: invalid title or description",
      );
      return;
    }

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
        logger.warn({ localDep, taskId: ctx.taskId }, "Subtask dependency local_id not found, skipping");
      }
    }

    const subtaskId = uuid().slice(0, 8);
    taskStore.createTask(
      subtaskId,
      parentTask.projectId,
      title,
      description,
      resolvedDeps,
      slugify(project.name),
      ctx.taskId,
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
            parentTaskId: ctx.taskId,
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
    logger.info({ subtaskId, parentTaskId: ctx.taskId, title }, "Subtask created");
  } catch (err) {
    logger.error({ err, taskId: ctx.taskId }, "Failed to create subtask");
  }
}

/**
 * Replay pre-association events from the session log through finding/subtask interceptors.
 * Called when a session is late-bound to a task. Does not re-publish to streamHub.
 *
 * Note: Uses synchronous readFileSync while the log is written via a buffered WriteStream.
 * Events written very recently may still be in the write buffer and not yet flushed to disk.
 * In practice this is negligible since replay targets events written before the current
 * iteration of the for-await loop, which are already flushed by the time lateBind is called.
 */
function replayLoggedEvents(ctx: ProcessorContext, subtaskLocalIdMap: Map<string, string>): void {
  try {
    const entries = logWriter.readLog(ctx.logPath);
    let findingsReplayed = 0;
    let subtasksReplayed = 0;

    for (const entry of entries) {
      if (entry.type === "finding") {
        processFindingEvent(ctx, entry.content, entry.session_id);
        findingsReplayed++;
      } else if (entry.type === "subtask_create") {
        processSubtaskEvent(ctx, entry.content, subtaskLocalIdMap);
        subtasksReplayed++;
      }
    }

    if (findingsReplayed > 0 || subtasksReplayed > 0) {
      logger.info(
        { sessionId: ctx.sessionId, taskId: ctx.taskId, findingsReplayed, subtasksReplayed },
        "Replayed pre-association events from session log",
      );
    }
  } catch (err) {
    logger.error({ err, sessionId: ctx.sessionId }, "Failed to replay logged events");
  }
}

/**
 * Process an async iterable of agent events from a PowerLine spawn or resume stream.
 * Handles event transformation, logging, finding interception, status updates, and cleanup.
 *
 * This function is fire-and-forget: it runs in the background and does not throw.
 * Callers should use `onComplete` and `onError` callbacks for post-processing.
 *
 * Supports late-binding: if a task is associated with the session after the stream starts,
 * the processor registry notifies this function via a bind listener, and pre-association
 * events are replayed from the session log.
 */
export function processEventStream(
  events: AsyncIterable<powerline.AgentEvent>,
  options: EventStreamOptions,
): void {
  const { sessionId, logPath, onError } = options;

  // Create a mutable context that can be updated via the processor registry
  const ctx: ProcessorContext = {
    sessionId,
    logPath,
    projectId: options.projectId || "",
    taskId: options.taskId || "",
  };

  /** Maps local_id strings (assigned by the agent) to real task IDs, scoped to this stream. */
  const subtaskLocalIdMap = new Map<string, string>();

  processorRegistry.register(ctx);

  // Register the bind listener synchronously alongside register() to close the race
  // window where lateBind() could fire between register and the async IIFE starting.
  processorRegistry.onBind(sessionId, () => {
    replayLoggedEvents(ctx, subtaskLocalIdMap);
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  (async () => {

    try {
      logWriter.initLog(logPath);
      sessionStore.updateSessionStatus(sessionId, SESSION_STATUS.RUNNING);

      for await (const event of events) {
        // runtime_session_id is an internal control event: persist it then skip
        // logging/publishing — it has no proto enum value and is not client-visible.
        if (event.type === "runtime_session_id") {
          if (event.content) {
            sessionStore.updateRuntimeSessionId(sessionId, event.content);
          }
          continue;
        }

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
        if (event.type === "finding" && ctx.projectId) {
          processFindingEvent(ctx, event.content, sessionId);
        }

        // Intercept subtask creation events and create child tasks
        if (event.type === "subtask_create" && ctx.taskId) {
          processSubtaskEvent(ctx, event.content, subtaskLocalIdMap);
        }

        if (event.type === "status") {
          // Map runtime status strings to our session status model
          if (event.content === "waiting_input") {
            sessionStore.updateSessionStatus(sessionId, SESSION_STATUS.IDLE);
          } else if (event.content === "running") {
            sessionStore.updateSessionStatus(sessionId, SESSION_STATUS.RUNNING);
          } else if (event.content === "completed") {
            sessionStore.updateSession(sessionId, SESSION_STATUS.COMPLETED);
          } else if (event.content === "failed") {
            sessionStore.updateSession(sessionId, SESSION_STATUS.FAILED);
          } else if (event.content === "killed") {
            sessionStore.updateSession(sessionId, SESSION_STATUS.INTERRUPTED);
          }

          // Broadcast task_updated on status changes so frontend re-fetches computed status.
          // This covers both terminal events (completed/failed/killed) and non-terminal
          // transitions (running, waiting_input) that affect the computed task status.
          if (ctx.taskId && ["completed", "failed", "killed", "running", "waiting_input"].includes(event.content)) {
            broadcast({ type: "task_updated", payload: { taskId: ctx.taskId, projectId: ctx.projectId } });
          }
        }
      }

      // Fallback: if stream ended without a terminal status event, mark completed
      const current = sessionStore.getSession(sessionId);
      if (current && !TERMINAL_STATUSES.includes(current.status)) {
        sessionStore.updateSession(sessionId, SESSION_STATUS.COMPLETED);
        if (ctx.taskId) {
          broadcast({ type: "task_updated", payload: { taskId: ctx.taskId, projectId: ctx.projectId } });
        }
      }
    } catch (err) {
      const current = sessionStore.getSession(sessionId);
      if (current?.status === SESSION_STATUS.IDLE) {
        // Session was idle (agent finished work). Transport error is not a task failure.
        logger.info({ sessionId, err: String(err) }, "Stream ended while session idle — marking completed");
        sessionStore.updateSession(sessionId, SESSION_STATUS.COMPLETED);
        streamHub.publish(create(grackle.SessionEventSchema, {
          sessionId,
          type: grackle.EventType.STATUS,
          timestamp: new Date().toISOString(),
          content: SESSION_STATUS.COMPLETED,
        }));
      } else {
        // Genuine failure during active work.
        sessionStore.updateSession(sessionId, SESSION_STATUS.FAILED, undefined, String(err));
        streamHub.publish(create(grackle.SessionEventSchema, {
          sessionId,
          type: grackle.EventType.STATUS,
          timestamp: new Date().toISOString(),
          content: SESSION_STATUS.FAILED,
          raw: String(err),
        }));
        onError?.(err);
      }
      if (ctx.taskId) {
        broadcast({ type: "task_updated", payload: { taskId: ctx.taskId, projectId: ctx.projectId } });
      }
    } finally {
      processorRegistry.unregister(sessionId);
      logWriter.endSession(logPath);
      try { writeTranscript(logPath); } catch { /* non-critical */ }
    }
  })();
}
