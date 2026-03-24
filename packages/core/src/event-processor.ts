import { create } from "@bufbuild/protobuf";
import { grackle, powerline, eventTypeToEnum, SESSION_STATUS, TERMINAL_SESSION_STATUSES, END_REASON } from "@grackle-ai/common";
import type { SessionStatus } from "@grackle-ai/common";
import { v4 as uuid } from "uuid";
import { sessionStore, findingStore, taskStore, workspaceStore, slugify } from "@grackle-ai/database";
import * as streamHub from "./stream-hub.js";
import * as logWriter from "./log-writer.js";
import * as processorRegistry from "./processor-registry.js";
import { writeTranscript } from "./transcript.js";
import { emit } from "./event-bus.js";
import { logger } from "./logger.js";
import { publishChildCompletion } from "./pipe-delivery.js";
import { cleanupLifecycleStream } from "./lifecycle.js";
import type { ProcessorContext } from "./processor-registry.js";

/** Options for processing an agent event stream. */
export interface EventStreamOptions {
  sessionId: string;
  logPath: string;
  workspaceId?: string;
  taskId?: string;
  /** System context injected into the agent session. Emitted as the first event in the stream. */
  systemContext?: string;
  /** Initial user prompt sent to the agent. Emitted as a user_input event after systemContext. */
  prompt?: string;
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
  if (!ctx.workspaceId) {
    return;
  }
  try {
    const data = JSON.parse(content) as {
      category?: string; title?: string; content?: string; tags?: string[];
    };
    const findingId = uuid();
    findingStore.postFinding(
      findingId, ctx.workspaceId, ctx.taskId || "", sessionId,
      data.category || "general", data.title || "Untitled",
      data.content || "", data.tags || [],
    );
    emit("finding.posted", { workspaceId: ctx.workspaceId, findingId });
    logger.info({ findingId, workspaceId: ctx.workspaceId, title: data.title }, "Finding stored");
  } catch (err) {
    logger.error({ err, workspaceId: ctx.workspaceId, taskId: ctx.taskId }, "Failed to store finding");
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

    const workspace = parentTask.workspaceId ? workspaceStore.getWorkspace(parentTask.workspaceId) : undefined;
    if (parentTask.workspaceId && !workspace) {
      logger.warn({ workspaceId: parentTask.workspaceId }, "Subtask creation failed: workspace not found");
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

    // Resolve depends_on local IDs to real task IDs — all must exist
    const resolvedDeps: string[] = [];
    for (const localDep of dependsOn) {
      const realId = subtaskLocalIdMap.get(localDep);
      if (realId) {
        resolvedDeps.push(realId);
      } else {
        const subtaskIdentifier = localId
          ? `Subtask local_id "${localId}"`
          : `Subtask "${title}"`;
        throw new Error(
          `${subtaskIdentifier} references unknown depends_on local_id "${localDep}". ` +
          `Dependencies must be created before dependents (topological order).`,
        );
      }
    }

    const subtaskId = uuid().slice(0, 8);
    taskStore.createTask(
      subtaskId,
      parentTask.workspaceId || undefined,
      title,
      description,
      resolvedDeps,
      workspace ? slugify(workspace.name) : "",
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

    emit("task.created", { taskId: subtaskId, workspaceId: parentTask.workspaceId ?? undefined });
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
 * Callers should use `onComplete` callback for post-processing.
 *
 * Supports late-binding: if a task is associated with the session after the stream starts,
 * the processor registry notifies this function via a bind listener, and pre-association
 * events are replayed from the session log.
 */
export function processEventStream(
  events: AsyncIterable<powerline.AgentEvent>,
  options: EventStreamOptions,
): void {
  const { sessionId, logPath } = options;

  // Create a mutable context that can be updated via the processor registry
  const ctx: ProcessorContext = {
    sessionId,
    logPath,
    workspaceId: options.workspaceId || "",
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

      // Emit system context and initial prompt as the first visible events in the stream.
      // Only for task sessions — ad-hoc spawns show the prompt in the chat input already.
      // Use distinct timestamps so clients can reliably sort/dedup by timestamp+eventType.
      if (options.systemContext && options.taskId) {
        const sysCtxEvent = create(grackle.SessionEventSchema, {
          sessionId,
          type: grackle.EventType.SYSTEM,
          timestamp: new Date().toISOString(),
          content: options.systemContext,
          raw: JSON.stringify({ systemContext: true }),
        });
        logWriter.writeEvent(logPath, sysCtxEvent);
        streamHub.publish(sysCtxEvent);
      }
      if (options.prompt && options.taskId) {
        const promptEvent = create(grackle.SessionEventSchema, {
          sessionId,
          type: grackle.EventType.USER_INPUT,
          timestamp: new Date().toISOString(),
          content: options.prompt,
        });
        logWriter.writeEvent(logPath, promptEvent);
        streamHub.publish(promptEvent);
      }

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
        if (event.type === "finding" && ctx.workspaceId) {
          processFindingEvent(ctx, event.content, sessionId);
        }

        // Intercept subtask creation events and create child tasks
        if (event.type === "subtask_create" && ctx.taskId) {
          processSubtaskEvent(ctx, event.content, subtaskLocalIdMap);
        }

        // Intercept usage events and accumulate token counts on the session record
        if (event.type === "usage") {
          try {
            const data = JSON.parse(event.content) as {
              input_tokens?: number;
              output_tokens?: number;
              cost_usd?: number;
            };
            const inputTokens = Number.isFinite(data.input_tokens)
              ? Math.max(0, Math.trunc(data.input_tokens as number))
              : 0;
            const outputTokens = Number.isFinite(data.output_tokens)
              ? Math.max(0, Math.trunc(data.output_tokens as number))
              : 0;
            const costUsd = Number.isFinite(data.cost_usd)
              ? Math.max(0, data.cost_usd as number)
              : 0;
            if (inputTokens > 0 || outputTokens > 0 || costUsd > 0) {
              sessionStore.updateSessionUsage(sessionId, inputTokens, outputTokens, costUsd);
            }
          } catch (err) {
            logger.error({ err, sessionId }, "Failed to process usage event");
          }
        }

        if (event.type === "status") {
          // Map runtime status strings to our session status model
          if (event.content === "waiting_input") {
            sessionStore.updateSessionStatus(sessionId, SESSION_STATUS.IDLE);
          } else if (event.content === "running") {
            sessionStore.updateSessionStatus(sessionId, SESSION_STATUS.RUNNING);
          } else if (event.content === "completed") {
            sessionStore.updateSession(sessionId, SESSION_STATUS.STOPPED, undefined, undefined, END_REASON.COMPLETED);
          } else if (event.content === "killed") {
            sessionStore.updateSession(sessionId, SESSION_STATUS.STOPPED, undefined, undefined, END_REASON.KILLED);
          } else if (event.content === "failed") {
            sessionStore.updateSession(sessionId, SESSION_STATUS.STOPPED, undefined, undefined, END_REASON.INTERRUPTED);
            cleanupLifecycleStream(sessionId);
          }

          // On terminal status (or idle for sync pipes): publish child completion
          // to IPC pipe stream. `waiting_input` is included so that sync pipes
          // unblock when a child goes idle without calling task_complete (#824).
          // publishChildCompletion internally skips waiting_input for async pipes.
          if (["completed", "killed", "failed", "waiting_input"].includes(event.content)) {
            publishChildCompletion(sessionId, event.content);
          }

          // Broadcast task_updated on status changes so frontend re-fetches computed status.
          // This covers both terminal events (completed/killed/failed) and non-terminal
          // transitions (running, waiting_input) that affect the computed task status.
          if (ctx.taskId && ["completed", "killed", "failed", "running", "waiting_input"].includes(event.content)) {
            emit("task.updated", { taskId: ctx.taskId, workspaceId: ctx.workspaceId });
          }
        }
      }

      // Fallback: if stream ended without a terminal status event, emit a UI refresh
      // without changing status. Guard against overwriting terminal or SUSPENDED states.
      const current = sessionStore.getSession(sessionId);
      if (current && !TERMINAL_SESSION_STATUSES.has(current.status as SessionStatus) && current.status !== SESSION_STATUS.SUSPENDED) {
        if (ctx.taskId) {
          emit("task.updated", { taskId: ctx.taskId, workspaceId: ctx.workspaceId });
        }
      }
    } catch (err) {
      const current = sessionStore.getSession(sessionId);
      if (current && !TERMINAL_SESSION_STATUSES.has(current.status as SessionStatus)) {
        // Transport error during active or idle session — suspend for auto-recovery
        // on reconnect. Don't publish child completion (session will resume).
        logger.info({ sessionId, err: String(err) }, "Stream lost — suspending session for recovery");
        sessionStore.suspendSession(sessionId);
        streamHub.publish(create(grackle.SessionEventSchema, {
          sessionId,
          type: grackle.EventType.STATUS,
          timestamp: new Date().toISOString(),
          content: SESSION_STATUS.SUSPENDED,
        }));
        if (ctx.taskId) {
          emit("task.updated", { taskId: ctx.taskId, workspaceId: ctx.workspaceId });
        }
      }
      // If already terminal (killAgent/completed/failed set status before transport
      // died), the session is in its correct final state and task.updated was already
      // emitted — skip the duplicate to avoid interfering with SIGCHLD delivery.
    } finally {
      processorRegistry.unregister(sessionId);
      logWriter.endSession(logPath);
      try { writeTranscript(logPath); } catch { /* non-critical */ }
    }
  })();
}
