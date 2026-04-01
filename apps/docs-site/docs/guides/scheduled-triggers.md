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
grackle schedule create \
  --title "Nightly test suite" \
  --expression "0 2 * * *" \
  --workspace my-project \
  --persona engineer \
  --description "Run the full test suite and post findings on any failures"
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

## Schedule expressions

Grackle supports two formats:

### Interval shorthand

Simple repeating intervals:

| Expression | Meaning |
|-----------|---------|
| `30s` | Every 30 seconds |
| `5m` | Every 5 minutes |
| `1h` | Every hour |
| `1d` | Every day |

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

| Expression | Meaning |
|-----------|---------|
| `0 2 * * *` | Daily at 2:00 AM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `*/15 * * * *` | Every 15 minutes |
| `0 0 1 * *` | First day of every month at midnight |

## How it works

The scheduling plugin contributes a **cron reconciliation phase** that runs on every server tick:

1. Check which schedules are due (based on `nextRunAt`)
2. For each due schedule, create a task in the linked workspace
3. Link the task to the schedule (for tracking)
4. Enqueue the task for dispatch
5. Advance the schedule (update `lastRunAt`, `nextRunAt`, `runCount`)

Tasks created by schedules go through the same lifecycle as any other task — they get dispatched to an available environment, run with the configured persona, and produce findings and results.

## Managing schedules

### List schedules

```bash
grackle schedule list
grackle schedule list --workspace my-project
```

### Update a schedule

```bash
grackle schedule update <schedule-id> --expression "0 3 * * *"
grackle schedule update <schedule-id> --enabled false
```

### Delete a schedule

```bash
grackle schedule delete <schedule-id>
```

## Disabling the scheduling plugin

If you don't need scheduled triggers, disable the plugin entirely:

```bash
GRACKLE_SKIP_SCHEDULING=1 grackle serve
```

This removes the cron phase and schedule gRPC handlers from the server.
