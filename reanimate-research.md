# Reanimate Research: History, Rationale, and Streaming Input

## The Reanimate PR

**[PR #597](https://github.com/nick-pape/grackle/pull/597)** — "feat: unified session resume — reanimate terminal sessions"
- **Merged:** 2026-03-18T20:48:27Z
- **Issue:** [#576](https://github.com/nick-pape/grackle/issues/576)
- **Branch:** `nick-pape/576-session-reanimate`

## The Lifecycle Simplification (precursor)

**[PR #475](https://github.com/nick-pape/grackle/pull/475)** — "feat: simplify task/session lifecycle model"
- **Merged:** 2026-03-15T06:56:39Z
- Reduced task statuses to 5 states (`not_started`, `working`, `paused`, `complete`, `failed`), merged `waiting_input` into `paused`, removed `review`

## Why: From "held in memory" to reanimate-by-default

The key design conversation happened in **grackle4** (session `7aa34b73`). The reasoning chain:

1. **LLM conversation logs are complete checkpoints.** Unlike Unix processes, killing an agent session is non-destructive — `claude --resume` reconstructs full state from the JSONL file. "Death isn't permanent."

2. **The simplified lifecycle becomes: `pending → running → done`. No idle. No waiting_input.** The session runs until it stops generating, then it's done.

3. **"Held in memory" is just a performance optimization** — you called it a **"pipe"**. Keeping a Claude process alive between turns is functionally identical to letting it die and reanimating on next input. The only difference is latency.

4. **Pipes vs no-pipe:**
   - **Pipe (UI sessions):** Process stays alive. Cost = holding a Claude process in memory
   - **No pipe (orchestrator sessions):** Process exits, reanimate on demand. Cost = zero while dormant

5. **Reanimate makes idle=done safe.** Without reanimate, completing a session is destructive (no way back). With reanimate, session death becomes "paged out, reload on demand."

## Was it because of long-lived processes?

**Yes, partly.** The reanimate design was explicitly motivated as a **foundation primitive** that enables:
- [#344](https://github.com/nick-pape/grackle/issues/344) — Long-lived event-driven agent sessions (orchestrator/persona tasks)
- [#430](https://github.com/nick-pape/grackle/issues/430) — Copilot tasks not marking themselves completed (idle=done solves this)
- [#495](https://github.com/nick-pape/grackle/issues/495) — SIGCHLD (resume parent with child results)
- [#494](https://github.com/nick-pape/grackle/issues/494) — SIGTERM (safe to kill because reanimate can bring it back)
- [#545](https://github.com/nick-pape/grackle/issues/545) — Process model: threads, IPC, pipes, file descriptors

The idea was: make session death cheap/reversible first, then build pipes (long-lived persistent processes) as a **performance optimization** on top, rather than requiring everything to stay alive in memory.

## Did this break per-message streaming?

It didn't break it in the "bug" sense — but the reanimate-by-default model means every `SendInput` call triggers:

```
SendInput("hello")
  → query("hello", { resume: sessionId })
    → new Claude Code subprocess
    → loads session JSONL from disk
    → rebuilds conversation context
    → process exits
```

That's ~5-8s overhead per input. For interactive/round-robin use cases, that's a major regression vs keeping the process alive. The streaming input proposal (using `AsyncIterable` as the prompt) is essentially **implementing the "pipe" concept** from the original design — the performance optimization that was always planned but deferred:

| | Resume-per-input (reanimate) | Streaming Input (pipe) |
|---|---|---|
| Delivery to busy agent | not possible | 2ms |
| Round-robin | ~414s | ~93s (4.5x faster) |
| Story chain | 993s | 140s (7.1x faster) |

So the architecture was always: reanimate as the **safe default** (zero resource cost when idle), pipes as the **performance optimization** for message-heavy workloads. The streaming input proposal is the natural next step — it's the pipe implementation for the Claude Code runtime.

## All Relevant Links

| | Link |
|---|---|
| Reanimate PR | [#597](https://github.com/nick-pape/grackle/pull/597) |
| Reanimate Issue | [#576](https://github.com/nick-pape/grackle/issues/576) |
| Lifecycle Simplification PR | [#475](https://github.com/nick-pape/grackle/pull/475) |
| Long-lived Sessions | [#344](https://github.com/nick-pape/grackle/issues/344) |
| Agent Kernel RFC | [#480](https://github.com/nick-pape/grackle/issues/480) |
| SIGCHLD PR | [#606](https://github.com/nick-pape/grackle/pull/606) |
| SIGCHLD Issue | [#495](https://github.com/nick-pape/grackle/issues/495) |
| Process Model (pipes/IPC) | [#545](https://github.com/nick-pape/grackle/issues/545) |
| Copilot idle bug | [#430](https://github.com/nick-pape/grackle/issues/430) |
| Signals Epic | [#468](https://github.com/nick-pape/grackle/issues/468) |
| JSONL Sync Investigation | [#369](https://github.com/nick-pape/grackle/issues/369) |

---

## Proposed Response to the Streaming Input Agent

**Great work on the POC — this validates exactly what we had planned architecturally.**

Some context on where this fits in the Grackle kernel model:

We intentionally moved to "reanimate by default" in [PR #597](https://github.com/nick-pape/grackle/pull/597) / [#576](https://github.com/nick-pape/grackle/issues/576) as a **foundation primitive**. The insight was that LLM conversation logs are complete checkpoints — session death is cheap and reversible, unlike Unix processes. This let us simplify the lifecycle ([PR #475](https://github.com/nick-pape/grackle/pull/475)) to `pending → running → done` with no `idle`/`waiting_input` states, which solved a whole class of "stuck agent" bugs.

In the kernel analogy ([#480](https://github.com/nick-pape/grackle/issues/480)), what you're proposing is **the pipe primitive** — it's how we've always planned to handle the "keep the process alive between turns" optimization. The architecture was always:

- **Reanimate (no pipe)** = safe default. Process exits when idle, zero resource cost, reanimate on demand. Good for: orchestrator subtasks, background workers, anything that runs autonomously.
- **Pipe (streaming input)** = performance optimization. Process stays alive, instant message delivery. Good for: UI-interactive sessions, round-robin collaboration, rapid message exchanges.

Your benchmarks (2ms vs 5-8s per input, 4-7x speedup on message-heavy workloads) are exactly why we need this. The relevant open issues are:

- [#344](https://github.com/nick-pape/grackle/issues/344) — Long-lived event-driven sessions (the broader "pipe" concept)
- [#545](https://github.com/nick-pape/grackle/issues/545) — Process model: threads, IPC, pipes, file descriptors

**What we want long-term:**

1. **Pipes are a session-level policy, not a runtime-level toggle.** A session gets a pipe (persistent process) or not based on how it was spawned — UI-interactive sessions get an implicit pipe; orchestrator-dispatched subtasks don't. This should be driven by the `SpawnRequest`, not a runtime config flag.

2. **Both modes must coexist per-runtime.** The same Claude Code runtime needs to support both pipe mode (streaming input / `AsyncIterable`) and reanimate mode (resume-per-input) depending on the session. So rather than `persistentSessions: boolean` on the runtime class, think of it as a per-session flag: `session.hasPipe`.

3. **Reanimate remains the fallback.** If a piped process crashes, the session falls back to reanimate (restart from JSONL). The pipe is a performance optimization layered on top of the reanimate safety net.

4. **The `AsyncIterable` approach is the right mechanism.** Your POC proves the SDK supports it and the JSONL persistence still works. This is the implementation we'd want.

**Suggested next step:** File this as a new issue under the Signals & Process Control epic ([#468](https://github.com/nick-pape/grackle/issues/468)) — something like "Pipe primitive: persistent process mode for interactive sessions via streaming input." Reference #344, #545, and #576. The implementation scope is what you described (~50 lines in `claude-code.ts`) plus the per-session pipe flag in `SpawnRequest` and the fallback-to-reanimate logic.
