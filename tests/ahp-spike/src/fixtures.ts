/**
 * Hand-authored `AgentEvent` fixtures for the mapper replay test, modeled on
 * what the real runtimes emit (see the StubRuntime scenario system and the
 * Claude/ACP runtimes). A complementary stub-derived stream is captured live in
 * `mapper.test.ts`.
 */

import type { AgentEvent } from "@grackle-ai/runtime-sdk";
import { SessionLifecycle, SessionStatus } from "./vendor/ahp/channels-session/state.js";
import type { SessionState } from "./vendor/ahp/channels-session/state.js";

/** Fixed timestamp so fixtures are deterministic. */
const TS = "2026-05-21T00:00:00.000Z";

/** Build an AgentEvent tersely. */
function ev(type: AgentEvent["type"], content: string, raw?: unknown): AgentEvent {
  return raw === undefined ? { type, timestamp: TS, content } : { type, timestamp: TS, content, raw };
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
 * Happy path: a single turn with assistant text, a tool call paired by an
 * explicit raw id (Claude-style), more text, usage, and a clean completion.
 */
export const happyPath: AgentEvent[] = [
  ev("system", "Stub runtime initialized"),
  ev("runtime_session_id", "rt-abc-123"),
  ev("text", "Hello — I'll take a look."),
  ev(
    "tool_use",
    JSON.stringify({ tool: "read_file", args: { path: "/src/index.ts" } }),
    { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "/src/index.ts" } },
  ),
  ev("tool_result", "export const x = 1;", { type: "tool_result", tool_use_id: "toolu_1", is_error: false }),
  ev("text", "Done — it looks fine."),
  ev("usage", JSON.stringify({ input_tokens: 150, output_tokens: 50, cost_millicents: 12 })),
  ev("status", "completed"),
];

/**
 * Orchestration events that have no native AHP session action: `finding` and
 * `subtask_create`. The mapper carries them via `_meta` and a fabricated
 * subagent tool call respectively.
 */
export const orchestration: AgentEvent[] = [
  ev("text", "Investigating the codebase."),
  ev("finding", JSON.stringify({ title: "Unused export", category: "smell", content: "x is never used", tags: ["cleanup"] })),
  ev(
    "subtask_create",
    JSON.stringify({ title: "Remove unused export", description: "Delete x", local_id: "s1", depends_on: [], can_decompose: false }),
  ),
  ev("status", "completed"),
];

/** A turn that ends in an error mid-flight. */
export const errorPath: AgentEvent[] = [
  ev("text", "Attempting the change."),
  ev("error", "boom: the SDK threw"),
];

/**
 * ACP-style tool call: the raw payload carries NO tool id (ACP uses
 * `sessionUpdate`/`status`), forcing the mapper to pair the result by the
 * last-open heuristic. Exercises the fragile pairing path.
 */
export const acpToolPairing: AgentEvent[] = [
  ev("tool_use", JSON.stringify({ tool: "bash", args: { cmd: "ls" } }), { sessionUpdate: "tool_call", title: "bash", rawInput: { cmd: "ls" } }),
  ev("tool_result", "file-a\nfile-b", { sessionUpdate: "tool_call_update", status: "completed", rawOutput: "file-a\nfile-b" }),
  ev("status", "completed"),
];

/**
 * A session that fails before any turn opens (e.g. a setup/auth failure). There
 * is no turn to error on, so this exercises the pre-turn failure path.
 */
export const preTurnFailure: AgentEvent[] = [ev("system", "Starting runtime…"), ev("status", "failed")];
