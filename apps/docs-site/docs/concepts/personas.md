---
id: personas
title: Personas
sidebar_position: 6
---

# Personas

A **persona** is a reusable agent configuration. It defines how an agent behaves — what runtime it uses, which model, what system prompt it follows, and what tools it has access to.

## What a persona defines

| Field | Description |
|-------|------------|
| **Name** | Display name (e.g., "Senior Engineer") |
| **Runtime** | Which agent engine to use (`claude-code`, `copilot`, `codex`) |
| **Model** | Which AI model (e.g., `sonnet`, `gpt-4o`, `o3`) |
| **System prompt** | Instructions prepended to every session |
| **Max turns** | Turn limit (0 = unlimited) |
| **Tool config** | Allowed and disallowed tool lists |
| **MCP servers** | Additional MCP servers the agent can access |

## Creating a persona

From the CLI:

```bash
grackle persona create "Senior Reviewer" \
  --runtime claude-code \
  --model sonnet \
  --prompt "You are a senior code reviewer. Focus on correctness, security, and maintainability. Do not make changes — only review and post findings." \
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
3. **Project default** — Persona configured on the project
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
