# AHP adapter findings — Refresh #1 (post HR1a / HR3 / HR6 / HR7)

This refreshes the original [`FINDINGS.md`](./FINDINGS.md) by **working backwards
from the AHP changes we've actually shipped**. Since the original spike, several
children of the AHP-adoption epic ([#1285](https://github.com/nick-pape/grackle/issues/1285))
merged to `main`, each moving Grackle's production model toward AHP. We merged
the latest `main` into the spike branch and shrank the throwaway `mapper.ts`
adapter accordingly. What's left, by subtraction, is the precise set of
**still-unresolved gaps**.

**Method:** merge `origin/main` → rebuild the spike against the new production
types → the compiler points at every hack the merged work obsoleted → delete /
replace it → re-fold through the (unchanged, conformance-tested) `sessionReducer`
to prove the result still reconstructs a faithful `SessionState`.

**Shrink this round:** `mapper.ts` 408 → 356 lines; net −51 lines across
mapper + fixtures + tests, and — more importantly — the actual *hacks* (a
`raw`-digging id heuristic, a fragile tool-pairing fallback, and two stub-only
event cases) are gone, replaced by reads of real first-class fields. The
164-test suite (157-case vendored AHP conformance corpus + 7 mapper replay
tests, incl. the live StubRuntime stream) stays green.

---

## Resolved since the original spike (hacks the merged work retired)

| Original finding | Merged work | What changed in the adapter |
|---|---|---|
| **Tool-call id pairing is fragile** — Claude carried `raw.id`, ACP carried none → "last-open" heuristic that breaks under concurrent tool calls | **HR3** ([#1287](https://github.com/nick-pape/grackle/issues/1287)) — first-class `AgentEvent.toolCallId`, populated by every runtime | Deleted the `rawToolUseId(raw)` helper; `tool_use`/`tool_result` now pair on the real `toolCallId`. The heuristic survives only as a defensive fallback for id-less (pre-HR3) logs. **The concurrent-pairing failure mode is gone.** |
| **Pre-turn `system` messages have no AHP `SessionState` home → dropped** (listed as a *genuine gap*) | **HR7** ([#1290](https://github.com/nick-pape/grackle/issues/1290)) — `AgentEvent.diagnostic`, classified at the emit site + additive OTLP logs sink | The `system` case now routes by `event.diagnostic`: diagnostics → the `ahp-otlp:` telemetry channel (a clean *carry*, by design), substantive system → `responsePart`. **The "no home / dropped" gap is closed** — these events have a deliberate destination now. |
| **"Orchestration rides MCP, not the session channel"** — asserted in prose; the mapper still carried stub `finding`/`subtask_create` via `_meta` + a fabricated subagent tool call | **HR7 Part 1** ([#1305](https://github.com/nick-pape/grackle/issues/1305)) — removed `finding`/`subtask_create`/`escalation` from `AgentEventType` | Deleted both `case` blocks (they no longer type-check). **The separation is now enforced by the type system**, not documentation: orchestration events cannot exist on this channel. |
| **Host requirement #1: authoritative state + sequencing** (replay buffer / monotonic seq, subsuming `parkSession`) | **HR1a** ([#1276](https://github.com/nick-pape/grackle/issues/1276)) — durable `session_actions` log + monotonic `serverSeq` at every publish site | The *substrate* is in production. (Reducing it into AHP `SessionState` + snapshots is HR1b — still open; see below.) |
| **Host requirement #6: credentials via `authenticate` (pull, on demand)** replacing proactive `PushTokens` | **HR6** ([#1289](https://github.com/nick-pape/grackle/issues/1289)) — `Authenticate` RPC, all eager pushes removed | Done in production; `PushTokens` deprecated with zero call sites. Out of the session-event mapper's scope, but the host requirement is met. |

The agent-conversation core (text + tool calls + usage + errors, turn-shaped)
still maps cleanly — that part of the original "Maps cleanly" table is unchanged.

---

## Still-unresolved gaps (the deliverable)

### 1. Turn framing — the central abstraction mismatch (in-flight: HR2 #1286)

Still the largest residual hack. AHP is turn-structured (`session/turnStarted`
MUST precede any `delta`/`responsePart`/`toolCall*` or the reducer no-ops);
`main` today still has only a `status` flag oscillating `running ↔
waiting_input`, so the mapper **synthesizes** turn boundaries (open lazily on
first content / `status: running`, close on a turn-ending status) and **fabricates
a placeholder `userMessage`**. The lossy edges remain exactly as first reported:

- **No user message** — turns are anchored on a synthesized placeholder, not the
  real prompt / `sendInput`.
- **`waiting_input` is overloaded** — it means both "turn done, idle" *and*
  "blocked awaiting input"; AHP separates these (`Idle` vs `InputNeeded` +
  structured `inputRequests`). The mapper collapses them.
- **Resume / multi-turn** boundaries are ambiguous from the flattened stream.

**Status:** [HR2 #1286](https://github.com/nick-pape/grackle/issues/1286) is
in-flight (first-class `turn_id` + `TURN_STARTED`/`TURN_COMPLETE`/`INPUT_NEEDED`
events). Once it merges, the synthesis (`ensureTurn`, `TURN_ENDING_STATUSES`,
placeholder user message) can be replaced with reads of real turn events — this
is the single biggest remaining shrink. **Deferred to the re-run.**

### 2. PowerLine doesn't own AHP `SessionState` yet (in-flight: HR1b #1292)

The adapter is still an *offline mapper*: it produces actions that a test folds
through the vendored `sessionReducer`. In the end state PowerLine reduces into an
AHP-native `SessionState` itself and serves snapshots. HR1a shipped the durable
log + `serverSeq`; **HR1b [#1292](https://github.com/nick-pape/grackle/issues/1292)**
(productionize the reducer + `SessionState` + snapshots) is still open. Until it
lands, "PowerLine is an AHP host that owns state" is unrealized and the mapper
remains a probe, not a component.

### 3. Root / session-creation channel (in-flight: HR4+5 #1318)

Out of the session-event mapper's scope, but a standing host requirement: the
root channel as runtime registry (`RootState.agents` from `listRuntimes()`),
`createSession.provider`/typed `config`, and `protectedResources` advertising
credential needs. **HR4+5 [#1318](https://github.com/nick-pape/grackle/issues/1318)**
is in-flight. **Deferred to the re-run.**

### 4. AHP-upstream metadata gaps (genuine; not Grackle's to close)

The only "carried with strain" items left in the mapper — both are small bits of
Grackle metadata with **no first-class AHP field**, so they ride extension points:

| Grackle datum | Carried via | Why it's a gap |
|---|---|---|
| `usage.cost_millicents` | `session/usage` → `usage._meta.cost_millicents` | AHP `UsageInfo` models only tokens/model/cacheReadTokens — no cost field |
| `runtime_session_id` | `session/metaChanged` → `_meta.runtimeSessionId` | internal id with no native AHP session field |

These would require an **upstream AHP spec change** (or are accepted as `_meta`
forever). They are minor and stable; flagging, not blocking.

### 5. The wire flip itself (not started: HR8 #1291)

The whole mapper exists only because Grackle still speaks the legacy PowerLine
gRPC. **HR8 [#1291](https://github.com/nick-pape/grackle/issues/1291)** —
bidirectional JSON-RPC/WebSocket transport + a Node `MultiHostClient`, retiring
`GracklePowerLine` gRPC (`Spawn`/`Resume`→stream, `DrainBufferedEvents`,
`PushTokens`) — is where PowerLine *becomes* an AHP host and the adapter
disappears entirely. Blocked on the remaining HRs.

---

## Bottom line

Working backwards from shipped AHP changes, the adapter's residual complexity now
maps almost 1:1 onto the **unfinished** HRs:

- **Turn synthesis** ⇒ HR2 (#1286, in-flight)
- **Offline mapper vs host-owned state** ⇒ HR1b (#1292, open)
- **Root/createSession shape** ⇒ HR4+5 (#1318, in-flight)
- **Transport / multi-host** ⇒ HR8 (#1291)

Everything the *merged* HRs addressed (tool ids, diagnostic routing,
orchestration-off-channel, demand-driven creds, the durable log substrate) has
**left the adapter** — either deleted outright or enforced by the type system.
The two AHP-upstream metadata carries are the only friction not attributable to
unfinished Grackle work.

**Re-run trigger:** repeat this exercise after **HR2 (#1286)** and **HR4+5
(#1318)** merge. At that point the turn-framing synthesis and the root-channel
gaps should both collapse, leaving only HR1b (host-owned state), the
AHP-upstream metadata carries, and HR8 (the wire flip) — i.e. the mapper should
shrink to near-nothing, which is the signal that PowerLine is ready to *be* the
host rather than be mapped into one.
