---
title: "Streams: Pub/Sub IPC for Agent Sessions"
status: draft
type: spec
supersedes: "agent-kernel.md §7.2 (Pipes), §9.3 (File Descriptors)"
related:
  - "#545 — Process model: threads, IPC, pipes, file descriptors"
  - "#344 — Long-lived event-driven sessions"
  - "#468 — Signals & Process Control epic"
  - "#576 — Session reanimate"
  - "#480 — Agent Kernel RFC"
---

# Streams: Pub/Sub IPC for Agent Sessions

## 1. The Insight

The entire IPC model for Grackle — parent↔child communication, SIGCHLD, sendInput, chatrooms, pipes — reduces to **pub/sub with delivery mode options on the subscription**.

A **stream** is a named, buffered message channel. Sessions interact with streams through **subscriptions** (file descriptors). The subscription's delivery mode determines how the subscriber receives messages: blocking, async injection, or fire-and-forget.

This replaces the earlier "pipes" and "file descriptors" concepts from the kernel spec (§7.2, §9.3) with a single, more general primitive.

---

## 2. Primitives

### 2.1 Stream

A **global, named, buffered message channel**. Streams are system-level resources — not scoped to a parent↔child relationship. Any session with a reference (subscription) can interact with a stream, and references can be passed between sessions.

Streams are created explicitly (`createStream`) or implicitly (via `spawn` with a pipe option). They persist as long as at least one subscription exists or the stream is explicitly retained.

### 2.2 Subscription (fd)

A session's reference to a stream. A subscription is a **capability** — it grants access to the stream with specific permissions. Subscriptions determine:

- **Identity** — which stream this fd points to
- **Permission** — what the holder can do (see §2.3)
- **Delivery mode** — how incoming messages arrive (see §2.4)
- **Lifecycle** — closing the fd drops the reference; when the last fd to a session's stream is closed, the session hibernates

Subscriptions can be **passed between sessions** — a child can pass a stream reference up to its parent, a parent can attach a child to an existing stream, or siblings can share references. When passing a reference, the holder can **downgrade permissions but not upgrade them** (capability attenuation).

### 2.3 Permissions

| Permission | Can publish? | Can receive? | Use case |
|---|---|---|---|
| `rw` | yes | yes | Full participant in a stream |
| `r` | no | yes | Observer / monitor (watch a child's stream without injecting messages) |
| `w` | yes | no | Log sink / event emitter (publish findings, never read back) |

Permission rules:
- The **creator** of a stream gets `rw` by default.
- When **passing a reference** to another session, you can downgrade: give `r` from your `rw`. You cannot upgrade: if you have `r`, you cannot grant `rw`.
- When a parent **attaches a child** to a stream, the parent specifies the permission level (up to the parent's own level).

Examples:

```
Orchestrator creates stream "arch-decisions" (owns rw)
  → attaches child A with rw    (full participant — can publish decisions)
  → attaches child B with rw    (full participant)
  → attaches child C with r     (observer — can read decisions, can't publish)
  → passes r reference UP to grandparent (grandparent can monitor)

Child A creates stream "team-a-internal" (owns rw)
  → spawns sub-children with rw
  → passes r reference UP to orchestrator ("watch my team's chatter")
  → orchestrator observes but cannot inject into team A's channel
```

### 2.4 Delivery Modes

Delivery mode is orthogonal to permission. It determines how a subscriber **receives** messages (only relevant for `r` and `rw` subscriptions):

| Mode | Behavior | Use Case |
|---|---|---|
| **sync** | Blocking tool call. Agent is suspended until a message arrives on the stream. Returns the message directly. | Sequential orchestration: "spawn subtask, wait for result, continue" |
| **async** | Non-blocking. Messages are injected into the agent's conversation between turns (between tool calls). Agent opted into notifications. | Parallel orchestration: "spawn 3 children, keep working, handle results as they come" |
| **detach** | No notifications. Messages buffer silently. Session auto-hibernates on idle. No fd management required. | Fire-and-forget: "spawn this, I don't care about the result" |

A `w`-only subscription has no delivery mode (it never receives).

---

## 3. How Everything Maps

| Existing Concept | Stream Equivalent |
|---|---|
| `sendInput` (human → agent) | Publish to the session's stream; child receives via injection |
| SIGCHLD (child → parent) | Child publishes result to parent's stream; parent subscribed sync or async |
| Parent → child message | Publish to child's stream via `write(fd)`; always injected on child side |
| Chatroom | Global stream with N subscribers (created via `createStream` + `attach`) |
| Pipe (parent↔child) | Auto-created stream at spawn time, both sides subscribed |
| `wait(fd)` | Sync delivery mode (blocking subscribe) |
| `watch(fd)` | Async delivery mode (injected subscribe) |
| Fire-and-forget subtask | Detach delivery mode |
| Monitoring / tailing | `r`-only subscription (observe without ability to publish) |
| Sibling coordination | Parent creates stream, attaches multiple children |
| Upward reference passing | Child calls `passStream(fd, { permission: "r" })` to parent |
| Hibernation | Last subscription to a session's stream is closed |
| Reanimate | New subscription opened to a hibernating session |

---

## 4. Spawn and Pipes

The `spawn` tool creates a child session. The `pipe` option determines the IPC relationship between parent and child:

```
spawn(task, { pipe: "sync" })     // Create stream, parent blocks until child completes
spawn(task, { pipe: "async" })    // Create stream, child results injected between parent turns
spawn(task, { pipe: "detach" })   // No stream, fire-and-forget, auto-hibernate on idle
```

When `pipe` is `"sync"` or `"async"`:

1. A stream is created automatically
2. Parent gets an fd (subscription) to the stream with the specified delivery mode
3. Child receives messages from the stream via injection (the child didn't open the fd — it's inherited)

When `pipe` is `"detach"`:

1. No stream is created
2. No fd is returned
3. Child auto-hibernates when it goes idle
4. Parent's stop hook does not track this child

### 4.1 Asymmetry: Parent vs Child

Messages flow both directions on the stream, but delivery is asymmetric:

| Direction | Delivery Mechanism | Why |
|---|---|---|
| Parent → child | Always injected (between child's turns) | Child didn't open the fd. It's inherited. |
| Child → parent | Depends on parent's delivery mode (sync/async) | Parent opened the fd via spawn. Parent chose the mode. |
| Human → agent | Always injected | Same as parent → child. The UI is another parent. |

The child never calls `read()`. Incoming messages just appear in its conversation context. This is how `sendInput` works today — the change is that it now works **regardless of session status** (running, idle, doesn't matter). All four runtimes (Claude, Codex, Copilot, ACP) support mid-turn message delivery.

---

## 5. Session Lifecycle (Emergent)

Session status is **derived from stream/subscription state**, not explicitly managed:

| State | Condition | Process? | Subscriptions? | JSONL? |
|---|---|---|---|---|
| **RUNNING** | Has subscribers + actively generating | Alive | Open | Growing |
| **IDLE** | Has subscribers + not generating | Alive | Open | Stable |
| **HIBERNATING** | No subscribers + JSONL exists | Dead | None | Persisted |
| **COMPLETE** | Resources reclaimed (TTL, worktree cleanup, JSONL pruned) | Dead | None | Gone |

Key transitions:

- **IDLE → HIBERNATING**: Last subscriber (parent) closes their fd. Child process is killed. JSONL persists.
- **HIBERNATING → IDLE**: New subscription opened to the session (reanimate). Process restarts from JSONL.
- **HIBERNATING → COMPLETE**: Resources are reclaimed. TTL expires, worktree is cleaned up, or JSONL is deleted. Terminal state — session cannot be reanimated.

"Done" is a misnomer. What we previously called "done" is **HIBERNATING** — the session's process is dead but it can be brought back. True completion (COMPLETE) means resources are gone and the session is permanently finished.

### 5.1 Teleportation

Because the session's state is in the JSONL (not in the process), a HIBERNATING session can be **teleported** — its JSONL moved to a different environment and resumed there. The session isn't tied to a specific environment. This enables workload migration, environment failover, and multi-environment workflows.

---

## 6. The Close Contract

### 6.1 Rule: Close Your Children, Not Your Parents

The stop hook (or equivalent enforcement for runtimes without hooks) checks: **does this session have open fds that it created via `spawn()`?** If yes, it cannot exit.

- Fds the session opened (via spawn with sync/async pipe) → must be closed before exit
- Inherited fds (from parent's pipe or attach) → not the session's responsibility

This matches Unix semantics: you don't close stdin/stdout/stderr (your parent owns those). You close file descriptors you `open()`'d yourself.

### 6.2 Rule: Cannot Close with Undelivered Messages

`close(fd)` fails if there are buffered messages on the stream that haven't been delivered to the subscriber. The agent must first receive (via sync block or async injection) any pending messages before closing.

This prevents message loss — a parent can't close a child fd and miss the child's results.

### 6.3 Exit Flow

```
Agent finishes its work, wants to exit
  → Stop hook fires: "You have open fds: [3 (fix-auth), 5 (add-tests)]"
  → Agent: close(3)  → fix-auth child hibernates
  → Agent: close(5)  → add-tests child hibernates
  → Stop hook: all self-opened fds closed, exit allowed
  → Agent goes IDLE
  → Parent closes its fd to this agent → agent hibernates
```

For detached children: no fd exists, so the stop hook doesn't track them. They auto-hibernate on idle independently.

---

## 7. MCP Tool Surface

### 7.1 Core Tools (Available to Agents)

| Tool | Signature | Description |
|---|---|---|
| `spawn` | `spawn(task, { pipe: "sync" \| "async" \| "detach" })` | Create child session. Pipe mode determines IPC. Returns fd (sync/async) or void (detach). |
| `write` | `write(fd, message)` | Send message to the stream behind this fd. Requires `w` or `rw` permission. |
| `close` | `close(fd)` | Drop subscription. Fails if undelivered messages. Last fd → child hibernates. |

Three tools for the basic parent↔child model.

### 7.2 Stream Management Tools

| Tool | Signature | Description |
|---|---|---|
| `createStream` | `createStream(name)` | Create a global named stream. Creator gets `rw`. |
| `attach` | `attach(sessionId, streamName, { permission, deliveryMode })` | Give another session a subscription to an existing stream. Permission ≤ caller's own. |
| `passStream` | `passStream(fd, { permission })` | Pass a stream reference to the session's parent (writes a stream-ref message to the parent's pipe). Permission ≤ caller's own. |

These enable:
- **Chatrooms**: `createStream("design-review")` + `attach` N children
- **Upward references**: child calls `passStream(fd, { permission: "r" })` to let parent observe
- **Sibling communication**: parent creates stream, attaches two children to it
- **Global event buses**: orchestrator creates stream, passes `r` references down the tree

### 7.3 Permission and Reference Passing

When passing stream references, capability attenuation applies:

```
Orchestrator has rw on "arch-decisions"
  → attach(childA, "arch-decisions", { permission: "rw" })    // OK: rw ≤ rw
  → attach(childB, "arch-decisions", { permission: "r" })     // OK: r ≤ rw

Child B has r on "arch-decisions"
  → passStream(fd, { permission: "r" })                       // OK: r ≤ r
  → passStream(fd, { permission: "rw" })                      // DENIED: rw > r
```

---

## 8. Interaction with Reanimate

Reanimate is no longer a separate concept — it's just `open()` (creating a new subscription to a hibernating session).

- When a parent calls `spawn()` targeting a hibernating session, the session reanimates
- When the UI reconnects to a hibernating session, it reanimates
- The JSONL is the safety net: if a piped process crashes, the session hibernates (not fails), and can be reanimated

The current `reanimate-agent.ts` flow remains valid but is reframed: it's creating a new subscription (fd) to a session that has zero subscribers.

---

## 9. Streaming: Always On

Today, the server only streams events from sessions while they are "alive" (the PowerLine gRPC stream). With the stream model, **event streaming is always on** regardless of whether the session will be kept alive:

- The spawn gRPC call returns a server-stream of events (this exists today)
- The stream stays open as long as the parent holds the fd
- When the child goes IDLE with a pipe, the stream stays open (process alive, waiting)
- When the child goes IDLE without a pipe (detach), the stream closes and the child hibernates

This also means tool calls should be streamed. Today, tool call events may not be emitted until the turn completes. With always-on streaming, tool use/result events flow in real-time.

---

## 10. Removing the IDLE Gate

The current `sendInput` implementation (`grpc-service.ts:543`) rejects input unless the session status is IDLE:

```typescript
if (session.status !== SESSION_STATUS.IDLE) {
  throw new ConnectError(
    `Session ${req.sessionId} is not idle (status: ${session.status})`,
    Code.FailedPrecondition,
  );
}
```

This gate must be removed. All four runtimes (Claude Agent SDK, Codex SDK, Copilot SDK, ACP) support mid-turn message delivery. Messages sent to a running session are queued and delivered at the next natural break (between tool calls).

The web UI should also allow typing while the agent is running, not just when idle.

---

## 11. Runtime Support

All four runtimes already support persistent sessions. The mechanism varies but the abstraction is the same:

| Runtime | Keep-Alive Mechanism | Mid-Turn Input |
|---|---|---|
| Claude Agent SDK | `AsyncIterable<SDKUserMessage>` as prompt (generator stays open) | Yes — yield into generator |
| Codex SDK | `thread.runStreamed()` repeated calls (thread persists) | Yes — call `run()` anytime |
| Copilot SDK | `session.send()` repeated calls (session persists) | Yes — `send()` works anytime |
| ACP | `connection.prompt()` repeated calls (subprocess persists) | Yes — `prompt()` is fire-and-forget |

The `BaseAgentSession` abstraction already unifies these via `runInitialQuery()` and `executeFollowUp()`. The change is:

1. Don't kill the process on idle (keep it warm when a pipe is open)
2. Allow `sendInput()` regardless of session status
3. Add fd tracking to sessions

---

## 12. Relationship to Kernel Spec

This spec refines and replaces several sections of [2026-03-18-agent-kernel.md](2026-03-18-agent-kernel.md):

| Kernel Spec Section | Disposition |
|---|---|
| §7.2 Pipes and Composition | **Replaced** by streams (§2-4 of this spec) |
| §7.4 Typed Signals | **Replaced** by stream messages (signals are just messages on a stream) |
| §9.3 File Descriptors | **Replaced** by subscriptions/fds (§2.2 of this spec) |
| §5.1 SIGCHLD | **Reframed** as child publishing to parent's stream |
| §5.2 Exit Status | **Unchanged** — structured result is the final message on the stream |
| §5.3 Escalation | **Reframed** — `needs_input` result published to parent's stream |

---

## 13. Implementation Scope

### Phase 1: Foundations

- Remove the IDLE gate on `sendInput` (server + web UI)
- Keep processes alive when pipe is open (don't auto-hibernate on idle)
- Stream tool call events in real-time
- Add `pipe` option to `SpawnRequest` proto

### Phase 2: Agent IPC Tools

- `spawn` MCP tool with pipe modes (sync, async, detach)
- `write` MCP tool
- `close` MCP tool with buffer drain check
- Stop hook enforcement: "close your children before exiting"
- Session lifecycle derived from subscription state (RUNNING/IDLE/HIBERNATING/COMPLETE)

### Phase 3: Advanced Streams

- `createStream` / `subscribe` / `attach` tools
- Chatrooms (N subscribers to one stream)
- Stream passing (parent gives child a reference to an existing stream)
- Teleportation (move JSONL to another environment)

---

## 14. Open Questions

1. **Buffer size limits.** Should streams have a max buffer depth? What happens if a child publishes faster than the parent reads (async mode)?

2. **Stream persistence.** Are stream messages persisted (like JSONL) or ephemeral? If a parent hibernates and reanimates, does it see messages that arrived while it was asleep?

3. **Multiple delivery modes per stream.** Can the same session subscribe to the same stream twice with different modes? (Probably not — one fd per session per stream.)

4. **Detach-to-async upgrade.** Can a parent spawn with `detach` and later decide to subscribe? This would require the child's stream to exist even without subscribers, which contradicts detach semantics.

5. **GenAIScript.** The GenAIScript runtime doesn't support follow-up input. How does it participate in the stream model? (Probably: it publishes to its parent stream on completion, but never receives. One-way.)

6. **Token cost of injection.** Injected messages consume context window. A chatty child flooding the parent's stream could burn tokens. Should there be a delivery rate limit or summarization layer?
