---
id: web-ui
title: Web UI
sidebar_position: 1
---

# Web UI

The Grackle web UI is a real-time dashboard for managing environments, workspaces, tasks, and agent sessions. It's served by the Grackle server at **http://localhost:3000** by default.

![Dashboard — workspaces, tasks, and session overview](/img/dashboard-projects-tasks.png)

## First-run setup

On first launch, a setup wizard walks you through:

1. **Welcome** — Brief introduction
2. **About** — What Grackle does
3. **Runtime selection** — Pick your default agent runtime (Claude Code, Copilot, Codex, or Goose)
4. **Notifications** — Optionally grant browser notification permission

This updates your default persona's runtime and drops you into the [chat interface](./chat). You won't see the wizard again.

## Pairing

The web UI requires authentication. Generate a pairing code from the CLI:

```bash
grackle pair
```

Enter the 6-character code in the browser, or scan the QR code from your phone. The session lasts 24 hours.

## Chat landing page

The default landing page is a [chat interface](./chat) where you can type natural language commands. The agent uses Grackle's MCP tools to manage environments, tasks, sessions, and more — no CLI memorization required.

## Navigation

A top navigation bar switches between the main views:

- **Dashboard** — Home / overview
- **Tasks** — Cross-workspace task list (shown only when the orchestration plugin is active)
- **Environments** — Your environments, and the workspaces nested under them
- **Root** — The [chat interface](./chat) (root-task conversation)
- **Knowledge** — The [knowledge graph](./knowledge-graph) explorer (shown only when the knowledge plugin is active)
- **Coordination** — Read-only inventory of inter-agent IPC streams
- **Settings** — Credentials, personas, appearance, and more (pinned to the right)

:::note
Grackle is **environment-centric**. Workspaces live under environments: navigating to a workspace uses the path `/environments/:envId/workspaces/:wsId`. The top-level **Environments** view is the entry point — visiting `/workspaces` redirects to `/environments`, and any legacy `/workspaces/:id` link is redirected to its environment-scoped path.
:::

### Contextual left sidebar

Some views also show a contextual left sidebar:

- The **Environments** view lists your environments and their workspaces, so you can drill into a workspace's tasks, board, and graph.
- The **Tasks** and **Knowledge** views show their own browsing sidebars.

## Knowledge

The **Knowledge** view (provided by the `knowledge` plugin) is an explorer for Grackle's [knowledge graph](./knowledge-graph) — entities and the relationships derived from your tasks and sessions.

## Coordination

The **Coordination** view shows a read-only inventory of inter-agent IPC streams, surfacing how concurrent agents communicate. Legacy per-stream chat URLs redirect here.

## Workspace view

Each workspace has three tabs (use keys `1`/`2`/`3` to switch between them):

### Graph tab

An interactive DAG (directed acyclic graph) visualization showing task hierarchy and dependencies. Click any node to see its stream or overview.

![DAG visualization — interactive task dependency graph](/img/dag-visualization.png)

### Board tab

A kanban board with columns for each status: Not Started, Working, Paused, Complete, Failed. Shows task completion progress.

### Tasks tab

A searchable list of all tasks in the workspace with status badges, branch names, and dependency info.

## Task view

Clicking a task opens a full-page detail view with click-to-edit fields:

### Overview

- Status badge and metadata (branch, environment, persona, timestamps)
- Description, title, and all fields are **inline editable** — click any field to edit, press Enter to save, Escape to cancel
- Token usage tracking
- Action buttons: Start, Complete, Resume, Delete

### Stream

Real-time event feed from the task's latest session. Shows:

- Agent text output
- Tool calls with specialized cards (file edits show diffs, grep shows matches, bash shows output)
- Tool results (collapsible)
- Status changes and system messages

When the session is waiting for input, an input field appears at the bottom.

![Live agent stream — tool cards and real-time output](/img/task-stream-view.png)

## Creating and editing entities

Grackle uses a **unified create/edit pattern** across all entity types (workspaces, tasks, personas, environments):

- **Edit mode**: Full-page view with click-to-edit fields. Each field auto-saves on blur or Enter. Escape cancels.
- **Create mode**: Same page layout, but all fields start in edit mode with a "Create" button. After creation, the page transitions to the edit URL.

This consistent pattern works the same whether you're creating a task, editing a persona, or configuring an environment.

## Settings

The settings page has tabs for:

### Credentials

Configure [credential providers](./credentials) (Claude, GitHub, Copilot, Codex, Goose) and manage encrypted tokens. (The legacy "Tokens" route redirects here.)

### GitHub Accounts

Connect and manage GitHub accounts used for repository access.

### Personas

Create, edit, and manage [agent personas](../concepts/personas). Each shows its runtime, model, max turns, system prompt, and MCP tool permissions.

![Persona management — runtime, model, and MCP configuration](/img/persona-management-view.png)

### Schedules

Create and manage [scheduled triggers](./scheduled-triggers) that run agents on a cron schedule.

### Appearance

Theme selection with 9 built-in themes (several with light/dark variants).

![Themes — built-in color schemes](/img/theme-grid.png)

### Shortcuts

View the available keyboard shortcuts.

### Plugins

See which [plugins](./plugins) are active and what they contribute.

### About

Version information and links.

:::note
Environments are no longer a Settings tab — they have moved to the top-level **Environments** view. Visiting `settings/environments` redirects there.
:::

![Environment detail — adapter type, sessions, and management](/img/environment-detail.png)
