---
id: kernel
title: The Kernel Concept
sidebar_position: 1
---

# The Kernel Concept

The Grackle server runs agents the way an operating system runs processes. It owns the **mechanism** — spawn, signal, supervise, schedule, route — and nothing about the work itself. Which agent runs, what task it's handed, when it's done: that's **policy**, and policy lives above the kernel. The kernel doesn't decide. It carries out.

This page is the model under the rest of the docs. [Orchestration](../features/orchestration) and [Coordination](../features/coordination) are what you drive. This is what they're built on.

:::note A concept, not a product
"The kernel" here means the mechanism the server provides today. The roadmap names the productized version **GrackleRoost** — the same mechanism, carved out and given a boundary. It is direction, not shipped. See [Roadmap](../roadmap).
:::

## Mechanism, not policy

A kernel gives you primitives. It does not tell you what to do with them.

| Primitive     | What the kernel does                                                | Where policy lives                           |
| ------------- | ------------------------------------------------------------------- | -------------------------------------------- |
| **spawn**     | Start a session on a wire, with an identity and its own credentials | Which persona, which task, which environment |
| **signal**    | Deliver a message to a running or dead-but-resumable agent          | What the signal means, who reacts            |
| **supervise** | Watch sessions for their fds; reap them when the last one closes    | When to gather work, when to escalate        |
| **schedule**  | Tick the system toward its desired state on a fixed interval        | What "desired" is — the task tree, the cron  |
| **route**     | Carry messages between agents over named streams and pipes          | The shape of the conversation                |

The kernel is small on purpose. Everything that decides — the task DAG, the review gate, the scheduler — is a [plugin](../extending/plugins) layered on top. Pull the plugins and you're left with the bare primitives: agents on wires, signals between them, nothing telling them what to do.

## Sessions are processes

A [session](../building-blocks/tasks-sessions) is a process. The model is borrowed whole: a session holds **file descriptors**, each pointing at a stream; spawn a child and you get a pipe fd to it; close the last fd and the process dies. Liveness isn't a flag someone sets — it falls out of the subscription state. A session with no open fds is a session no one is holding, so it stops.

That single idea — _alive means held_ — is what makes the rest behave like process control instead of bookkeeping.

## Process control

None of this is configured. It's how the lifecycle behaves. Each primitive below maps to something a Unix kernel does, and each is grounded in code you can read.

### Stop an agent — SIGTERM, then SIGKILL

Ask an agent to wind down and it gets a chance to save state first.

```bash
grackle kill <session-id> --graceful
```

Graceful is a **SIGTERM**: the server delivers a `[SIGTERM]` message asking the agent to finish its operation, close its owned fds, and stop — then returns immediately. The agent exits on its own terms. Drop the flag and it's a **SIGKILL**: the session is marked terminal, the host process is disposed, the streams are torn down. No last words.

> Verified: `killAgent` splits on `req.graceful` — SIGTERM delivers the stop message and returns; the SIGKILL path calls `killSessionAndCleanup`, which disposes the host transport and unsubscribes every fd. If SIGTERM delivery fails (environment disconnected), it falls back to a hard kill.

### Reap a finished child — SIGCHLD

When a child task's agent finishes — idle, stopped, killed, crashed — its parent gets woken. Not polled: woken. The parent sleeps until there's something to react to, then a `[SIGCHLD]` signal lands in its session carrying the child's title, status, and last message. The parent reviews, or reassigns, or passes the news up.

> Verified: a SIGCHLD subscriber watches `task.updated` for child tasks whose latest session reaches `idle` or `stopped`, then delivers a `[SIGCHLD]` message to the parent task via `deliverSignalToTask`. Delivery is deduped and retried up to three times.

### Adopt the orphans — reparent to init

If a parent's agent dies while its children are still running — crash, timeout, kill — the children are not left under a corpse. The server **reparents** each orphan up to the grandparent. The root task is the ultimate adopter: the `init(1)` of the tree, the process that takes in everything with nowhere else to go. The orphan's open pipe fds move with it, inherited by its new parent, and an `[ADOPTED]` signal tells that parent it has a new child.

> Verified: an orphan-reparent subscriber fires when a parent task reaches `complete` or `failed`, reparents each non-terminal child to `parentTask.parentTaskId || ROOT_TASK_ID`, transfers the dead parent's `pipe:` subscriptions to the grandparent session, and delivers `[ADOPTED]`. The root task is guarded so it never completes and never gets reparented.

### Take the subtree with the parent — cascade

Kill the orchestrator and the descendants go with it. There's no separate "kill the tree" command because there doesn't need to be: a parent that dies closes the pipe fds its children were held by, the children orphan, and an orphaned session — one with no fds left open — stops itself. The cascade is the fd model running downhill.

> Verified: closing a session's last fd fires the stream-registry orphan callback, which sets the session `STOPPED` and disposes the host process. `completeTask` / `stopTask` / `killSessionAndCleanup` all tear down a task's sessions by unsubscribing their fds, which propagates through the held pipes. `deleteTask` refuses a task that still has children — you delete bottom-up.

### Drops suspend, they don't end

Wires drop. When the transport breaks, the agent goes **suspended** — parked on the server, consuming nothing, full history held. A suspended agent is not a killed one. Reopen the lifecycle stream and it reanimates from where it stood.

> Verified: a revival callback auto-reanimates a `stopped` or `suspended` session when something subscribes to its lifecycle stream again — the "open is reanimate" model — provided it has a runtime session id and the environment is free and connected.

## Plugins are kernel modules

The server is a set of plugins, assembled in dependency order. Some of them _are_ the kernel — they ship the primitives this page describes. `core` is the kernel proper: it can't be disabled and is always loaded. The orchestration, scheduling, and knowledge plugins are kernel modules layered on it.

| Plugin          | What it contributes to the kernel                                                             |
| --------------- | --------------------------------------------------------------------------------------------- |
| `core`          | Spawn, signal delivery, the lifecycle/reaping model, dispatch — always on, cannot be disabled |
| `orchestration` | The task DAG: SIGCHLD, orphan-reparent, escalation. Disable it and you have a session manager |
| `scheduling`    | A reconciliation phase that fires due schedules — cron mechanism                              |
| `knowledge`     | Derived retrieval and prompt context the agent reads before it starts                         |

Enablement is **database-authoritative**. Each optional plugin carries a row in the `plugins` table, and the server loads it if and only if that row says so. Environment variables seed the row on a fresh database — once — and do nothing after. A toggle takes effect on the next restart, not live.

```bash
grackle plugin list                  # every plugin, enabled + loaded state
grackle plugin disable orchestration # persisted; restart to apply
```

This is the module-loading discipline a kernel needs: capability is declared, ordered, and brought up or torn down as a unit. See [Building a Plugin](../extending/plugins) for the contract.

## The reconciliation loop

A kernel doesn't trust the world to stay in the state it left it. It checks. On a fixed tick — ten seconds by default — the **reconciliation loop** runs an ordered list of phases, each one nudging the system toward its desired state.

- **dispatch** — pending work whose dependencies are met and whose environment is connected gets a session spawned for it.
- **lifecycle-cleanup** — stale streams and handles are swept.
- **environment-reconciliation** — connection state is squared against reality; dead connections are dropped.
- **orphan-reparent** — a safety net that re-sweeps for orphans the event path missed (a restart, a dropped event).

Each phase runs in order, errors are caught so one phase can't abort the tick, and a tick that's still running is never doubled up. The event-driven handlers above — SIGCHLD, reaping, reparenting — react in the moment; the loop is the slow, periodic backstop that drives anything that drifted back to where it should be.

> Verified: `ReconciliationManager` ticks every `GRACKLE_RECONCILIATION_TICK_MS` ms (default 10s), runs each phase sequentially with errors isolated, and skips a tick if the previous one is still in flight. Core contributes dispatch, lifecycle-cleanup, and environment-reconciliation; the orphan-reparent phase comes from the orchestration plugin.

## Where to next

- [PowerLine & AHP](./powerline-ahp) — the wire under the spawn primitive
- [Orchestration](../features/orchestration) — the task tree, driven
- [Coordination](../features/coordination) — IPC, streams, the durable action log
- [Building a Plugin](../extending/plugins) — the kernel-module contract
- [Roadmap](../roadmap) — where the kernel is headed when it's carved out
