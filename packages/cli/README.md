# @grackle-ai/cli

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/cli"><img src="https://img.shields.io/npm/v/@grackle-ai/cli.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

Command-line interface for [Grackle](https://github.com/nick-pape/grackle) — run any AI coding agent on any remote environment. Manage environments, workspaces, tasks, agent sessions, personas, and more from your terminal.

## Install

```bash
npm install -g @grackle-ai/cli
```

Or run without installing:

```bash
npx @grackle-ai/cli serve
```

Requires **Node.js >= 22**.

> **pnpm users:** pnpm v8+ blocks native build scripts by default. If `grackle serve` crashes with a `Could not locate the bindings file` error, run `pnpm approve-builds` after installing, or add the following to your `package.json`:
>
> ```json
> { "pnpm": { "onlyBuiltDependencies": ["better-sqlite3"] } }
> ```

## Quick Start

```bash
# Start the Grackle server (gRPC + Web UI + MCP — all in one)
grackle serve

# Open the web dashboard at http://localhost:3000

# Add a Docker environment
grackle env add my-env --docker

# Spawn an agent session
grackle spawn my-env "Refactor the auth module to use JWT"

# Watch it work
grackle status
```

## Configuration

The CLI connects to a running Grackle server over gRPC. Connection is configured via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `GRACKLE_URL` | Server gRPC address | `http://127.0.0.1:7434` |
| `GRACKLE_API_KEY` | API key for authentication | Read from `${GRACKLE_HOME:-~}/.grackle/api-key` |
| `GRACKLE_HOME` | Override the Grackle home directory | `~` |

The API key is generated automatically when the server starts for the first time. If `GRACKLE_API_KEY` is not set, the CLI reads the key from `${GRACKLE_HOME:-~}/.grackle/api-key`.

## Command Reference

### Server

#### `grackle serve`

Start the Grackle server, web UI, MCP server, and local PowerLine.

```bash
grackle serve
grackle serve --port 8000 --web-port 4000
grackle serve --allow-network    # bind to 0.0.0.0 for LAN access
```

| Option | Description | Default |
|--------|-------------|---------|
| `--port <port>` | Server gRPC port | `7434` |
| `--web-port <port>` | Web UI port | `3000` |
| `--mcp-port <port>` | MCP server port | `7435` |
| `--powerline-port <port>` | Local PowerLine port | `7433` |
| `--allow-network` | Bind to all interfaces (0.0.0.0) | Off (127.0.0.1) |

---

### Environments

Manage the compute environments where agents run.

#### `grackle env list`

List all registered environments with their status and adapter type.

```bash
grackle env list
```

#### `grackle env add <name>`

Register a new environment. Choose an adapter type with one of the mutually exclusive flags.

```bash
# Docker (default)
grackle env add my-env --docker
grackle env add my-env --docker --image node:22 --repo https://github.com/org/repo
grackle env add my-env --docker --volume /host/path:/container/path --gpu

# SSH
grackle env add staging --ssh --host 10.0.1.50 --user deploy
grackle env add staging --ssh --host 10.0.1.50 --ssh-port 2222 --identity-file ~/.ssh/id_ed25519

# GitHub Codespace
grackle env add cs --codespace --codespace-name my-codespace-abc123

# Local (connect to an existing PowerLine instance)
grackle env add local --local --host 127.0.0.1 --port 7433
```

| Option | Description |
|--------|-------------|
| `--docker` | Docker adapter (default) |
| `--ssh` | SSH adapter |
| `--codespace` | GitHub Codespace adapter |
| `--local` | Local PowerLine adapter |
| `--repo <repo>` | GitHub repo to clone (Docker) |
| `--image <image>` | Docker image |
| `--volume <mounts...>` | Docker volume mounts (`host:container[:ro]`) |
| `--gpu [gpus]` | Enable GPU passthrough (default: all) |
| `--host <host>` | SSH host or local host |
| `--user <user>` | SSH user |
| `--ssh-port <port>` | SSH port (default: 22) |
| `--identity-file <path>` | SSH private key path |
| `--codespace-name <name>` | Codespace name (from `gh codespace list`) |
| `--port <port>` | PowerLine port (local adapter) |

#### `grackle env provision <id>`

Provision and connect an environment. Streams progress events.

| Option | Description |
|--------|-------------|
| `--force` | Force full reprovision, killing active sessions and tearing down the existing connection. Skips fast reconnect. |

```bash
grackle env provision my-env
# [10%] pulling: Pulling Docker image...
# [50%] starting: Starting container...
# [100%] connected: Environment ready

# Force reprovision a connected environment
grackle env provision my-env --force
```

#### `grackle env stop <id>`

Stop a running environment without destroying it.

#### `grackle env destroy <id>`

Destroy an environment (e.g., remove the Docker container).

#### `grackle env remove <id>`

Remove an environment from the registry entirely.

#### `grackle env wake <id>`

Wake a sleeping environment. Equivalent to re-provisioning.

---

### Agent Sessions

Spawn, monitor, and interact with AI agent sessions.

#### `grackle spawn <env-id> <prompt>`

Start a new agent session with the given prompt. Automatically attaches to the live event stream.

```bash
grackle spawn my-env "Add input validation to the signup form"
grackle spawn my-env "Fix the failing test" --max-turns 5
grackle spawn my-env "Review this PR" --persona code-reviewer
```

| Option | Description |
|--------|-------------|
| `--max-turns <n>` | Maximum conversation turns |
| `--persona <id>` | Persona to use (falls back to app default) |

#### `grackle status`

List active agent sessions. Shows ID, environment, runtime, status, token usage, cost, and prompt.

```bash
grackle status
grackle status --env my-env    # filter by environment
grackle status --all           # include stopped sessions
```

#### `grackle attach <session-id>`

Attach to a live session and stream events in real time. When the agent requests input, you'll be prompted interactively.

```bash
grackle attach abc12345
```

#### `grackle resume <session-id>`

Resume a stopped or suspended session.

#### `grackle kill <session-id>`

Stop a running session immediately.

#### `grackle send-input <session-id> <text>`

Send text input to a session that is waiting for user input.

```bash
grackle send-input abc12345 "Yes, proceed with the refactor"
```

---

### Workspaces

Group tasks and agents around a shared repository and environment.

#### `grackle workspace list`

List all workspaces.

```bash
grackle workspace list
grackle workspace list --env my-env    # filter by environment
```

#### `grackle workspace create <name>`

Create a new workspace attached to an environment.

```bash
grackle workspace create "Auth Rewrite" --env my-env --repo https://github.com/org/repo
grackle workspace create "Quick Fix" --env my-env --no-worktrees
```

| Option | Description |
|--------|-------------|
| `--env <env-id>` | Environment ID (required) |
| `--repo <url>` | Repository URL |
| `--desc <description>` | Workspace description |
| `--no-worktrees` | Disable git worktree isolation |
| `--working-directory <path>` | Working directory / repo root on the environment |

#### `grackle workspace get <id>`

Show full details for a workspace.

#### `grackle workspace update <id>`

Update workspace properties.

```bash
grackle workspace update ws-123 --name "Auth Rewrite v2" --desc "Updated scope"
grackle workspace update ws-123 --env other-env    # reparent to different environment
```

| Option | Description |
|--------|-------------|
| `--name <name>` | New name |
| `--desc <description>` | New description |
| `--repo <url>` | New repository URL |
| `--env <env-id>` | Reparent to a different environment |
| `--worktrees` / `--no-worktrees` | Toggle worktree isolation |
| `--working-directory <path>` | New working directory / repo root |

#### `grackle workspace archive <id>`

Archive a workspace.

---

### Tasks

Create, manage, and execute tasks within workspaces. Tasks support hierarchical parent/child trees, dependency gating, and agent assignment.

#### `grackle task list [workspace-id]`

List tasks, optionally scoped to a workspace.

```bash
grackle task list
grackle task list ws-123 --status working
grackle task list ws-123 --search "auth"
```

| Option | Description |
|--------|-------------|
| `--search <query>` | Filter by title/description substring |
| `--status <status>` | Filter by status: `not_started`, `working`, `paused`, `complete`, `failed` |

#### `grackle task create <title>`

Create a new task.

```bash
grackle task create "Implement JWT middleware" --workspace ws-123
grackle task create "Write tests" --workspace ws-123 --depends-on task-1,task-2
grackle task create "Fix edge case" --parent task-1    # create a subtask
grackle task create "Design API" --workspace ws-123 --can-decompose
```

| Option | Description |
|--------|-------------|
| `--workspace <id>` | Workspace to create the task in |
| `--desc <text>` | Task description |
| `--depends-on <ids>` | Comma-separated dependency task IDs |
| `--parent <task-id>` | Parent task ID (creates a subtask) |
| `--can-decompose` | Allow this task to create subtasks |

#### `grackle task show <task-id>`

Show full task details including status, branch, dependencies, and token usage.

#### `grackle task update <task-id>`

Update task properties.

| Option | Description |
|--------|-------------|
| `--title <text>` | New title |
| `--desc <text>` | New description |
| `--status <status>` | `not_started`, `working`, `paused`, `complete`, `failed` |
| `--depends-on <ids>` | New dependency list |
| `--session <session-id>` | Bind an existing session |
| `--persona <id>` | Default persona ID |

#### `grackle task start <task-id>`

Start a task by spawning an agent session for it.

```bash
grackle task start task-1
grackle task start task-1 --persona security-reviewer --env my-env
grackle task start task-1 --notes "Focus on error handling this time"
```

| Option | Description |
|--------|-------------|
| `--persona <id-or-name>` | Persona override |
| `--env <env-id>` | Environment to run on |
| `--notes <text>` | Feedback/instructions for retry |

#### `grackle task complete <task-id>`

Mark a task as complete.

#### `grackle task resume <task-id>`

Resume the latest stopped session for a task.

#### `grackle task delete <task-id>`

Delete a task.

---

### Personas

Create and manage agent personas — specialized profiles with custom system prompts, runtime preferences, and model configuration.

#### `grackle persona list`

List all personas.

#### `grackle persona create <name>`

Create a new persona.

```bash
# Agent persona with a system prompt
grackle persona create "Frontend Engineer" --prompt "You are a React specialist." --runtime claude-code

# Read the prompt from a file
grackle persona create "Security Reviewer" --prompt-file ./prompts/security.md --model opus

# Script persona (GenAIScript)
grackle persona create "Nightly Report" --type script --script-file ./scripts/report.genai.mjs --runtime genaiscript
```

| Option | Description |
|--------|-------------|
| `--type <type>` | `agent` (default) or `script` |
| `--prompt <text>` | System prompt text |
| `--prompt-file <path>` | Read system prompt from a file |
| `--script <code>` | Script source code (for script personas) |
| `--script-file <path>` | Read script from a file |
| `--desc <text>` | Description |
| `--runtime <runtime>` | `claude-code`, `copilot`, `codex`, `goose`, or `genaiscript` |
| `--model <model>` | Default model |
| `--max-turns <n>` | Maximum turns |
| `--mcp-tools <tools>` | Comma-separated list of allowed MCP tool names |
| `--mcp-tools-preset <preset>` | Use a preset: `default`, `worker`, `orchestrator`, `admin` |

#### `grackle persona show <id>`

Show full persona details including system prompt, script, and allowed MCP tools.

#### `grackle persona edit <id>`

Edit an existing persona. Accepts the same options as `create`.

#### `grackle persona delete <id>`

Delete a persona.

---

### Findings

Query and post findings — categorized discoveries shared across agents within a workspace.

#### `grackle finding list <workspace-id>`

List findings in a workspace.

```bash
grackle finding list ws-123
grackle finding list ws-123 --category architecture --tag security --limit 10
```

| Option | Description |
|--------|-------------|
| `--category <cat>` | Filter by category |
| `--tag <tag>` | Filter by tag |
| `--limit <n>` | Max results (default: 20) |

#### `grackle finding post <workspace-id> <title>`

Post a new finding.

```bash
grackle finding post ws-123 "Auth tokens expire silently" --category bug --content "The refresh token..." --tags auth,security
```

| Option | Description |
|--------|-------------|
| `--category <cat>` | Finding category (default: `general`) |
| `--content <text>` | Finding content |
| `--tags <tags>` | Comma-separated tags |

---

### Tokens

Manage authentication tokens that are forwarded to environments (API keys, access tokens, etc.).

#### `grackle token list`

List all configured tokens.

#### `grackle token set <name>`

Set a token value. The value can come from a file, an environment variable, or interactive input.

```bash
# Interactive prompt
grackle token set anthropic

# From environment variable
grackle token set anthropic --env ANTHROPIC_API_KEY

# From file
grackle token set anthropic --file ~/.secrets/anthropic.key

# Control how the token is delivered to the environment
grackle token set github --env GITHUB_TOKEN --type env_var --env-var GITHUB_TOKEN
grackle token set ssh-key --file ~/.ssh/id_rsa --type file --file-path /home/agent/.ssh/id_rsa
```

| Option | Description |
|--------|-------------|
| `--file <path>` | Read value from a file |
| `--env <var>` | Read value from an environment variable |
| `--type <type>` | Delivery type: `env_var` (default) or `file` |
| `--env-var <name>` | Environment variable name on the remote environment |
| `--file-path <path>` | File path to write on the remote environment |

#### `grackle token delete <name>`

Delete a token.

---

### Credential Providers

Configure automatic credential forwarding from your machine to environments.

#### `grackle credential-provider list`

Show current credential provider configuration.

```bash
grackle credential-provider list
# ┌──────────┬──────────────┐
# │ Provider │ Status       │
# ├──────────┼──────────────┤
# │ claude   │ subscription │
# │ github   │ on           │
# │ copilot  │ off          │
# │ codex    │ off          │
# │ goose    │ off          │
# └──────────┴──────────────┘
```

#### `grackle credential-provider set <provider> <value>`

Set a credential provider mode.

```bash
grackle credential-provider set claude subscription
grackle credential-provider set github on
grackle credential-provider set copilot off
```

| Provider | Valid values |
|----------|-------------|
| `claude` | `off`, `subscription`, `api_key` |
| `github` | `off`, `on` |
| `copilot` | `off`, `on` |
| `codex` | `off`, `on` |
| `goose` | `off`, `on` |

---

### Logs

View session event logs and transcripts.

#### `grackle logs <session-id>`

View the event log for a session. Supports short ID prefix matching.

```bash
grackle logs abc12345                # view JSONL event log
grackle logs abc12345 --transcript   # view markdown transcript
grackle logs abc12345 --tail         # stream live events
```

| Option | Description |
|--------|-------------|
| `--transcript` | Show the markdown transcript instead of raw events |
| `--tail` | Follow live events (like `tail -f`) |

---

### Streams

Inspect active IPC streams for debugging inter-session communication.

#### `grackle streams list`

List all active IPC streams with subscriber details and message buffer depth.

```bash
grackle streams list
# ┌──────────┬────────────────┬─────────────────────────┬──────────────┐
# │ ID       │ Name           │ Subscribers             │ Buffer Depth │
# ├──────────┼────────────────┼─────────────────────────┼──────────────┤
# │ a1b2c3d4 │ shared-bus     │ 2                       │ 5            │
# │          │   e5f6g7h8     │   fd=3 rw/async         │              │
# │          │   i9j0k1l2     │   fd=4 r/sync           │              │
# └──────────┴────────────────┴─────────────────────────┴──────────────┘
```

---

### Pairing

#### `grackle pair`

Generate a new pairing code for the web UI. Displays the code, a URL, and a QR code for mobile access. Codes expire after 5 minutes.

```bash
grackle pair
#   Pairing code: AB12CD
#   URL: http://localhost:3000/pair?code=AB12CD
#   [QR code]
```

---

### Settings

#### `grackle config get <key>`

Get an app-level setting value.

```bash
grackle config get default-persona
```

#### `grackle config set <key> <value>`

Set an app-level setting value.

```bash
grackle config set default-persona persona-abc123
```

## License

MIT
