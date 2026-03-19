---
id: web-ui
title: Web UI
sidebar_position: 4
---

# Web UI

The Grackle web UI is a real-time dashboard for managing environments, projects, tasks, and agent sessions. It's served by the Grackle server at **http://localhost:3000** by default.

## First-run setup

On first launch, a setup wizard walks you through:

1. **Welcome** — Brief introduction
2. **About** — What Grackle does
3. **Runtime selection** — Pick your default agent runtime (Claude Code, Copilot, or Codex)

This creates your default persona and marks onboarding complete. You won't see the wizard again.

## Pairing

The web UI requires authentication. Generate a pairing code from the CLI:

```bash
grackle pair
```

Enter the 6-character code in the browser, or scan the QR code from your phone. The session lasts 24 hours.

## Sidebar

The left sidebar shows:

- **Projects** — Click to see a project's tasks
- **Quick actions** — Create new projects, tasks, or sessions

## Project view

Each project has three tabs:

### Tasks tab
A flat list of all tasks in the project with status badges, branch names, and dependency info.

### Board tab
A kanban board with columns for each status: Not Started, Working, Paused, Complete, Failed. Shows task completion progress as a percentage bar.

### Graph tab
A DAG (directed acyclic graph) visualization showing task hierarchy and dependencies. Useful for understanding the structure of complex projects.

## Task view

Clicking a task opens a detail view with three tabs:

### Overview
- Status badge and metadata (branch, environment, persona, timestamps)
- Description (editable inline)
- Action buttons: Start, Complete, Resume, Delete

### Stream
Real-time event feed from the task's latest session. Shows:
- Agent text output
- Tool calls (with name and input)
- Tool results
- Status changes
- System messages

When the session is waiting for input, an input field appears at the bottom.

### Findings
All findings for the task's project, displayed as categorized cards with color coding by category (bug, architecture, decision, etc.) and tags.

## Session view

Direct session views (outside of tasks) show the same real-time event stream. You can start a new ad-hoc session by clicking **New Chat**, selecting an environment, and typing a prompt.

## Settings

The settings page has tabs for:

### Environments
List, add, and manage environments. Shows status, adapter type, and bootstrap state for each.

### Credentials
Configure credential providers (Claude, GitHub, Copilot, Codex) and manage tokens.

### Personas
Create, edit, and manage agent personas. Each shows its runtime, model, max turns, and description.

### Appearance
Theme and display preferences.

### About
Version information and links.
