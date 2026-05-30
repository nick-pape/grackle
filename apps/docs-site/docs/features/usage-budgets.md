---
id: usage-budgets
title: Usage & Budgets
sidebar_position: 8
---

# Usage & Budgets

Every claw burns tokens, and tokens cost money. Grackle counts both, per session, and rolls them up. Set a ceiling and a claw that runs past it gets told to stop.

## What's tracked

Each [session](../building-blocks/tasks-sessions) carries its own meter:

| Field             | What it holds                             |
| ----------------- | ----------------------------------------- |
| `input_tokens`    | Tokens sent to the model                  |
| `output_tokens`   | Tokens the model sent back                |
| `cost_millicents` | Spend in millicents — `$0.00001` per unit |

The runtime reports these as the claw works; the server tallies them into the session row.

## Where to see it

`grackle status` lists live sessions with **Tokens** and **Cost** columns — input→output and the running spend.

```bash
grackle status
```

Roll usage up across a wider scope with the `usage_get` MCP tool. Pass a `scope` and an `id` and it returns input/output tokens, USD cost, and the session count under it.

| Scope         | Aggregates over                                                 |
| ------------- | --------------------------------------------------------------- |
| `session`     | One session                                                     |
| `task`        | A task's sessions                                               |
| `task_tree`   | A task and every subtask                                        |
| `workspace`   | A whole [workspace](../building-blocks/environments-workspaces) |
| `environment` | A whole environment                                             |

A `grackle task show` and `grackle workspace get` print the same totals against the budget, when one is set.

## Capping a task

A budget is a hard cap. `0` means unlimited.

```bash
grackle task create "ship the migration" --token-budget 500000 --cost-budget-millicents 200000
```

- `--token-budget` — total tokens (input + output) the task and its sessions may burn.
- `--cost-budget-millicents` — total spend, in millicents (here, `$2.00`).

Change it later:

```bash
grackle task update <task-id> --token-budget 1000000
```

## Capping a workspace

A workspace budget is the aggregate cap across every task it holds.

```bash
grackle workspace create my-repo --token-budget 5000000 --cost-budget-millicents 1000000
grackle workspace update <id> --cost-budget-millicents 2000000
```

The task cap is checked first, then the workspace cap. A claw under both answers to whichever it hits first.

## The ceiling

When a session crosses a budget, the server doesn't pull the plug. It sends the claw a SIGTERM prompt: finish the current operation, save your work, close your pipes, then call `task_complete` and stop. The claw gets to land cleanly.

The session ends with `end_reason` set to `budget_exceeded`. That's the mark you look for — a claw that didn't finish its work, it finished its allowance.

A budget caps spend. It doesn't cap a claw mid-thought — it tells it the run is over and waits for it to wind down.

---

Next: drive these from the [CLI](./cli), or let a parent claw spend within them under [Orchestration](./orchestration).
