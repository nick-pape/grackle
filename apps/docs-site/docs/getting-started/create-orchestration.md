---
id: create-orchestration
title: Create an Orchestration
sidebar_position: 5
---

# Create an Orchestration

One claw is a start. A plague gets work done.

Here you turn a single agent into a coordinated mob: a parent claw breaks a task apart, spawns subtasks, and herds them to done. You set the persona and the rule that lets it decompose. The agent does the rest.

## 1. Create a persona

A [persona](../building-blocks/personas-runtimes) is the agent's identity — runtime, model, system prompt, and which Grackle tools it can reach.

```bash
grackle persona create "Orchestrator" \
  --runtime claude-code \
  --model sonnet \
  --prompt "Decompose the task into subtasks, create them, start them, and coordinate the work." \
  --mcp-tools-preset orchestrator
```

`--mcp-tools-preset orchestrator` hands the agent the coordination tools (`task_create` and friends) it needs to spawn children.

## 2. Create a task that can decompose

`--can-decompose` is the switch. Without it, a claw works one task and stops. With it, it's allowed to spawn subtasks.

```bash
grackle task create "Implement OAuth2 support" --workspace <workspace-id> --can-decompose
```

Set the persona as the task's default with `task update`:

```bash
grackle task update <task-id> --persona <persona-id>
```

The persona resolves through a cascade — task default, then workspace, then app. You can also override it at start with `grackle task start <task-id> --persona orchestrator`.

## 3. Let the parent claw run

Start it. The parent perches, reads the work, and breaks it down.

```bash
grackle task start <task-id>
```

From here it's hands-off:

- The parent splits the work into child [tasks](../building-blocks/tasks-sessions), each its own session.
- Dependencies gate the order — a child waits until what it depends on finishes.
- When a child completes, the parent is woken with its result. No polling.
- Results flow back up the tree until the root is done.

## 4. Watch the plague

The task tree is the map of the run.

```bash
grackle task list <workspace-id>
grackle task show <task-id>
```

Or open the web UI to watch the tree fill in and step into any claw mid-run. See [Orchestration](../features/orchestration) and [Coordination](../features/coordination) for the full picture.

---

Tired of typing the commands? Hand the wheel to the agent: [Let Claude Drive Grackle](./claude-drives-grackle).
