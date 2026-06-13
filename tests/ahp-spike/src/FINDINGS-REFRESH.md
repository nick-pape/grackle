# AHP adapter findings — Refresh #1 (post HR1a / HR3 / HR4+5 / HR6 / HR7)

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

**Shrink this round:** the actual _hacks_ (a `raw`-digging id heuristic, a
fragile tool-pairing fallback, and two stub-only event cases) are gone,
replaced by reads of real first-class fields. The full mapper-replay +
vendored AHP reducer conformance suite stays green.

---

## Resolved since the original spike (hacks the merged work retired)

| Original finding                                                                                                                                                                   | Merged work                                                                                                                                                                                                                                                                                                                               | What changed in the adapter                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tool-call id pairing is fragile** — Claude carried `raw.id`, ACP carried none → "last-open" heuristic that breaks under concurrent tool calls                                    | **HR3** ([#1287](https://github.com/nick-pape/grackle/issues/1287)) — first-class `AgentEvent.toolCallId`, populated by every runtime                                                                                                                                                                                                     | Deleted the `rawToolUseId(raw)` helper; `tool_use`/`tool_result` now pair on the real `toolCallId`. The heuristic survives only as a defensive fallback for id-less (pre-HR3) logs. **The concurrent-pairing failure mode is gone.**                                                                                                                                                                                                                                      |
| **Pre-turn `system` messages have no AHP `SessionState` home → dropped** (listed as a _genuine gap_)                                                                               | **HR7** ([#1290](https://github.com/nick-pape/grackle/issues/1290)) — `AgentEvent.diagnostic`, classified at the emit site + additive OTLP logs sink                                                                                                                                                                                      | The `system` case now routes by `event.diagnostic`: diagnostics → the `ahp-otlp:` telemetry channel (a clean _carry_, by design), substantive system → `responsePart`. **The "no home / dropped" gap is closed** — these events have a deliberate destination now.                                                                                                                                                                                                        |
| **"Orchestration rides MCP, not the session channel"** — asserted in prose; the mapper still carried stub `finding`/`subtask_create` via `_meta` + a fabricated subagent tool call | **HR7 Part 1** ([#1305](https://github.com/nick-pape/grackle/issues/1305)) — removed `finding`/`subtask_create`/`escalation` from `AgentEventType`                                                                                                                                                                                        | Deleted both `case` blocks (they no longer type-check). **The separation is now enforced by the type system**, not documentation: orchestration events cannot exist on this channel.                                                                                                                                                                                                                                                                                      |
| **Host requirement #1: authoritative state + sequencing** (replay buffer / monotonic seq, subsuming `parkSession`)                                                                 | **HR1a** ([#1276](https://github.com/nick-pape/grackle/issues/1276)) — durable `session_actions` log + monotonic `serverSeq` at every publish site                                                                                                                                                                                        | The _substrate_ is in production. (Reducing it into AHP `SessionState` + snapshots is HR1b — still open; see below.)                                                                                                                                                                                                                                                                                                                                                      |
| **Host requirement #6: credentials via `authenticate` (pull, on demand)** replacing proactive `PushTokens`                                                                         | **HR6** ([#1289](https://github.com/nick-pape/grackle/issues/1289)) — `Authenticate` RPC, all eager pushes removed                                                                                                                                                                                                                        | Done in production; `PushTokens` deprecated with zero call sites. Out of the session-event mapper's scope, but the host requirement is met.                                                                                                                                                                                                                                                                                                                               |
| **Host requirements #4+5: root channel = runtime registry + spawn parameters via `createSession.config`**                                                                          | **HR4+5** ([#1318](https://github.com/nick-pape/grackle/issues/1318)) — `RUNTIME_CATALOG` in `@grackle-ai/common` (replaces `RUNTIME_MANIFESTS`); new `ListRuntimes` RPC → `RootState.agents`; `deriveCredentialNeeds` → `protectedResources`; `SpawnRequest` reshaped with first-class `provider`/`ModelSelection`/typed `SessionConfig` | **No change to `mapper.ts`** — the root channel is separate from the session-event mapper. But the host requirement is now met in production: the runtime registry and session-creation shape are AHP-aligned.                                                                                                                                                                                                                                                            |
| **Turn framing — the central abstraction mismatch** (lazy synthesis, placeholder `userMessage`, `TURN_ENDING_STATUSES` heuristic, `waiting_input` overload)                        | **HR2** ([#1286](https://github.com/nick-pape/grackle/issues/1286)) — first-class `turn_started`/`turn_complete`/`input_needed` events + `AgentEvent.turnId`                                                                                                                                                                              | Deleted `TURN_ENDING_STATUSES` and `ensureTurn` synthesis; added real `case "turn_started"` (emit `session/turnStarted` with the actual `userMessage`), `case "turn_complete"` (emit `session/turnComplete`), `case "input_needed"` (advisory drop — no structured elicitation yet). `status: waiting_input/completed/running` become redundant drops. `ensureTurn` survives as a named **defensive fallback** for pre-HR2 logs only. **The turn-framing gap is closed.** |

The agent-conversation core (text + tool calls + usage + errors, turn-shaped)
still maps cleanly — that part of the original "Maps cleanly" table is unchanged.

---

## Still-unresolved gaps (the deliverable)

### 1. ~~Turn framing — the central abstraction mismatch~~ → **RESOLVED (HR2 #1286, merged)**

The lazy-turn synthesis (`ensureTurn`, `TURN_ENDING_STATUSES`, placeholder
`userMessage`), which was the largest remaining hack, is **gone**. Real
`turn_started`/`turn_complete`/`input_needed` events carry actual turn boundaries
with the real user-message text. See the "Resolved" table above.

**Residual nuance — `input_needed` (plumb-only):** AHP's `InputNeeded` state
models structured elicitation (e.g. credential prompts), which Grackle has no
mid-turn-blocking producer for today. `input_needed` is currently just advisory
and is dropped as redundant with `turn_complete`. This is the _last narrow gap_
between Grackle's turn model and AHP's: the plumbing is there; the semantic
content (structured `inputRequests`) is not populated yet.

### 2. PowerLine doesn't own AHP `SessionState` yet (in-flight: HR1b #1292)

The adapter is still an _offline mapper_: it produces actions that a test folds
through the vendored `sessionReducer`. In the end state PowerLine reduces into an
AHP-native `SessionState` itself and serves snapshots. HR1a shipped the durable
log + `serverSeq`; **HR1b [#1292](https://github.com/nick-pape/grackle/issues/1292)**
(productionize the reducer + `SessionState` + snapshots) is still open. Until it
lands, "PowerLine is an AHP host that owns state" is unrealized and the mapper
remains a probe, not a component.

### 3. ~~Root / session-creation channel~~ → **RESOLVED (HR4+5 #1318, merged)**

PR [#1318](https://github.com/nick-pape/grackle/issues/1318) merged after the
initial refresh commit. No change to `mapper.ts` was needed (the root channel is
separate from session-event mapping), but the host requirement is now met:
`RUNTIME_CATALOG` is the canonical runtime registry; `ListRuntimes` populates
`RootState.agents`; `SpawnRequest` carries first-class `provider`/`SessionConfig`;
`protectedResources` advertises credential needs. See the "Resolved" table above.

### 4. AHP-upstream metadata gaps (genuine; not Grackle's to close)

The only "carried with strain" items left in the mapper — both are small bits of
Grackle metadata with **no first-class AHP field**, so they ride extension points:

| Grackle datum           | Carried via                                      | Why it's a gap                                                           |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| `usage.cost_millicents` | `session/usage` → `usage._meta.cost_millicents`  | AHP `UsageInfo` models only tokens/model/cacheReadTokens — no cost field |
| `runtime_session_id`    | `session/metaChanged` → `_meta.runtimeSessionId` | internal id with no native AHP session field                             |

These would require an **upstream AHP spec change** (or are accepted as `_meta`
forever). They are minor and stable; flagging, not blocking.

### 5. The wire flip itself (not started: HR8 #1291)

The whole mapper exists only because Grackle still speaks the legacy PowerLine
gRPC. **HR8 [#1291](https://github.com/nick-pape/grackle/issues/1291)** —
bidirectional JSON-RPC/WebSocket transport + a Node `MultiHostClient`, retiring
`GracklePowerLine` gRPC (`Spawn`/`Resume`→stream, `DrainBufferedEvents`,
`PushTokens`) — is where PowerLine _becomes_ an AHP host and the adapter
disappears entirely. Blocked on the remaining HRs.

---

## Bottom line

Working backwards from shipped AHP changes, the adapter's residual complexity now
maps almost 1:1 onto the **unfinished** HRs:

- ~~**Root/createSession shape**~~ ✅ **RESOLVED** (HR4+5 #1318)
- ~~**Turn framing synthesis**~~ ✅ **RESOLVED** (HR2 #1286)
- **Offline mapper vs host-owned state** ⇒ HR1b (#1292, open)
- **Transport / multi-host** ⇒ HR8 (#1291)

**All groundwork HRs have merged.** Everything that could be addressed without
touching the wire (tool ids, diagnostic routing, orchestration-off-channel,
demand-driven creds, durable log substrate, runtime registry + session-creation
shape, turn framing) has **left the adapter** — deleted, enforced by the type
system, or resolved out-of-scope. The mapper is now near-nothing for the
conversation core, holding only:

1. The two **AHP-upstream metadata carries** (`cost_millicents`, `runtimeSessionId`)
   — no first-class AHP field; not Grackle's to fix.
2. A **defensive `ensureTurn` fallback** for pre-HR2 logs — correct and labeled,
   not a hack.
3. The `input_needed` advisory drop — plumbing is in production; structured
   `inputRequests` content is the last narrow turn-model gap.

**Mapper shrunk meaningfully:** the `rawToolUseId` heuristic, `TURN_ENDING_STATUSES`,
turn synthesis, and two stub-only cases are all gone, replaced by reads of real
first-class fields. The full suite stays green: the upstream-AHP reducer
conformance corpus (now consumed via the productionized `@grackle-ai/ahp`
package) plus the mapper-replay tests including the live StubRuntime stream.

**No more re-run triggers.** The next milestone for the adapter is HR1b (#1292,
host-owned `SessionState`) and HR8 (#1291, the wire flip) — at which point the
mapper disappears entirely and PowerLine _is_ the AHP host.
