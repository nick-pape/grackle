/**
 * Hand-authored `AgentEvent` fixtures for the mapper replay test, modeled on
 * what the real runtimes emit. A complementary stub-derived stream is captured
 * live in `mapper.test.ts`.
 *
 * Refreshed against `main` (all groundwork HRs):
 *   • HR3 (#1287): tool events carry first-class `toolCallId`.
 *   • HR7 (#1290): lifecycle system messages carry `diagnostic`.
 *   • HR2 (#1286): turns are opened by `turn_started` (real userMessage) and
 *     closed by `turn_complete`, with a stable `turnId`. No more synthesis.
 */

import type { AgentEvent } from "@grackle-ai/runtime-sdk";
import { SessionLifecycle, SessionStatus, type SessionState } from "@grackle-ai/ahp";

/** Fixed timestamp so fixtures are deterministic. */
const TS = "2026-05-21T00:00:00.000Z";

/** Optional first-class AgentEvent fields a fixture may set. */
interface EvOpts {
  /** Original runtime payload (still read for tool-result error detection). */
  raw?: unknown;
  /** Stable tool-call id (HR3). */
  toolCallId?: string;
  /** Runtime lifecycle/diagnostic marker (HR7). */
  diagnostic?: boolean;
  /** Turn id (HR2) — stamps the event as belonging to a specific turn. */
  turnId?: string;
}

/** Build an AgentEvent tersely. */
function ev(type: AgentEvent["type"], content: string, opts?: EvOpts): AgentEvent {
  return {
    type,
    timestamp: TS,
    content,
    ...(opts?.raw !== undefined ? { raw: opts.raw } : {}),
    ...(opts?.toolCallId !== undefined ? { toolCallId: opts.toolCallId } : {}),
    ...(opts?.diagnostic !== undefined ? { diagnostic: opts.diagnostic } : {}),
    ...(opts?.turnId !== undefined ? { turnId: opts.turnId } : {}),
  };
}

/**
 * A fresh, just-created AHP session state to seed the reducer with — the shape
 * a host hands a client right after `createSession` + `session/ready`.
 */
export function makeInitialSessionState(resource = "ahp-session:/spike"): SessionState {
  return {
    summary: {
      resource,
      provider: "stub",
      title: "Spike Session",
      status: SessionStatus.Idle,
      createdAt: 1000,
      modifiedAt: 1000,
    },
    lifecycle: SessionLifecycle.Ready,
    turns: [],
  };
}

/**
 * Happy path: a pre-turn diagnostic + runtimeSessionId, a real turn opened by
 * `turn_started` with the actual prompt text, assistant text, a tool call paired
 * by its first-class `toolCallId` (HR3), more text, usage, then `turn_complete`.
 */
export const happyPath: AgentEvent[] = [
  ev("system", "Starting runtime…", { diagnostic: true }),
  ev("runtime_session_id", "rt-abc-123"),
  ev("turn_started", "say hello", { turnId: "t-1" }),
  ev("text", "Hello — I'll take a look.", { turnId: "t-1" }),
  ev("tool_use", JSON.stringify({ tool: "read_file", args: { path: "/src/index.ts" } }), {
    toolCallId: "toolu_1",
    turnId: "t-1",
  }),
  ev("tool_result", "export const x = 1;", {
    toolCallId: "toolu_1",
    raw: { is_error: false },
    turnId: "t-1",
  }),
  ev("text", "Done — it looks fine.", { turnId: "t-1" }),
  ev("usage", JSON.stringify({ input_tokens: 150, output_tokens: 50, cost_millicents: 12 }), {
    turnId: "t-1",
  }),
  ev("turn_complete", "", { turnId: "t-1" }),
  // status=completed fires after turn_complete (Grackle lifecycle signal);
  // the mapper drops it as redundant with the real turn_complete.
  ev("status", "completed"),
];

/**
 * A turn that ends in an error mid-flight. The `error` event closes the turn;
 * no `turn_complete` fires for error paths.
 */
export const errorPath: AgentEvent[] = [
  ev("turn_started", "attempt the change", { turnId: "t-1" }),
  ev("text", "Attempting the change.", { turnId: "t-1" }),
  ev("error", "boom: the SDK threw", { turnId: "t-1" }),
];

/**
 * Defensive missing-id fallback: a tool stream with NO `toolCallId` (e.g. a
 * pre-HR3 captured log). Post-HR3 every real runtime populates `toolCallId`, so
 * this exists only to exercise the last-open pairing fallback.
 */
export const missingIdFallback: AgentEvent[] = [
  ev("turn_started", "run bash", { turnId: "t-1" }),
  ev("tool_use", JSON.stringify({ tool: "bash", args: { cmd: "ls" } }), { turnId: "t-1" }),
  ev("tool_result", "file-a\nfile-b", { raw: { status: "completed" }, turnId: "t-1" }),
  ev("turn_complete", "", { turnId: "t-1" }),
];

/**
 * A session that fails before any turn opens (e.g. a setup/auth failure). There
 * is no `turn_started` — the failure arrives pre-turn, exercising the
 * `session/creationFailed` path.
 */
export const preTurnFailure: AgentEvent[] = [
  ev("system", "Starting runtime…", { diagnostic: true }),
  ev("status", "failed"),
];
