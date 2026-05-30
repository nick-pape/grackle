/**
 * Subagent child-session materialization (#1075).
 *
 * When a parent session emits a delegation tool call (Claude Code `Agent`,
 * Copilot `task`/`read_agent`), the runtime SDK isolates the subagent's context
 * — the parent stream only carries the final summary, and the subagent has no
 * Grackle session of its own. This module materializes the subagent as a
 * **first-class child session** so it is addressable and navigable:
 *
 * - identity is derived deterministically from the parent + the delegation's
 *   identity key, so repeated references (e.g. Copilot `read_agent` polls) all
 *   resolve to the *same* child session (dedupe falls out of identity), and
 * - the child's activity is written to its own session log (durable
 *   `session_actions` + JSONL + live stream-hub), the same paths every session
 *   uses, so the existing session activity view renders it unchanged.
 *
 * SDK-internal subagents only surface their final summary, so the child's
 * activity starts as a "floor" (delegating prompt + result). The model is the
 * same as any other session, so the activity upgrades automatically if/when a
 * runtime exposes richer events.
 *
 * @module
 */

import { dirname, join } from "node:path";
import { create } from "@bufbuild/protobuf";
import {
  grackle,
  SESSION_STATUS,
  END_REASON,
  TERMINAL_SESSION_STATUSES,
  SUBAGENT_RUNTIME,
} from "@grackle-ai/common";
import type { DelegationInfo, SessionStatus } from "@grackle-ai/common";
import { sessionStore } from "@grackle-ai/database";
import { recordSessionAction } from "./session-action-recorder.js";
import * as streamHub from "./stream-hub.js";
import * as logWriter from "./log-writer.js";
import { logger } from "./logger.js";

/**
 * Maximum length of a floor activity entry (delegation prompt / result) written
 * to a child session. Subagent summaries can be large; cap to keep the log lean.
 */
const MAX_FLOOR_ENTRY_LENGTH: number = 16000;

/** Truncate a floor entry to {@link MAX_FLOOR_ENTRY_LENGTH}, appending an ellipsis marker. */
function clamp(text: string): string {
  if (text.length <= MAX_FLOOR_ENTRY_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_FLOOR_ENTRY_LENGTH)}\n…[truncated]`;
}

/**
 * Tool results often arrive JSON-wrapped (e.g. `{"is_ok":true,"content":"…"}`).
 * Extract the human-readable `content` string so the child's floor activity
 * shows clean text rather than the raw envelope. Returns the input unchanged if
 * it isn't a JSON object with a string `content` field.
 */
function unwrapResultContent(result: string): string {
  if (!result.trimStart().startsWith("{")) {
    return result;
  }
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    if (typeof parsed.content === "string") {
      return parsed.content;
    }
  } catch {
    /* not JSON — use as-is */
  }
  return result;
}

/**
 * Record one activity event on a child session via the same three sinks every
 * session uses: durable `session_actions` (serverSeq), JSONL (live read), and
 * the live stream-hub broadcast. Best-effort — failures are logged, not thrown.
 */
function recordChildEvent(
  childSessionId: string,
  logPath: string,
  type: grackle.EventType,
  content: string,
): void {
  const event = create(grackle.SessionEventSchema, {
    sessionId: childSessionId,
    type,
    timestamp: new Date().toISOString(),
    content: clamp(content),
  });
  // serverSeq first so the durable log, JSONL, and live push share a dedup key.
  event.serverSeq = recordSessionAction(event) ?? "";
  if (logPath) {
    logWriter.ensureLogInitialized(logPath);
    logWriter.writeEvent(logPath, event).catch((err: unknown) => {
      logger.error({ err, childSessionId }, "Failed to write subagent child event to JSONL");
    });
  }
  streamHub.publish(event);
}

/** Parameters for {@link ensureChildSession}. */
export interface EnsureChildSessionParams {
  /** Deterministic child session id (see {@link deriveChildSessionId}). */
  childSessionId: string;
  /** The delegating (parent) session id. */
  parentSessionId: string;
  /** Normalized delegation info parsed from the tool args. */
  info: DelegationInfo;
}

/**
 * Resolve-or-create the child session for a delegation. Idempotent: if the
 * child already exists (e.g. a `read_agent` poll following the original spawn,
 * or a re-emitted event), this is a no-op so no duplicate session or floor
 * action is created.
 *
 * The child is attached to its parent **session** (via `parentSessionId`), not a
 * task: it is created with `taskId=""` so it is invisible to every task-scoped
 * query (status computation, active/latest session lookups used for signal
 * routing, usage aggregation, reconciliation). It inherits the parent's
 * `environmentId` (the subagent ran in the parent's environment, and the
 * `sessions.env_id` foreign key requires a real environment), but the `subagent`
 * runtime marker keeps it out of env- and lifecycle-scoped queries
 * (`getActiveForEnv`, `listByEnv`, etc.) so reanimate/recovery never tries to
 * reconnect a virtual child. It remains addressable by id for navigation, and
 * the parent edge is recovered via `parentSessionId`. The log directory sits
 * alongside the parent's so the standard session activity view renders it.
 *
 * @param params - Child id, parent id, and parsed delegation info.
 */
export function ensureChildSession(params: EnsureChildSessionParams): void {
  const { childSessionId, parentSessionId, info } = params;
  if (sessionStore.getSession(childSessionId)) {
    return; // already materialized — dedupe
  }

  const parent = sessionStore.getSession(parentSessionId);
  if (!parent) {
    return; // can't attach a child to a parent that doesn't exist
  }
  // Child log dir sits alongside the parent's (same logs root); empty if the
  // parent is an ad-hoc session without a log path (then activity is session_actions-only).
  const logPath = parent.logPath ? join(dirname(parent.logPath), childSessionId) : "";

  sessionStore.createSession(
    childSessionId,
    parent.environmentId, // inherit parent's env (satisfies the env_id FK; subagent runtime excludes it from env queries)
    SUBAGENT_RUNTIME,
    info.prompt ?? "",
    info.model ?? "",
    logPath,
    "", // taskId — attached to the parent session, not a task (see above)
    "", // personaId
    parentSessionId,
    "", // pipeMode — not an IPC pipe child
  );
  sessionStore.updateSessionStatus(childSessionId, SESSION_STATUS.RUNNING);

  // Floor activity: the delegating prompt as the child's opening context.
  if (info.prompt) {
    recordChildEvent(childSessionId, logPath, grackle.EventType.USER_INPUT, info.prompt);
  }
}

/**
 * Append a result to a child session and mark it terminal. Called when the
 * delegation's paired `tool_result` arrives. No-op if the child does not exist.
 *
 * @param childSessionId - The child session id.
 * @param result - The subagent's result text (the summary, for SDK-internal subagents).
 * @param isError - Whether the tool result was an error.
 */
export function closeChildSession(childSessionId: string, result: string, isError: boolean): void {
  const session = sessionStore.getSession(childSessionId);
  if (!session) {
    return;
  }
  // Idempotent: a replayed/reanimated tool_result must not append the summary
  // again to an already-terminal child.
  if (TERMINAL_SESSION_STATUSES.has(session.status as SessionStatus)) {
    return;
  }
  if (result) {
    recordChildEvent(
      childSessionId,
      session.logPath ?? "",
      grackle.EventType.TEXT,
      unwrapResultContent(result),
    );
  }
  sessionStore.updateSession(
    childSessionId,
    SESSION_STATUS.STOPPED,
    undefined,
    isError ? result : undefined,
    isError ? END_REASON.INTERRUPTED : END_REASON.COMPLETED,
  );
}

/**
 * Append incremental activity to an existing child session without closing it.
 * Used for `read_agent` polls that surface partial output while the subagent is
 * still running. No-op if the child does not exist or the content is empty.
 *
 * @param childSessionId - The child session id.
 * @param content - Incremental output to append.
 */
export function appendChildActivity(childSessionId: string, content: string): void {
  if (!content) {
    return;
  }
  const session = sessionStore.getSession(childSessionId);
  if (!session) {
    return;
  }
  recordChildEvent(
    childSessionId,
    session.logPath ?? "",
    grackle.EventType.TEXT,
    unwrapResultContent(content),
  );
}

/**
 * Mark a still-open child session as interrupted (terminal) without recording a
 * result. Called when the parent stream ends while a delegation is still
 * outstanding (e.g. the parent crashed mid-subagent), so a child is never left
 * stranded in `RUNNING` with no environment to reconnect to. No-op if the child
 * does not exist or is already terminal.
 *
 * @param childSessionId - The child session id.
 */
export function interruptChildSession(childSessionId: string): void {
  const session = sessionStore.getSession(childSessionId);
  if (!session || TERMINAL_SESSION_STATUSES.has(session.status as SessionStatus)) {
    return;
  }
  sessionStore.updateSession(
    childSessionId,
    SESSION_STATUS.STOPPED,
    undefined,
    undefined,
    END_REASON.INTERRUPTED,
  );
}
