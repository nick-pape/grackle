---
id: scheduled-tasks
title: Scheduled Tasks (Cron)
sidebar_position: 2
---

# Scheduled Tasks (Cron)

Grackle keeps a calendar. A task wakes on a schedule, does the job, and goes back to the wire — no human at the keyboard. Define a schedule, bind it to a persona and workspace, and the server creates and starts the task when the clock comes round.

## Create a schedule

From the CLI:

```bash
grackle schedule create "Nightly test suite" \
  --schedule "0 2 * * *" \
  --workspace <workspace-id> \
  --persona <persona-id> \
  --desc "Run the full test suite and report any failures"
```

Or from an agent over MCP — an orchestrator setting up its own recurring checks:

```json
{
  "tool": "schedule_create",
  "input": {
    "title": "Dependency audit",
    "scheduleExpression": "1d",
    "workspaceId": "...",
    "personaId": "..."
  }
}
```

## Expressions

Two formats. Both stay literal — the string is what you type.

### Interval shorthand

| Expression | Means            |
| ---------- | ---------------- |
| `30s`      | Every 30 seconds |
| `5m`       | Every 5 minutes  |
| `1h`       | Every hour       |
| `1d`       | Every day        |

Intervals floor at **10 seconds**. Anything shorter — `5s` — is rejected at create time.

### Cron

Five fields, standard syntax:

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-7, 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

| Expression     | Means                        |
| -------------- | ---------------------------- |
| `0 2 * * *`    | Daily at 2:00                |
| `0 9 * * 1-5`  | Weekdays at 9:00             |
| `*/15 * * * *` | Every 15 minutes             |
| `0 0 1 * *`    | First of the month, midnight |

:::warning Cron runs in UTC
Expressions are parsed and evaluated in **UTC**, not your local clock. `0 9 * * *` fires at 09:00 UTC. Day-of-week names (`MON`) work too.
:::

## What happens when the clock comes round

On each server tick the scheduling plugin checks which schedules are due, and for each one:

1. Creates a task in the linked workspace.
2. Links the task back to the schedule.
3. Enqueues it for dispatch.
4. Advances the schedule — `lastRunAt`, `nextRunAt`, `runCount`.

A scheduled task is an ordinary task. It dispatches to an environment, runs the persona, produces results — the same lifecycle as work you start by hand. See [Tasks & sessions](../building-blocks/tasks-sessions).

:::warning A bad expression disables itself
If the plugin can't compute the next run — the expression went invalid — it **disables that schedule** instead of erroring on every tick. Fix the expression, then re-enable it.
:::

## Manage schedules

```bash
grackle schedule list                          # all schedules
grackle schedule list --workspace <workspace-id>
grackle schedule show <schedule-id>            # one schedule, in full
grackle schedule enable <schedule-id>
grackle schedule disable <schedule-id>
grackle schedule delete <schedule-id>
```

Agents do the same over MCP:

| Tool              | Purpose                                                           |
| ----------------- | ----------------------------------------------------------------- |
| `schedule_create` | Create a schedule (`title`, `scheduleExpression`, `personaId`, …) |
| `schedule_list`   | List schedules, optionally filtered by `workspaceId`              |
| `schedule_show`   | One schedule's details by `scheduleId`                            |
| `schedule_update` | Change any field — only the fields you pass move                  |
| `schedule_delete` | Delete a schedule by `scheduleId`                                 |

To enable or disable from an agent, call `schedule_update` with `{ "scheduleId": "...", "enabled": false }`.

## Turn scheduling off

Don't need the calendar? Disable the plugin. Plugin state lives in the database, so the control is a CLI command (or the `plugin_set_enabled` MCP tool):

```bash
grackle plugin disable scheduling
```

With it off, the cron reconciliation phase and the schedule gRPC handlers never load.

:::warning Restart required
Plugins load once, at startup. Disabling or re-enabling one **takes effect only after you restart Grackle**. The CLI says so when the command runs.
:::

`GRACKLE_SKIP_SCHEDULING=1` only seeds the **initial** state on a fresh database. Once the database exists, the stored value wins — use `grackle plugin disable scheduling` to change it. `grackle plugin list` shows where every plugin stands.

## Not the only way in

Cron starts new work on a clock. The other path is a webhook: an external system — CI, an alerting tool, a chat bot — injecting a message into a session that's already running. Different trigger, different shape. See [Webhooks](./webhooks).

## Where to next

- [Orchestration](../features/orchestration) — the lifecycle scheduled work runs under
- [Tasks & sessions](../building-blocks/tasks-sessions) — what a scheduled task becomes
- [Webhooks](./webhooks) — the external trigger path
- [CLI](../features/cli) — every `schedule` command in full
