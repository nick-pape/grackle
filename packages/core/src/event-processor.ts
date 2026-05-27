import { create } from "@bufbuild/protobuf";
import {
  grackle,
  powerline,
  eventTypeToEnum,
  SESSION_STATUS,
  TERMINAL_SESSION_STATUSES,
  END_REASON,
} from "@grackle-ai/common";
import type { SessionStatus } from "@grackle-ai/common";
import { sessionStore, taskStore } from "@grackle-ai/database";
import { recordSessionAction } from "./session-action-recorder.js";
import * as streamHub from "./stream-hub.js";
import * as logWriter from "./log-writer.js";
import * as processorRegistry from "./processor-registry.js";
import { writeTranscript } from "./transcript.js";
import { emit } from "./event-bus.js";
import { logger } from "./logger.js";
import { runWithTrace } from "./trace-context.js";
import { emitDiagnostic } from "./telemetry.js";
import { publishChildCompletion } from "./pipe-delivery.js";
import { cleanupLifecycleStream } from "./lifecycle-streams.js";
import { sendInputToSession } from "./signals/signal-delivery.js";
import { checkBudget } from "./budget-checker.js";
import type { ProcessorContext } from "./processor-registry.js";
import { SessionStateManager } from "./ahp-session-state.js";

/**
 * Construct a minimal AgentEvent for injected events (system context, initial prompt).
 * Uses the protobuf `create()` helper so the result satisfies the `AgentEvent`
 * type contract without unsafe casts.
 */
function makeAgentEvent(
  sessionId: string,
  type: string,
  content: string,
  raw?: string,
  turnId?: string,
): powerline.AgentEvent {
  return create(powerline.AgentEventSchema, {
    sessionId,
    type,
    timestamp: new Date().toISOString(),
    content,
    raw: raw ?? "",
    toolCallId: "",
    diagnostic: false,
    turnId: turnId ?? "",
  });
}

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
  /** Trace ID for correlating logs across the request lifecycle. */
  traceId?: string;
}

/** Payload for an MCP Apps widget render event pushed into a session stream. */
export interface WidgetEventPayload {
  /** The `ui://` resource the widget renders (may be empty for one-off renders). */
  resourceUri: string;
  /** Name of the tool that produced the widget. */
  toolName: string;
  /** Widget HTML (`text/html;profile=mcp-app`). */
  html: string;
  /**
   * Renderer the frontend should dispatch to. `"mcp-app-html"` (default when
   * omitted) renders `html` in the sandbox; future kinds (e.g. declarative) add
   * cases without changing this contract.
   */
  rendererKind?: string;
  /** CSP for the sandbox (`resourceDomains`/`connectDomains` + `allowInlineScripts`). */
  csp?: unknown;
  /** Tool input arguments / render-time props. */
  toolInput?: Record<string, unknown>;
  /** Tool result (an MCP `CallToolResult`). */
  toolResult?: unknown;
  /** Registry id when rendering a registered widget (#1239). */
  widgetId?: string;
  /** Registry version, when known. */
  version?: number;
  /**
   * Resolved registry components this render composes from, in eval order
   * (deepest first). The grackle-react runtime evaluates each into scope before
   * the main body so it can reference them as JSX tags (#1270 composition).
   */
  components?: Array<{ name: string; body: string }>;
}

/** Callback that pushes a widget event into a session's stream (injected into the MCP server). */
export type PublishWidgetEvent = (sessionId: string, payload: WidgetEventPayload) => void;

/**
 * Publish an MCP Apps widget render event into a session's event stream.
 *
 * Called by Grackle's MCP server (the broker) when an agent invokes a widget
 * tool. The event is self-contained (resource HTML + tool input/result) so the
 * web chat renders it without contacting the MCP server. Persisted to the
 * session log (replays on reload) and broadcast live. Non-fatal on error.
 */
export function publishWidgetEvent(sessionId: string, payload: WidgetEventPayload): void {
  try {
    const event = create(grackle.SessionEventSchema, {
      sessionId,
      type: grackle.EventType.WIDGET,
      timestamp: new Date().toISOString(),
      content: JSON.stringify(payload),
      raw: JSON.stringify({ widget: true, toolName: payload.toolName }),
    });
    const session = sessionStore.getSession(sessionId);
    if (session?.logPath) {
      logWriter.ensureLogInitialized(session.logPath);
      logWriter.writeEvent(session.logPath, event).catch((err: unknown) => {
        logger.error({ err, sessionId }, "Failed to persist widget event");
      });
    }
    streamHub.publish(event);
    recordSessionAction(event);
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to publish widget event");
  }
}

/**
 * Process an async iterable of agent events from a PowerLine spawn or resume stream.
 * Handles event transformation, logging, status updates, and cleanup.
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

  processorRegistry.register(ctx);

  // AHP HR1b: session state manager — mapper + reducer + snapshots
  const stateManager = new SessionStateManager(sessionId);

  /** Inner processing logic, extracted so it can be wrapped in runWithTrace. */
  const processEvents = async (): Promise<void> => {
    let lastServerSeq: string | undefined;
    let terminalSnapshotFlushed: boolean = false;
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
        await logWriter.writeEvent(logPath, sysCtxEvent);
        streamHub.publish(sysCtxEvent);
        const sysSeq = recordSessionAction(sysCtxEvent);
        if (sysSeq) {
          lastServerSeq = sysSeq;
          // System events are dropped by the mapper when there's no active turn (no turn_started yet).
          // The mapper only processes system events within an active turn context.
          stateManager.processEvent(
            makeAgentEvent(sessionId, "system", options.systemContext),
            sysSeq,
          );
        }
      }
      if (options.prompt && options.taskId) {
        const promptEvent = create(grackle.SessionEventSchema, {
          sessionId,
          type: grackle.EventType.USER_INPUT,
          timestamp: new Date().toISOString(),
          content: options.prompt,
        });
        await logWriter.writeEvent(logPath, promptEvent);
        streamHub.publish(promptEvent);
        const promptSeq = recordSessionAction(promptEvent);
        if (promptSeq) {
          lastServerSeq = promptSeq;
          stateManager.processEvent(
            makeAgentEvent(
              sessionId,
              "turn_started",
              JSON.stringify({ user_message: options.prompt }),
            ),
            promptSeq,
          );
          // Mark so the runtime's first turn_started is deduplicated.
          stateManager.markInjectedInitialTurn();
        }
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
          toolCallId: event.toolCallId,
          diagnostic: event.diagnostic,
          turnId: event.turnId,
        });
        await logWriter.writeEvent(logPath, sessionEvent);
        streamHub.publish(sessionEvent);
        const serverSeq = recordSessionAction(sessionEvent);
        if (serverSeq) {
          lastServerSeq = serverSeq;
          // AHP HR1b: process event through state manager (mapper + reducer + snapshot)
          // Pass serverSeq so snapshots are anchored to real action ULIDs for reconstruction.
          stateManager.processEvent(event, serverSeq);
        }

        // HR7: tee runtime diagnostics to the additive OTLP logs sink (no-op
        // unless OTEL_EXPORTER_OTLP_ENDPOINT is set). Existing sinks above are
        // unchanged — diagnostics still flow to JSONL/streamHub/session_actions.
        if (sessionEvent.diagnostic) {
          emitDiagnostic(sessionEvent);
        }

        // Intercept usage events and accumulate token counts on the session record
        if (event.type === "usage") {
          try {
            const data = JSON.parse(event.content) as {
              input_tokens?: number;
              output_tokens?: number;
              cost_millicents?: number;
            };
            const inputTokens = Number.isFinite(data.input_tokens)
              ? Math.max(0, Math.trunc(data.input_tokens as number))
              : 0;
            const outputTokens = Number.isFinite(data.output_tokens)
              ? Math.max(0, Math.trunc(data.output_tokens as number))
              : 0;
            const costMillicents = Number.isFinite(data.cost_millicents)
              ? Math.max(0, Math.trunc(data.cost_millicents as number))
              : 0;
            if (inputTokens > 0 || outputTokens > 0 || costMillicents > 0) {
              sessionStore.updateSessionUsage(sessionId, inputTokens, outputTokens, costMillicents);

              // ── Post-usage budget check ──
              if (ctx.taskId && !ctx.budgetSigtermSent) {
                const budgetResult = checkBudget(ctx.taskId, ctx.workspaceId);
                if (budgetResult) {
                  const session = sessionStore.getSession(sessionId);
                  if (
                    session &&
                    !session.sigtermSentAt &&
                    !TERMINAL_SESSION_STATUSES.has(session.status as SessionStatus)
                  ) {
                    const sigMessage =
                      `[SIGTERM] Budget exceeded (${budgetResult.scope} ${budgetResult.reason}): ${budgetResult.message}. ` +
                      "Finish your current operation, save your work, close any open IPC fds, " +
                      "then call task_complete and stop.";
                    sessionStore.setSigtermSentAt(sessionId);
                    ctx.budgetSigtermSent = true;
                    sendInputToSession(
                      sessionId,
                      session.environmentId,
                      sigMessage,
                      "budget_exceeded",
                    )
                      .then((delivered: boolean) => {
                        if (!delivered) {
                          logger.error(
                            { sessionId },
                            "Budget-exceeded SIGTERM delivery failed (env not connected)",
                          );
                          sessionStore.clearSigtermSentAt(sessionId);
                          ctx.budgetSigtermSent = false;
                        }
                      })
                      .catch((err: unknown) => {
                        logger.error(
                          { err, sessionId },
                          "Failed to deliver budget-exceeded SIGTERM",
                        );
                        sessionStore.clearSigtermSentAt(sessionId);
                        ctx.budgetSigtermSent = false;
                      });
                    logger.info(
                      {
                        sessionId,
                        taskId: ctx.taskId,
                        scope: budgetResult.scope,
                        reason: budgetResult.reason,
                      },
                      "Budget exceeded - SIGTERM sent",
                    );
                  }
                }
              }
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
            // Derive end reason: budget SIGTERM → BUDGET_EXCEEDED, user SIGTERM → TERMINATED, normal → COMPLETED
            const session = sessionStore.getSession(sessionId);
            const endReason = ctx.budgetSigtermSent
              ? END_REASON.BUDGET_EXCEEDED
              : session?.sigtermSentAt
                ? END_REASON.TERMINATED
                : END_REASON.COMPLETED;
            sessionStore.updateSession(
              sessionId,
              SESSION_STATUS.STOPPED,
              undefined,
              undefined,
              endReason,
            );
          } else if (event.content === "killed") {
            const killedEndReason = ctx.budgetSigtermSent
              ? END_REASON.BUDGET_EXCEEDED
              : END_REASON.KILLED;
            sessionStore.updateSession(
              sessionId,
              SESSION_STATUS.STOPPED,
              undefined,
              undefined,
              killedEndReason,
            );
          } else if (event.content === "failed") {
            sessionStore.updateSession(
              sessionId,
              SESSION_STATUS.STOPPED,
              undefined,
              undefined,
              END_REASON.INTERRUPTED,
            );
            cleanupLifecycleStream(sessionId);
          } else if (event.content === "terminated") {
            const terminatedEndReason = ctx.budgetSigtermSent
              ? END_REASON.BUDGET_EXCEEDED
              : END_REASON.TERMINATED;
            sessionStore.updateSession(
              sessionId,
              SESSION_STATUS.STOPPED,
              undefined,
              undefined,
              terminatedEndReason,
            );
          }

          // On terminal status (or idle for sync pipes): publish child completion
          // to IPC pipe stream. `waiting_input` is included so that sync pipes
          // unblock when a child goes idle without calling task_complete (#824).
          // publishChildCompletion internally skips waiting_input for async pipes.
          if (
            ["completed", "killed", "failed", "terminated", "waiting_input"].includes(event.content)
          ) {
            await publishChildCompletion(sessionId, event.content);
          }

          // On abnormal exit (killed/failed), write a minimal server-enriched workpad
          // if no workpad exists yet on the task.
          if (ctx.taskId && ["killed", "failed"].includes(event.content)) {
            try {
              const task = taskStore.getTask(ctx.taskId);
              if (task && !task.workpad) {
                const minimalWorkpad = JSON.stringify({
                  status: event.content,
                  summary: `Session ended abnormally (${event.content}). No agent-reported workpad.`,
                  extra: { endReason: event.content, sessionId },
                });
                taskStore.setWorkpad(ctx.taskId, minimalWorkpad);
              }
            } catch (err) {
              logger.warn({ err, sessionId }, "Failed to write server-enriched workpad");
            }
          }

          // AHP HR1b: flush snapshot on terminal status for clean state capture
          // Guard: serverSeq is undefined when recordSessionAction() silently fails.
          if (
            ["completed", "killed", "failed", "terminated"].includes(event.content) &&
            serverSeq
          ) {
            try {
              const result = stateManager.snapshot(serverSeq);
              if (result.persisted) {
                terminalSnapshotFlushed = true;
              }
            } catch {
              /* non-critical */
            }
          }

          // Broadcast task_updated on status changes so frontend re-fetches computed status.
          // This covers both terminal events (completed/killed/failed) and non-terminal
          // transitions (running, waiting_input) that affect the computed task status.
          if (
            ctx.taskId &&
            ["completed", "killed", "failed", "terminated", "running", "waiting_input"].includes(
              event.content,
            )
          ) {
            emit("task.updated", { taskId: ctx.taskId, workspaceId: ctx.workspaceId });
          }
        }
      }

      // Fallback: if stream ended without a terminal status event, emit a UI refresh
      // without changing status. Guard against overwriting terminal or SUSPENDED states.
      const current = sessionStore.getSession(sessionId);
      if (
        current &&
        !TERMINAL_SESSION_STATUSES.has(current.status as SessionStatus) &&
        current.status !== SESSION_STATUS.SUSPENDED
      ) {
        if (ctx.taskId) {
          emit("task.updated", { taskId: ctx.taskId, workspaceId: ctx.workspaceId });
        }
      }
    } catch (err) {
      // Track the serverSeq from the suspended event for the final snapshot below
      const current = sessionStore.getSession(sessionId);
      if (current && !TERMINAL_SESSION_STATUSES.has(current.status as SessionStatus)) {
        // Transport error during active or idle session — suspend for auto-recovery
        // on reconnect. Don't publish child completion (session will resume).
        logger.info(
          {
            sessionId,
            err: String(err),
            errorName: err instanceof Error ? err.name : typeof err,
            errorCode: (err as { code?: string }).code,
          },
          "Stream lost — suspending session for recovery",
        );
        sessionStore.suspendSession(sessionId);
        const suspendedEvent = create(grackle.SessionEventSchema, {
          sessionId,
          type: grackle.EventType.STATUS,
          timestamp: new Date().toISOString(),
          content: SESSION_STATUS.SUSPENDED,
        });
        streamHub.publish(suspendedEvent);
        const suspSeq = recordSessionAction(suspendedEvent);
        if (suspSeq) {
          lastServerSeq = suspSeq;
          stateManager.processEvent(
            makeAgentEvent(sessionId, "status", SESSION_STATUS.SUSPENDED),
            suspSeq,
          );
        }
        if (ctx.taskId) {
          emit("task.updated", { taskId: ctx.taskId, workspaceId: ctx.workspaceId });
        }
      }
      // If already terminal (killAgent/completed/failed set status before transport
      // died), the session is in its correct final state and task.updated was already
      // emitted — skip the duplicate to avoid interfering with SIGCHLD delivery.
    } finally {
      // AHP HR1b: flush final snapshot on stream completion.
      // Skip if terminal status already flushed a snapshot (avoids duplicates with same serverSeq).
      if (lastServerSeq && !terminalSnapshotFlushed) {
        try {
          stateManager.snapshot(lastServerSeq);
        } catch {
          /* non-critical */
        }
      }
      stateManager.clear();

      processorRegistry.unregister(sessionId);
      logWriter.endSession(logPath);
      try {
        writeTranscript(logPath);
      } catch {
        /* non-critical */
      }
    }
  };

  if (options.traceId) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    runWithTrace(options.traceId, processEvents);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    processEvents();
  }
}
