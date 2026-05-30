---
id: orchestration
title: Orchestration (Lifecycle)
sidebar_position: 5
---

# Orchestration (Lifecycle)

Grackle runs agents the way a kernel runs processes. You spawn them, they spawn children, and the whole tree has a lifecycle: start, signal, suspend, kill, adopt the orphans. You don't drive that machinery by hand. You set the work in motion and it holds the shape — a parent that gets woken when a child finishes, a kill that takes the descendants with it, an escalation that climbs until a human answers.

Orchestration is a **plugin**. It ships on. Turn it off and Grackle becomes a plain session manager — agents on wires, no task tree.

```bash
grackle plugin disable orchestration
```

Plugin state lives in the database; the change takes effect after a server restart. See [Plugins](../extending/plugins).

## The four-level ladder

You don't adopt all of this at once. Each rung builds on the last — stay on rung one as long as it serves you.

| Level | What you run                        | What you get                                     |
| ----- | ----------------------------------- | ------------------------------------------------ |
| **1** | One agent, one task                 | Spawn it, watch it, kill it when it strays       |
| **2** | A task tree with dependencies       | Work runs in order; you review each piece        |
| **3** | Many agents in parallel             | Each on its own wire, its own worktree           |
| **4** | An orchestrator agent over children | One agent decomposes the work and runs the group |

Levels 1 and 2 cover most days. Reach for 3 and 4 when one problem is big enough to want several agents on it — see [Coordination](./coordination).

## Process control

Under the tree, Grackle borrows the kernel's vocabulary. None of this needs configuring. It is how the lifecycle behaves.

### A parent wakes when a child finishes

When a child task ends — done or failed — its parent's agent gets the news: title, status, last message. No polling. The parent sleeps until there's something to react to, then it reacts.

### Stop an agent, gently or hard

Ask an agent to wind down and it gets a chance to save state before it exits.

```bash
grackle kill <session-id> --graceful
```

Drop the flag for a hard kill — immediate, no last words.

### Kill the parent, kill the tree

Kill an orchestrator and its descendants go with it. The process-group equivalent: one signal, the whole subtree terminates.

### Orphans get adopted

If a parent's agent dies while its children are still running — crash, timeout, kill — the server re-parents the orphaned tasks up to the grandparent, and ultimately to the root task. Nothing is left running under a dead parent. This is `init(1)` adopting orphans, in fewer words.

### Drops suspend, they don't end

Wires drop. When the transport breaks, the agent goes **suspended** — parked on the server, consuming nothing, full history held. Reconnect and it picks up mid-thought.

```bash
grackle resume <session-id>
```

A suspended agent is not a killed one. See [Tasks & sessions](../building-blocks/tasks-sessions) for the full lifecycle.

## Escalation climbs to a human

An agent that can't proceed — needs input, hit a wall it can't clear — doesn't hang. It exits with a `needs_input` disposition and the parent is woken. The parent handles it or passes it up. The signal climbs the tree until it reaches a human.

1. The agent posts its context to the workpad.
2. The parent is woken with the `needs_input` status.
3. The parent handles it, or escalates further up.
4. The chain flows up the tree until a human gets it.

No dedicated escalation subsystem — it falls out of the same parent-child wiring. Deliver escalations outside the browser with a webhook:

```bash
grackle notify set-webhook <url>
```

See [Webhooks](../advanced/webhooks).

## Where to next

- [Run an orchestration](../getting-started/create-orchestration) — the walkthrough
- [Coordination](./coordination) — several agents on one problem
- [Tasks & sessions](../building-blocks/tasks-sessions) — the lifecycle in full
- [Scheduled tasks](../advanced/scheduled-tasks) — set work in motion on a clock
- [Webhooks](../advanced/webhooks) — escalations out of the browser
- [Usage & budgets](./usage-budgets) — cap what a run can spend
- [Kernel](../architecture/kernel) — the process model, internals
- [Plugins](../extending/plugins) — turn orchestration off
