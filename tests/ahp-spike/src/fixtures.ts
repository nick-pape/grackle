/**
 * Hand-authored `AgentEvent` fixtures for the mapper replay test, modeled on
 * what the real runtimes emit (see the StubRuntime scenario system and the
 * Claude/ACP runtimes). A complementary stub-derived stream is captured live in
 * `mapper.test.ts`.
 *
 * Refreshed against `main`: tool events carry the first-class
 * `toolCallId` (HR3 #1287) and lifecycle messages carry `diagnostic` (HR7
 * #1290), mirroring what the production runtimes now emit.
 */

import type { AgentEvent } from "@grackle-ai/runtime-sdk";
import { SessionLifecycle, SessionStatus } from "./vendor/ahp/channels-session/state.js";
import type { SessionState } from "./vendor/ahp/channels-session/state.js";

/** Fixed timestamp so fixtures are deterministic. */
const TS = "2026-05-21T00:00:00.000Z";

/** Optional first-class AgentEvent fields a fixture may set. */
interface EvOpts {
  /** Original runtime payload (still read for tool-result error detection). */
  raw?: unknown;
  /** Stable tool-call id (HR3) — pairs tool_use ↔ tool_result. */
  toolCallId?: string;
  /** Runtime lifecycle/diagnostic marker (HR7). */
  diagnostic?: boolean;
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
 * Happy path: a pre-turn diagnostic, assistant text, a tool call paired by its
 * first-class `toolCallId` (HR3), more text, usage, and a clean completion.
 */
export const happyPath: AgentEvent[] = [
  ev("system", "Starting runtime…", { diagnostic: true }),
  ev("runtime_session_id", "rt-abc-123"),
  ev("text", "Hello — I'll take a look."),
  ev(
    "tool_use",
    JSON.stringify({ tool: "read_file", args: { path: "/src/index.ts" } }),
    { toolCallId: "toolu_1" },
  ),
  ev("tool_result", "export const x = 1;", { toolCallId: "toolu_1", raw: { is_error: false } }),
  ev("text", "Done — it looks fine."),
  ev("usage", JSON.stringify({ input_tokens: 150, output_tokens: 50, cost_millicents: 12 })),
  ev("status", "completed"),
];

/** A turn that ends in an error mid-flight. */
export const errorPath: AgentEvent[] = [
  ev("text", "Attempting the change."),
  ev("error", "boom: the SDK threw"),
];

/**
 * Defensive missing-id fallback: a tool stream with NO `toolCallId` (e.g. a
 * pre-HR3 captured log, or a hypothetical id-less runtime). Post-HR3 every real
 * runtime populates `toolCallId`, so this no longer reflects any live runtime —
 * it exists only to exercise the mapper's last-open fallback pairing.
 */
export const missingIdFallback: AgentEvent[] = [
  ev("tool_use", JSON.stringify({ tool: "bash", args: { cmd: "ls" } })),
  ev("tool_result", "file-a\nfile-b", { raw: { status: "completed" } }),
  ev("status", "completed"),
];

/**
 * A session that fails before any turn opens (e.g. a setup/auth failure). There
 * is no turn to error on, so this exercises the pre-turn failure path. The
 * "Starting runtime…" lifecycle message is flagged diagnostic (HR7).
 */
export const preTurnFailure: AgentEvent[] = [
  ev("system", "Starting runtime…", { diagnostic: true }),
  ev("status", "failed"),
];
