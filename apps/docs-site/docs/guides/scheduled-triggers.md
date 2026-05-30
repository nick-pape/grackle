---
id: scheduled-triggers
title: Scheduled Triggers
sidebar_position: 9
---

# Scheduled Triggers

Grackle can automatically create and start tasks on a schedule — cron jobs for your agents. Define a schedule with a cron expression or interval, link it to a persona and workspace, and Grackle handles the rest.

## Creating a schedule

### From the CLI

```bash
grackle schedule create "Nightly test suite" \
  --schedule "0 2 * * *" \
  --workspace <workspace-id> \
  --persona <persona-id> \
  --desc "Run the full test suite and report any failures"
```

### From the MCP server

Agents can create schedules too — an orchestrator might set up recurring checks:

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

The full set of schedule MCP tools:

| Tool              | Purpose                                                           |
| ----------------- | ----------------------------------------------------------------- |
| `schedule_create` | Create a schedule (`title`, `scheduleExpression`, `personaId`, …) |
| `schedule_list`   | List schedules, optionally filtered by `workspaceId`              |
| `schedule_show`   | Get one schedule's details by `scheduleId`                        |
| `schedule_update` | Change any field — only the fields you pass are modified          |
| `schedule_delete` | Delete a schedule by `scheduleId`                                 |

To enable or disable a schedule from an agent, call `schedule_update` with `{ "scheduleId": "...", "enabled": false }`.

## Schedule expressions

Grackle supports two formats:

### Interval shorthand

Simple repeating intervals:

| Expression | Meaning          |
| ---------- | ---------------- |
| `30s`      | Every 30 seconds |
| `5m`       | Every 5 minutes  |
| `1h`       | Every hour       |
| `1d`       | Every day        |

:::note Minimum interval
Intervals must be at least **10 seconds**. Anything shorter (e.g. `5s`) is rejected when the schedule is created.
:::

### Standard cron syntax

Five-field cron expressions for precise scheduling:

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-7, 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

**Examples:**

| Expression     | Meaning                              |
| -------------- | ------------------------------------ |
| `0 2 * * *`    | Daily at 2:00 AM                     |
| `0 9 * * 1-5`  | Weekdays at 9:00 AM                  |
| `*/15 * * * *` | Every 15 minutes                     |
| `0 0 1 * *`    | First day of every month at midnight |

:::note Cron is evaluated in UTC
Cron expressions are parsed and evaluated in **UTC**, not your local timezone. `0 9 * * *` fires at 09:00 UTC. Day-of-week names (e.g. `MON`) are also supported.
:::

## How it works

The scheduling plugin contributes a **cron reconciliation phase** that runs on every server tick:

1. Check which schedules are due (based on `nextRunAt`)
2. For each due schedule, create a task in the linked workspace
3. Link the task to the schedule (for tracking)
4. Enqueue the task for dispatch
5. Advance the schedule (update `lastRunAt`, `nextRunAt`, `runCount`)

Tasks created by schedules go through the same lifecycle as any other task — they get dispatched to an available environment, run with the configured persona, and produce results.

:::warning Bad expressions auto-disable
If the cron phase can't compute the next run time for a schedule (for example, the expression became invalid), Grackle **automatically disables that schedule** rather than erroring on every tick. Re-enable it with `grackle schedule enable <schedule-id>` after fixing the expression.
:::

## Managing schedules

### List schedules

```bash
grackle schedule list
# Filter by workspace ID
grackle schedule list --workspace <workspace-id>
```

### Show a schedule

Print the full details of a single schedule (expression, persona, run count, last/next run):

```bash
grackle schedule show <schedule-id>
```

### Enable or disable a schedule

```bash
grackle schedule enable <schedule-id>
grackle schedule disable <schedule-id>
```

### Delete a schedule

```bash
grackle schedule delete <schedule-id>
```

## Disabling the scheduling plugin

If you don't need scheduled triggers, disable the plugin. Plugin enablement is **stored in the database**, so the runtime control is a CLI command (or the `plugin_set_enabled` MCP tool):

```bash
grackle plugin disable scheduling
```

When the plugin is off, the cron reconciliation phase and the schedule gRPC handlers are not loaded.

:::warning Restart required
Plugins are loaded once at server startup, so disabling (or re-enabling) one **only takes effect after you restart Grackle**. The CLI reminds you of this after the command runs.
:::

The `GRACKLE_SKIP_SCHEDULING=1` environment variable only seeds the **initial** state on a brand-new database — it does not override the stored state on subsequent runs. Once the database exists, the stored value is authoritative; use `grackle plugin disable scheduling` to change it. Run `grackle plugin list` to see the current state of all plugins.

## External triggers

Cron schedules are one way to start work automatically. A separate, complementary mechanism lets **external systems** (CI, alerting tools, chat bots) inject a message into a running session over an HTTP webhook.

```bash
grackle channel expose --session <session-id> --label "ci-notifier"
```

This mints a capability-scoped webhook URL (`POST /hook/<token>`). A `POST` to that URL with a JSON body like `{ "message": "deploy finished" }` injects the message into the target session as user input. List grants with `grackle channel ls` and revoke them with `grackle channel revoke <grant-id>`.

This is a distinct trigger path from cron — it injects into an **existing** session rather than creating a new task — and it's part of the `grackle channel` feature, not the scheduling plugin.
