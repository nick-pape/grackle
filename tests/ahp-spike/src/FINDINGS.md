# AHP architecture-validation findings

> **Update:** see [`FINDINGS-REFRESH.md`](./FINDINGS-REFRESH.md) for Refresh #1,
> which re-runs this exercise against `main` after HR1a/HR3/HR6/HR7 merged and
> records which findings below are now **resolved** vs. **still open**. This
> original document is kept as the historical baseline the HR tickets derive from.

This is the deliverable of the spike for [#1232](https://github.com/nick-pape/grackle/issues/1232).
It records what we learned by mapping Grackle's `AgentEvent` stream onto AHP
session **actions** and folding them through AHP's own (vendored) `sessionReducer`
to reconstruct an AHP `SessionState`.

**What this validates:** *fit / implementability* — whether Grackle's session
model expresses faithfully in AHP's. It does **not** validate "two independent
teams converged, therefore the abstraction is correct": Grackle was pitched
internally at Microsoft, so the PowerLine ≡ AHP-reference-host resemblance may be
partly influence. Fit is testable; independence is not, so we don't lean on it.

**What this is not:** the mapper is throwaway scaffolding. The end state for
#1232 is *PowerLine becomes an AHP host* (it owns AHP-native state and speaks AHP
over the wire to the Server) — there is no long-lived `AgentEvent→action` mapper
in that world. The mapper exists only to surface the gaps that work must close,
enumerated in "Host requirements" below.

How it's verified: `mapper.test.ts` (replay → reducer → assert `SessionState`)
and `reducer-conformance.test.ts` (the vendored reducer passes AHP's own
conformance corpus, so we're testing against faithful upstream behavior).

---

## Maps cleanly

These Grackle events have a faithful native AHP representation:

| AgentEvent | AHP | Notes |
|---|---|---|
| `text` | `session/responsePart` (markdown) [+ `session/delta`] | one part per event; deltas available if we stream |
| `tool_use` | `session/toolCallStart` + `session/toolCallReady` | tool-call lifecycle is *richer* in AHP than in Grackle today |
| `tool_result` | `session/toolCallComplete` | clean **iff** the runtime gives a stable tool-call id (see below) |
| `usage` (tokens) | `session/usage` | input/output tokens map 1:1 |
| `error` | `session/error` (in-turn) / `session/creationFailed` (pre-turn) | |
| `status: completed/waiting_input` | `session/turnComplete` | with the turn-framing rule below |

The core agent-conversation shape — turns of text + tool calls with usage — is a
clean fit. The AHP tool-call state machine is a **superset** of what Grackle
expresses: Grackle auto-approves tools (`confirmed: NotNeeded`, straight to
`running`), while AHP natively models `pending-confirmation` (HITL). That unused
capability is the same HITL concept as the mcp-hub push-approve flow — adopting
AHP would let the two unify.

## Carried with strain (no native action; rode an extension point)

| AgentEvent | Carried via | Strain |
|---|---|---|
| `usage.cost_millicents` | `usage._meta.cost_millicents` | AHP `UsageInfo` has no cost field (only tokens/model/cacheReadTokens) |
| `runtime_session_id` | `session/metaChanged` → `_meta.runtimeSessionId` | internal id; a host owns the native session id directly |

Both are minor — small bits of Grackle metadata with no first-class AHP field.

## Correction: orchestration (findings/subtasks) does NOT ride this channel

An earlier draft listed `finding` / `subtask_create` as "carried with strain."
**That was wrong.** In production, findings and subtasks are **MCP syscalls**, not
events on the agent-conversation transport:

- The agent records a finding by calling the injected Grackle MCP tool
  (`packages/mcp/src/tools/finding.ts`; subtasks via `task.ts`). These flow
  **agent → injected Grackle MCP → Server orchestration**, entirely out of band
  from the PowerLine↔Server stream. Over the wire they appear (if at all) only as
  ordinary `tool_use`/`tool_result`, which map cleanly.
- **No production runtime emits `finding`/`subtask_create` AgentEvents** — only the
  `StubRuntime` does, to exercise `event-processor.ts`'s legacy structured-event
  path. The mapper's carry-handling for these exists *solely* to process the stub
  fixtures; it does not reflect how real agents work.

So orchestration never needs an AHP session action. This is exactly the
**separation the kernel model already prescribes**: MCP is the syscall ABI (where
findings/subtasks/escalations live); AHP carries only the agent conversation. The
apparent "strain" was an artifact of feeding the spike the stub's legacy events.

(The sub-agent observation still stands as a *latent* nicety: AHP's
`ToolResultSubagentContent` references a subscribable child-session URI, so a
subtask spawned via a real MCP tool call could surface its child session natively
in the conversation — but that's an option, not a requirement.)

## Genuine gaps (no AHP `SessionState` representation)

- **Pre-turn `system` messages** (e.g. "Starting runtime…") have nowhere to live
  in `SessionState` — there is no active turn yet, so a `responsePart` no-ops.
  These are diagnostics; AHP's place for them is the **`ahp-otlp:` telemetry
  channel** (logs), not session state. A host should route them there.

## Turn-framing — the central abstraction mismatch

AHP is **turn-structured**: `session/turnStarted` MUST precede any
`delta`/`responsePart`/`toolCall*` action or the reducer silently no-ops. Grackle
has **no turn concept** — only a `status` flag oscillating `running ↔
waiting_input`. The mapper bridges this by *synthesizing* turn boundaries: open a
turn lazily on the first content event (or `status: running`), close it on a
turn-ending status.

This works for the common case but is lossy at the edges:

- **No user message.** AHP turns are anchored by a `userMessage`; Grackle's event
  stream doesn't carry one, so we synthesize a placeholder. A host would anchor
  turns on the actual prompt / `sendInput` text it already has.
- **`waiting_input` is overloaded.** In Grackle it means both "turn done, idle"
  *and* "blocked awaiting input." AHP distinguishes these (`Idle` vs the
  `InputNeeded` status + structured `inputRequests`/elicitation). Mapping
  `waiting_input → turnComplete` collapses that distinction; Grackle emits no
  structured input requests today.
- **Resume / multi-turn** boundaries are ambiguous from the event stream alone.

## Tool-call id pairing is fragile through the event stream

`tool_result` must attach to the right `tool_use`. Claude-style events carry a
stable id (`raw.id` / `raw.tool_use_id`) → clean pairing. ACP-style events carry
**no id** (`sessionUpdate`/`status` only) → the mapper falls back to a "last open
tool call" heuristic, which breaks under concurrent/interleaved tool calls. This
is purely an artifact of flattening through `AgentEvent`; **a host that consumes
the runtime directly tracks tool-call ids natively** and never needs the heuristic.

---

## Host requirements (the real #1232 work)

Translating the gaps into what *PowerLine-as-AHP-host* must own (beyond any mapper):

1. **Authoritative state + sequencing.** Own `SessionState` per session, assign a
   monotonic `serverSeq` to every action, keep a replay buffer, and serve
   snapshots. This subsumes today's `parkSession` / `DrainBufferedEvents` hack
   and is the formal version of Grackle's "re-fetch on reconnect."
2. **Native turn framing.** Anchor turns on the real prompt / `sendInput` (the
   host has the user message); stop synthesizing. Use `InputNeeded` +
   `inputRequests` for genuine elicitation instead of overloading `waiting_input`.
3. **Native tool-call lifecycle.** Emit `toolCallStart/Ready/Complete` with the
   runtime's real tool-call ids (no pairing heuristic), and optionally surface
   `pending-confirmation` for HITL (unifying with mcp-hub).
4. **Root channel = runtime registry.** `RootState.agents` from `listRuntimes()`;
   `createSession.provider` selects the runtime; `protectedResources` advertises
   credential needs.
5. **Carry spawn parameters** (branch, taskId, workspaceId, persona, useWorktrees,
   systemContext, mcpServers, pipe) via `createSession.config` / `_meta`.
6. **Credentials via `authenticate`** (pull, on demand) replacing the proactive
   `PushTokens` injection.
7. **Keep orchestration off the session channel.** Findings, escalations, and
   subtask DAG edges are Grackle-plane concerns — surface them via the Grackle
   MCP/event bus (and telemetry via `ahp-otlp:`), **not** AHP `SessionState`. The
   one exception worth pursuing: model subtask spawns as real tool calls so they
   ride `ToolResultSubagentContent` natively.
8. **Transport + multi-host.** A bidirectional JSON-RPC transport (WebSocket over
   the existing tunnel), and a Node port of the Rust `MultiHostClient` pattern so
   the Server drives N PowerLine hosts.

## Bottom line

The agent-conversation core maps cleanly; Grackle's abstractions are *expressible*
in AHP. Orchestration (findings, subtasks, escalations) is **not** friction for
the session channel at all — it rides the MCP syscall plane, out of band, and
never needed an AHP action (the apparent strain was a stub-fixture artifact). The
real, residual friction is purely where Grackle *under-specifies* the conversation
relative to AHP: no turns, no user message, no structured input requests, no
stable tool ids in the flattened `AgentEvent` stream. None of these are blockers
for PowerLine-as-host — they are a precise to-do list, and several (turns, tool
ids) *disappear* once the host consumes the runtime directly instead of through
the lossy flattening.
