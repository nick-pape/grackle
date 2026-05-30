---
id: personas
title: Personas
sidebar_position: 6
---

# Personas

A **persona** is a reusable agent configuration. It defines how an agent behaves — what runtime it uses, which model, what system prompt it follows, and what tools it has access to.

## What a persona defines

| Field                 | Description                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Name**              | Display name (e.g., "Senior Engineer")                                                                          |
| **Type**              | `agent` (interactive LLM session) or `script` (run-to-completion) — see below                                   |
| **Runtime**           | Any [runtime](./runtimes) catalog key (`claude-code`, `copilot`, `codex`, `goose`, `genaiscript`, ACP variants) |
| **Model**             | Which AI model (e.g., `sonnet`, `gpt-4o`, `o3`) — required for agent personas, optional for scripts             |
| **System prompt**     | Instructions prepended to every session                                                                         |
| **Max turns**         | Turn limit (0 = unlimited)                                                                                      |
| **Tool config**       | Allowed and disallowed tool lists                                                                               |
| **MCP servers**       | Additional MCP servers the agent can access                                                                     |
| **Allowed MCP tools** | Persona-scoped allowlist of Grackle MCP tool names (see [Persona MCP tools](#persona-mcp-tools))                |

## Agent personas vs. script personas

Every persona has a **type**:

- **`agent`** (the default) — an interactive LLM session. The runtime drives a model through a conversation, turn by turn, until the task is done or the turn limit is hit. A model is required.
- **`script`** — a [GenAIScript](./runtimes) program that runs to completion. The `script` field holds the source code (or you load it from a file). Script personas don't require a model, since the script itself decides which models, if any, to call.

```bash
# Script persona that runs a GenAIScript to completion
grackle persona create "Nightly Report" \
  --type script \
  --runtime genaiscript \
  --script-file ./scripts/report.genai.mjs
```

## Creating a persona

From the CLI:

```bash
grackle persona create "Senior Reviewer" \
  --runtime claude-code \
  --model sonnet \
  --prompt "You are a senior code reviewer. Focus on correctness, security, and maintainability. Do not make changes — only review and report issues." \
  --max-turns 5
```

Or load the system prompt from a file:

```bash
grackle persona create "Architect" \
  --runtime claude-code \
  --model sonnet \
  --prompt-file ./prompts/architect.md
```

From the web UI, go to **Settings > Personas** and click **Create**.

## The default persona

On first run, Grackle creates a **Claude Code** persona with the `sonnet` model. The setup wizard lets you change the runtime. This persona is used whenever no other persona is specified.

## Resolution cascade

When starting a session, Grackle resolves which persona to use through a cascade:

1. **Explicit request** — `--persona` flag on spawn/start
2. **Task default** — Persona configured on the task
3. **Workspace default** — Persona configured on the workspace
4. **App default** — The global default persona setting

The first non-empty value wins.

## Tool configuration

Personas can restrict which tools an agent has access to:

- **Allowed tools** — Whitelist of tools the agent can use
- **Disallowed tools** — Blacklist of tools to block

This is useful for creating read-only reviewers (block `Write`, `Edit`, `Bash`) or focused specialists (only allow specific MCP tools).

## MCP servers

Personas can include additional MCP servers that are made available to the agent during sessions. Each server specifies:

- **Name** — Server identifier
- **Command** — How to start the server (e.g., `npx @some/mcp-server`)
- **Args** — Command-line arguments
- **Tools** — Optional allowlist of tools from this server

This lets you give agents access to external tools — database clients, API explorers, documentation search — without modifying the global configuration.

## Persona MCP tools

This is a **separate** mechanism from the tool config and from per-MCP-server tool lists. The **allowed MCP tools** field (`allowed_mcp_tools`) is a persona-scoped allowlist over Grackle's own built-in MCP tools (`task_create`, `task_list`, and so on) — the tools the agent uses to coordinate with Grackle itself.

To recap the three distinct controls:

- **Tool config** (allow/deny lists) — gates the agent's _runtime_ tools (`Write`, `Edit`, `Bash`, etc.).
- **MCP server tools** — an optional allowlist scoped to a single external MCP server the persona adds.
- **Allowed MCP tools** — the persona-scoped allowlist over Grackle's built-in MCP tools. When empty, the agent gets the default scoped set.

The CLI exposes presets for the built-in tools so you don't have to list them by hand:

```bash
# Use a preset: default, worker, orchestrator, or admin
grackle persona create "Worker" --prompt "You are a worker." --mcp-tools-preset worker

# Or list specific tools explicitly
grackle persona create "Reporter" --prompt "..." --mcp-tools task_list,task_search,task_show
```

The presets are:

- **`default`** — the baseline scoped set for task agents.
- **`worker`** — a strict subset for leaf-task execution (no subtask creation).
- **`orchestrator`** — a superset of `default` with task-coordination tools.
- **`admin`** — the broadest set.

## Managing personas

```bash
# List all personas
grackle persona list

# View full details (including system prompt)
grackle persona show <id>

# Update fields
grackle persona edit <id> --model opus --max-turns 10

# Delete
grackle persona delete <id>
```
