---
id: cli-reference
title: CLI Reference
sidebar_position: 5
---

# CLI Reference

The Grackle CLI (`@grackle-ai/cli`) is the primary interface for managing environments, sessions, tasks, and configuration.

## Connection

The CLI connects to the Grackle server via gRPC. Configuration:

| Setting | Default | Environment Variable |
|---------|---------|---------------------|
| Server URL | `http://127.0.0.1:7434` | `GRACKLE_URL` |
| API key | `~/.grackle/api-key` | `GRACKLE_API_KEY` |
| Home directory | `~/.grackle` | `GRACKLE_HOME` |

## Server

### `grackle serve`

Start the Grackle server (gRPC + Web UI + WebSocket + MCP).

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | 7434 | gRPC server port |
| `--web-port` | 3000 | Web UI port |
| `--mcp-port` | 7435 | MCP server port |
| `--powerline-port` | 7433 | Local PowerLine port |
| `--allow-network` | off | Bind to 0.0.0.0 for LAN access |

### `grackle pair`

Generate a pairing code for web UI authentication. Prints the code, a URL, and a QR code. Codes expire after 5 minutes.

## Environments

### `grackle env list`

List all environments with ID, type, status, and bootstrap state.

### `grackle env add <name>`

Register a new environment.

| Flag | Description |
|------|-------------|
| `--docker` | Docker adapter |
| `--ssh` | SSH adapter |
| `--local` | Local adapter |
| `--codespace` | GitHub Codespace adapter |
| `--image <image>` | Docker image |
| `--repo <repo>` | Git repo to clone (Docker) |
| `--volume <v>` | Volume mount — `host:container[:ro]` (repeatable) |
| `--gpu [gpus]` | GPU passthrough (Docker) |
| `--host <host>` | SSH hostname (required for SSH) |
| `--user <user>` | SSH user |
| `--ssh-port <port>` | SSH port (default: 22) |
| `--identity-file <path>` | SSH private key path |
| `--codespace-name <name>` | Codespace name (required for Codespace) |
| `--port <port>` | PowerLine port (Local) |

### `grackle env provision <id>`

Bootstrap and connect an environment. Streams progress.

### `grackle env wake <id>`

Reconnect a stopped environment (same as provision).

### `grackle env stop <id>`

Gracefully disconnect an environment.

### `grackle env destroy <id>`

Stop and tear down environment resources.

### `grackle env remove <id>`

Unregister an environment from Grackle.

## Sessions

### `grackle spawn <env-id> <prompt>`

Start a new agent session and stream its output.

| Flag | Description |
|------|-------------|
| `--max-turns <n>` | Maximum agent turns |
| `--persona <id>` | Persona to use |

### `grackle attach <session-id>`

Attach to a running session. Interactive — prompts for input when the session is waiting. `Ctrl+C` to detach.

### `grackle resume <session-id>`

Resume a completed or interrupted session.

### `grackle send-input <session-id> <text>`

Send text input to a session waiting for input.

### `grackle kill <session-id>`

Terminate a running session.

### `grackle status`

List active sessions.

| Flag | Description |
|------|-------------|
| `--env <id>` | Filter by environment |
| `--all` | Include completed sessions |

## Projects

### `grackle project list`

List all active projects.

### `grackle project create <name>`

| Flag | Description |
|------|-------------|
| `--repo <url>` | Repository URL |
| `--env <id>` | Default environment |
| `--desc <text>` | Description |
| `--no-worktrees` | Disable worktree isolation |
| `--worktree-base-path <path>` | Custom worktree base path |

### `grackle project get <id>`

Show full project details.

### `grackle project update <id>`

Update project properties. Same flags as `create` (all optional).

### `grackle project archive <id>`

Archive a project.

## Tasks

### `grackle task list [project-id]`

| Flag | Description |
|------|-------------|
| `--search <query>` | Filter by title/description |
| `--status <status>` | Filter by status |

### `grackle task create <title>`

| Flag | Description |
|------|-------------|
| `--project <id>` | Project to create in |
| `--desc <text>` | Description |
| `--depends-on <ids>` | Comma-separated dependency task IDs |

### `grackle task show <task-id>`

Display full task details.

### `grackle task update <task-id>`

| Flag | Description |
|------|-------------|
| `--title <text>` | New title |
| `--desc <text>` | New description |
| `--status <status>` | New status |
| `--depends-on <ids>` | Dependency task IDs |
| `--session <id>` | Bind an existing session to this task |

### `grackle task start <task-id>`

Start a task by spawning an agent session.

| Flag | Description |
|------|-------------|
| `--persona <id>` | Persona override |
| `--env <id>` | Environment override |
| `--notes <text>` | Feedback for retry attempts |

### `grackle task complete <task-id>`

Mark a task as complete.

### `grackle task resume <task-id>`

Resume the latest session for a task.

### `grackle task delete <task-id>`

Delete a task (kills active sessions first).

## Personas

### `grackle persona list`

List all personas.

### `grackle persona create <name>`

| Flag | Description |
|------|-------------|
| `--prompt <text>` | System prompt (inline) |
| `--prompt-file <path>` | System prompt from file |
| `--desc <text>` | Description |
| `--runtime <runtime>` | Runtime (claude-code, copilot, codex) |
| `--model <model>` | Model (sonnet, gpt-4o, o3, etc.) |
| `--max-turns <n>` | Maximum turns |

### `grackle persona show <id>`

Display full persona details including system prompt.

### `grackle persona edit <id>`

Update persona properties. Same flags as `create` (all optional).

### `grackle persona delete <id>`

Delete a persona.

## Findings

### `grackle finding list <project-id>`

| Flag | Description |
|------|-------------|
| `--category <cat>` | Filter by category |
| `--tag <tag>` | Filter by tag |
| `--limit <n>` | Max results (default: 20) |

### `grackle finding post <project-id> <title>`

| Flag | Description |
|------|-------------|
| `--category <cat>` | Category (default: general) |
| `--content <text>` | Finding content |
| `--tags <tags>` | Comma-separated tags |

## Tokens

### `grackle token set <name>`

| Flag | Description |
|------|-------------|
| `--file <path>` | Read value from file |
| `--env <var>` | Read value from environment variable |
| `--type <type>` | Token type: `env_var` or `file` |
| `--env-var <name>` | Env var name on PowerLine (default: `NAME_TOKEN`) |
| `--file-path <path>` | File path on PowerLine |

If no source flag is given, prompts for the value interactively.

### `grackle token list`

List tokens (values are never displayed).

### `grackle token delete <name>`

Delete a token.

## Credential Providers

### `grackle credential-provider list`

Show current provider configuration.

### `grackle credential-provider set <provider> <value>`

| Provider | Valid values |
|----------|------------|
| `claude` | `off`, `subscription`, `api_key` |
| `github` | `off`, `on` |
| `copilot` | `off`, `on` |
| `codex` | `off`, `on` |

## Configuration

### `grackle config get <key>`

Read a setting value.

### `grackle config set <key> <value>`

Set a setting value.

## Session Logs

### `grackle logs <session-id>`

| Flag | Description |
|------|-------------|
| `--transcript` | Show markdown transcript instead of raw events |
| `--tail` | Follow live events |

Session IDs support prefix matching.
