---
id: create-task
title: Create a Task
sidebar_position: 4
---

# Create a Task

Stop babysitting an agent in a terminal. Create a task, run an agent on it, walk away. The work streams to the server, lands in a log, and survives a dropped wire. Come back and pick up where it left off.

This is the single-agent flow. One workspace, one task, one agent.

## 1. Make a workspace

A workspace groups work against a linked [environment](./connect-environment).

```bash
grackle workspace create "Auth Rewrite" --env my-env --repo https://github.com/org/repo
```

It prints a workspace id. The environment passed to `--env` is auto-linked.

## 2. Create a task

A task is one unit of work — a title the agent runs as its prompt, a description it gets as context.

```bash
grackle task create "Implement JWT middleware" --workspace auth-rewrite --desc "Replace session auth with RS256 JWTs."
```

It prints a task id and the branch the agent will work on.

## 3. Start the agent

Spawn a [session](../building-blocks/tasks-sessions) on the task. It runs on the wire and starts working.

```bash
grackle task start <task-id>
```

It prints the session id. The agent is now working on the wire.

## 4. Watch, then detach

Attach to the live stream — text, tool calls, results — whenever you want eyes on it.

```bash
grackle attach <session-id>
```

`Ctrl+C` detaches. The agent keeps working; events keep buffering on the server.

## 5. Resume

Come back to a live stream and an input prompt whenever you want.

```bash
grackle resume <session-id>
```

A dropped wire suspends the agent on its own; `resume` brings it back too. Full history intact.

## 6. Check your agents

See what's running right now.

```bash
grackle status
```

Add `--all` to include stopped sessions and their end reasons.

---

That's one agent on one task. To split work across [a group of agents](./create-orchestration) — one agent decomposing, others working the pieces — see [Create an Orchestration](./create-orchestration).

More: [the CLI](../features/cli), [usage budgets](../features/usage-budgets).
