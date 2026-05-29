import { create } from "@bufbuild/protobuf";
import {
  grackle,
  eventTypeToEnum,
  SESSION_STATUS,
  TERMINAL_SESSION_STATUSES,
  END_REASON,
  detectDelegation,
  delegationIdentityKey,
  deriveChildSessionId,
  readAgentResultStatus,
} from "@grackle-ai/common";
import type { SessionStatus } from "@grackle-ai/common";
import type { ServerActionEnvelope } from "@grackle-ai/adapter-sdk";
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
import { ensureChildSession, closeChildSession, appendChildActivity } from "./subagent-session.js";
import { cleanupLifecycleStream } from "./lifecycle-streams.js";
import { sendInputToSession } from "./signals/signal-delivery.js";
import { checkBudget } from "./budget-checker.js";
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
    event.serverSeq = recordSessionAction(event) ?? "";
    const session = sessionStore.getSession(sessionId);
    if (session?.logPath) {
      logWriter.ensureLogInitialized(session.logPath);
      logWriter.writeEvent(session.logPath, event).catch((err: unknown) => {
        logger.error({ err, sessionId }, "Failed to persist widget event");
      });
    }
    streamHub.publish(event);
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
  envelopes: AsyncIterable<ServerActionEnvelope>,
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

  /** Inner processing logic, extracted so it can be wrapped in runWithTrace. */
  const processEvents = async (): Promise<void> => {
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
        // Stamp the ULID BEFORE persisting + broadcasting so the UI's dedup
        // key (`serverSeq` first, `${timestamp}|${eventType}` fallback) is
        // consistent across the WS push, the JSONL replay, and `session_actions`.
        sysCtxEvent.serverSeq = recordSessionAction(sysCtxEvent) ?? "";
        await logWriter.writeEvent(logPath, sysCtxEvent);
        streamHub.publish(sysCtxEvent);
      }
      if (options.prompt && options.taskId) {
        const promptEvent = create(grackle.SessionEventSchema, {
          sessionId,
          type: grackle.EventType.USER_INPUT,
          timestamp: new Date().toISOString(),
          content: options.prompt,
        });
        promptEvent.serverSeq = recordSessionAction(promptEvent) ?? "";
        await logWriter.writeEvent(logPath, promptEvent);
        streamHub.publish(promptEvent);
      }

      // #1075: maps a delegation tool_use call id → the child session it
      // materialized, so the paired tool_result can append/close that child.
      // Scoped to this stream (per parent session), so no cross-session leakage.
      const delegationByToolCall = new Map<
        string,
        { childId: string; isPoll: boolean; isBackground: boolean }
      >();

      for await (const envelope of envelopes) {
        const event = envelope.event;
        // Normalize optional AgentEventFields to proto-default semantics so
        // BOTH downstream string operations and the grackle.SessionEvent
        // we persist/broadcast see non-undefined values consistently — proto
        // string fields default to "" and bool to false anyway, so this just
        // makes the intent explicit at the source.
        const eventContent: string = event.content ?? "";
        // AHP wire boundary: the AHP forward mapper doesn't carry `timestamp`
        // through StateAction (the spec has no per-action timestamp), so events
        // arrive here with timestamp="". Synthesize one at receive time so the
        // UI can sort/dedupe (the dedup key in `useSessions.loadSessionEvents`
        // is `${timestamp}|${eventType}`, and two events sharing `""|system`
        // would collapse into one). The synthesized timestamp is approximate
        // (when consumer received it, not when producer emitted), which is
        // acceptable for display purposes — events still arrive in causal
        // order via the action stream's serverSeq monotonicity.
        const eventTimestamp: string = event.timestamp || new Date().toISOString();
        const eventRaw: string = event.raw ?? "";
        const eventToolCallId: string = event.toolCallId ?? "";
        const eventTurnId: string = event.turnId ?? "";
        const eventDiagnostic: boolean = event.diagnostic ?? false;
        const eventToolError: boolean = event.toolError ?? false;
        // runtime_session_id is an internal control event: persist it then skip
        // logging/publishing — it has no proto enum value and is not client-visible.
        if (event.type === "runtime_session_id") {
          if (eventContent) {
            sessionStore.updateRuntimeSessionId(sessionId, eventContent);
          }
          continue;
        }

        const sessionEvent = create(grackle.SessionEventSchema, {
          sessionId,
          type: eventTypeToEnum(event.type),
          timestamp: eventTimestamp,
          content: eventContent,
          raw: eventRaw,
          toolCallId: eventToolCallId,
          diagnostic: eventDiagnostic,
          turnId: eventTurnId,
          toolError: eventToolError,
        });
        // ULID first — JSONL + WS push carry it so the UI can dedup/sort on
        // a stable key independent of the (possibly synthesized) timestamp.
        sessionEvent.serverSeq = recordSessionAction(sessionEvent) ?? "";
        await logWriter.writeEvent(logPath, sessionEvent);
        streamHub.publish(sessionEvent);

        // HR7: tee runtime diagnostics to the additive OTLP logs sink (no-op
        // unless OTEL_EXPORTER_OTLP_ENDPOINT is set). Existing sinks above are
        // unchanged — diagnostics still flow to JSONL/streamHub/session_actions.
        if (sessionEvent.diagnostic) {
          emitDiagnostic(sessionEvent);
        }

        // #1075: materialize/link subagent child sessions from delegation tool
        // calls (Claude Code `Agent`, Copilot `task`/`read_agent`). The child is
        // a first-class session so the existing activity view can render it.
        if (event.type === "tool_use" && eventToolCallId) {
          try {
            const parsed = JSON.parse(eventContent || "{}") as Record<string, unknown>;
            const toolName = String(parsed.tool ?? parsed.tool_name ?? parsed.name ?? "");
            const toolArgs = parsed.args ?? parsed.input ?? parsed.arguments;
            const info = toolName ? detectDelegation(toolName, toolArgs) : undefined;
            if (info) {
              const identityKey = delegationIdentityKey(info, eventToolCallId);
              const childId = deriveChildSessionId(sessionId, identityKey);
              ensureChildSession({
                childSessionId: childId,
                parentSessionId: sessionId,
                taskId: ctx.taskId,
                info,
              });
              delegationByToolCall.set(eventToolCallId, {
                childId,
                isPoll: info.isPoll === true,
                isBackground: info.isBackground === true,
              });
            }
          } catch (err) {
            logger.warn({ err, sessionId }, "Failed to process delegation tool_use");
          }
        } else if (event.type === "tool_result" && eventToolCallId) {
          const link = delegationByToolCall.get(eventToolCallId);
          if (link) {
            if (link.isPoll) {
              // A read_agent poll surfaces partial output; append it, and close
              // the child only when the poll reports a terminal status.
              appendChildActivity(link.childId, eventContent);
              const status = readAgentResultStatus(eventContent);
              if (status === "completed" || status === "failed" || status === "error") {
                closeChildSession(link.childId, eventContent, status !== "completed");
                delegationByToolCall.delete(eventToolCallId);
              }
            } else if (link.isBackground) {
              // A background spawn's result is just a handle, not completion —
              // keep the child running; its output arrives via read_agent polls.
              appendChildActivity(link.childId, eventContent);
            } else {
              // Synchronous spawn (e.g. Claude `Agent`): the result IS the summary.
              closeChildSession(link.childId, eventContent, eventToolError);
              delegationByToolCall.delete(eventToolCallId);
            }
          }
        }

        // Intercept usage events and accumulate token counts on the session record
        if (event.type === "usage") {
          try {
            const data = JSON.parse(eventContent || "{}") as {
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
          // Terminal session status is sticky: once a session is STOPPED (e.g.
          // killed), a late or raced non-terminal status (`waiting_input` /
          // `running`) from the runtime's abort must NOT flip it back to alive
          // (#1356). Terminal transitions below still apply (they are
          // idempotent re-writes of STOPPED).
          const statusSession = sessionStore.getSession(sessionId);
          const isTerminal =
            statusSession !== undefined &&
            TERMINAL_SESSION_STATUSES.has(statusSession.status as SessionStatus);
          // Map runtime status strings to our session status model
          if (eventContent === "waiting_input") {
            if (!isTerminal) {
              sessionStore.updateSessionStatus(sessionId, SESSION_STATUS.IDLE);
            }
          } else if (eventContent === "running") {
            if (!isTerminal) {
              sessionStore.updateSessionStatus(sessionId, SESSION_STATUS.RUNNING);
            }
          } else if (eventContent === "completed") {
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
          } else if (eventContent === "killed") {
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
          } else if (eventContent === "failed") {
            sessionStore.updateSession(
              sessionId,
              SESSION_STATUS.STOPPED,
              undefined,
              undefined,
              END_REASON.INTERRUPTED,
            );
            cleanupLifecycleStream(sessionId);
          } else if (eventContent === "terminated") {
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
            ["completed", "killed", "failed", "terminated", "waiting_input"].includes(eventContent)
          ) {
            await publishChildCompletion(sessionId, eventContent);
          }

          // On abnormal exit (killed/failed), write a minimal server-enriched workpad
          // if no workpad exists yet on the task.
          if (ctx.taskId && ["killed", "failed"].includes(eventContent)) {
            try {
              const task = taskStore.getTask(ctx.taskId);
              if (task && !task.workpad) {
                const minimalWorkpad = JSON.stringify({
                  status: eventContent,
                  summary: `Session ended abnormally (${eventContent}). No agent-reported workpad.`,
                  extra: { endReason: eventContent, sessionId },
                });
                taskStore.setWorkpad(ctx.taskId, minimalWorkpad);
              }
            } catch (err) {
              logger.warn({ err, sessionId }, "Failed to write server-enriched workpad");
            }
          }

          // Broadcast task_updated on status changes so frontend re-fetches computed status.
          // This covers both terminal events (completed/killed/failed) and non-terminal
          // transitions (running, waiting_input) that affect the computed task status.
          if (
            ctx.taskId &&
            ["completed", "killed", "failed", "terminated", "running", "waiting_input"].includes(
              eventContent,
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
        suspendedEvent.serverSeq = recordSessionAction(suspendedEvent) ?? "";
        streamHub.publish(suspendedEvent);
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
