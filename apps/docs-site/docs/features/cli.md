---
id: cli
title: CLI
sidebar_position: 3
---

# CLI

`@grackle-ai/cli` is how you drive Grackle from a terminal. Environments, sessions, tasks, credentials, schedules — every lever the server exposes, you pull from here. The web UI is the same machine with a face on it; this is the bare metal.

Install it with the rest of the stack — see [Installation](../getting-started/installation).

This page is a full reference. Every command group, every flag. The prose around the tables is thin on purpose; the tables are the contract.

## Connection

The CLI talks to the server over gRPC. Point it somewhere, hand it a key, tell it where home is.

| Setting        | Default                 | Environment Variable |
| -------------- | ----------------------- | -------------------- |
| Server URL     | `http://127.0.0.1:7434` | `GRACKLE_URL`        |
| API key        | `~/.grackle/api-key`    | `GRACKLE_API_KEY`    |
| Home directory | `~/.grackle`            | `GRACKLE_HOME`       |

## Server

### `grackle serve`

Start the server: gRPC, web UI, WebSocket, and MCP, all in one process.

| Flag                        | Default | Description                                                                                                                        |
| --------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--port <port>`             | 7434    | Server port                                                                                                                        |
| `--web-port <port>`         | 3000    | Web UI port                                                                                                                        |
| `--mcp-port <port>`         | 7435    | MCP server port                                                                                                                    |
| `--mcp-origin <origin>`     | —       | Browser-facing MCP origin (e.g. `https://mcp.example.com`) for reverse-proxy/TLS deployments; trusted asset/CSP origin for widgets |
| `--sandbox-port <port>`     | 7436    | MCP Apps widget sandbox port                                                                                                       |
| `--sandbox-origin <origin>` | —       | Browser-facing MCP Apps sandbox origin (e.g. `https://sandbox.example.com`) for reverse-proxy/TLS deployments                      |
| `--powerline-port <port>`   | 7433    | Local PowerLine port                                                                                                               |
| `--allow-network`           | off     | Bind to all interfaces (0.0.0.0) for LAN access                                                                                    |

By default the server binds to `127.0.0.1` — it answers only to the machine it runs on. `--allow-network` opens it to the LAN. Know what you're doing before you do.

### `grackle pair`

Generate a pairing code for web UI authentication. Prints the code, a URL, and a QR code. Codes expire after 5 minutes.

## Environments

An environment is a place an agent can run — a wire it runs on. Add one, provision it, and it's ready to take work.

### `grackle env list`

List all environments with ID, type, status, and bootstrap state.

### `grackle env add <name>`

Add an environment. Defaults to the Docker adapter when no adapter flag is given.

| Flag                       | Description                                                                     |
| -------------------------- | ------------------------------------------------------------------------------- |
| `--codespace`              | Codespace adapter                                                               |
| `--docker`                 | Docker adapter                                                                  |
| `--ssh`                    | SSH adapter                                                                     |
| `--local`                  | Local PowerLine adapter                                                         |
| `--repo <repo>`            | GitHub repo to clone (docker)                                                   |
| `--image <image>`          | Docker image                                                                    |
| `--attach <container>`     | Attach to an existing container by name/ID instead of creating one (docker)     |
| `--host <host>`            | SSH host / local host                                                           |
| `--port <port>`            | PowerLine port (local adapter)                                                  |
| `--user <user>`            | SSH user                                                                        |
| `--volume <volumes...>`    | Docker volume mounts (format: `host:container[:ro]`, repeatable)                |
| `--gpu [gpus]`             | Enable GPU passthrough (default: `all`)                                         |
| `--ssh-port <sshPort>`     | SSH port (default: 22)                                                          |
| `--identity-file <path>`   | SSH identity file (private key)                                                 |
| `--codespace-name <name>`  | Codespace name (from `gh codespace list`)                                       |
| `--github-account <label>` | GitHub account label to use for `gh` CLI operations (codespace/docker adapters) |

`--ssh` requires `--host`; `--codespace` requires `--codespace-name`.

### `grackle env provision <id>`

Provision and connect an environment. Streams progress.

| Flag      | Description                                     |
| --------- | ----------------------------------------------- |
| `--force` | Force full reprovision, killing active sessions |

### `grackle env wake <id>`

Wake a sleeping environment (same provisioning flow as `provision`).

### `grackle env stop <id>`

Stop an environment.

### `grackle env destroy <id>`

Destroy an environment.

### `grackle env remove <id>`

Remove an environment from the registry.

## Sessions

An agent runs as a **session**. Spawn one, watch it work, kill it when it strays. Detaching doesn't stop it — the agent stays on the wire; you just stop looking.

### `grackle spawn <env-id> <prompt>`

Start a new agent session and stream its output (`Ctrl+C` to detach).

| Flag               | Description                                                                   |
| ------------------ | ----------------------------------------------------------------------------- |
| `--max-turns <n>`  | Maximum turns                                                                 |
| `--persona <id>`   | Persona to use (falls back to app default)                                    |
| `--workspace <id>` | Workspace to associate with this session (enables workspace-scoped MCP tools) |

### `grackle attach <session-id>`

Attach to a live session. Interactive — prompts for input when the session is waiting. `Ctrl+C` to detach.

### `grackle resume <session-id>`

Resume a paused session.

### `grackle send-input <session-id> <text>`

Send input to a waiting session.

### `grackle kill <session-id>`

Stop a running session.

| Flag             | Description                                             |
| ---------------- | ------------------------------------------------------- |
| `-g, --graceful` | Send SIGTERM for graceful shutdown instead of hard kill |

### `grackle status`

List agent sessions.

| Flag         | Description                         |
| ------------ | ----------------------------------- |
| `--env <id>` | Filter by environment               |
| `--all`      | Show all sessions including stopped |

### `grackle session events <session-id>`

Show a session's durable, server-sequenced action log (oldest first / replay order).

| Flag           | Description                                        |
| -------------- | -------------------------------------------------- |
| `--from <seq>` | Only actions after this seq (resume from a cursor) |
| `--limit <n>`  | Max actions to return (default: 500)               |

For the deeper model of sessions and the work they carry, see [Tasks & Sessions](../building-blocks/tasks-sessions).

## Workspaces

A workspace is the context an agent works inside — a repo, a budget, an environment to run on. Bind sessions to one and they share that ground.

### `grackle workspace list`

List all active workspaces.

| Flag         | Description              |
| ------------ | ------------------------ |
| `--env <id>` | Filter by environment ID |

### `grackle workspace create <name>`

| Flag                           | Description                                                           |
| ------------------------------ | --------------------------------------------------------------------- |
| `--env <id>`                   | Environment ID (**required**, auto-linked as the initial environment) |
| `--repo <url>`                 | Repository URL                                                        |
| `--desc <text>`                | Description                                                           |
| `--no-worktrees`               | Disable worktree isolation                                            |
| `--working-directory <path>`   | Working directory / repo root on the environment                      |
| `--token-budget <n>`           | Aggregate token cap across all tasks; 0 = unlimited                   |
| `--cost-budget-millicents <n>` | Aggregate cost cap in millicents ($0.00001 units); 0 = unlimited      |

### `grackle workspace get <id>`

Show full workspace details.

### `grackle workspace update <id>`

Update a workspace. All flags optional; only provided fields change.

| Flag                           | Description                                                      |
| ------------------------------ | ---------------------------------------------------------------- |
| `--name <name>`                | Workspace name                                                   |
| `--desc <text>`                | Workspace description                                            |
| `--repo <url>`                 | Repository URL                                                   |
| `--worktrees`                  | Enable worktree isolation (default)                              |
| `--no-worktrees`               | Disable worktree isolation (agents share the main checkout)      |
| `--working-directory <path>`   | Working directory / repo root on the environment                 |
| `--token-budget <n>`           | Aggregate token cap across all tasks; 0 = unlimited              |
| `--cost-budget-millicents <n>` | Aggregate cost cap in millicents ($0.00001 units); 0 = unlimited |

### `grackle workspace archive <id>`

Archive a workspace.

### `grackle workspace link-env <workspace-id>`

Link an additional environment to a workspace.

| Flag         | Description                           |
| ------------ | ------------------------------------- |
| `--env <id>` | Environment ID to link (**required**) |

### `grackle workspace unlink-env <workspace-id>`

Remove a linked environment from a workspace.

| Flag         | Description                             |
| ------------ | --------------------------------------- |
| `--env <id>` | Environment ID to unlink (**required**) |

Budgets here cap the whole workspace. For the per-task math, see [Usage budgets](./usage-budgets).

## Tasks

Tasks are the work itself — a tree of it. A task can depend on others, decompose into children, and bind to the session that runs it.

### `grackle task list [workspace-id]`

List tasks (optionally scoped to a workspace).

| Flag                | Description                                                                 |
| ------------------- | --------------------------------------------------------------------------- |
| `--search <query>`  | Filter tasks by title/description substring                                 |
| `--status <status>` | Filter by status (`not_started`, `working`, `paused`, `complete`, `failed`) |

### `grackle task search <query>`

Fuzzy search for tasks by title or description, ranked by relevance.

| Flag                | Description                                                                 |
| ------------------- | --------------------------------------------------------------------------- |
| `--workspace <id>`  | Scope to a specific workspace (optional)                                    |
| `--limit <n>`       | Maximum results to return (default: 10)                                     |
| `--status <status>` | Filter by status (`not_started`, `working`, `paused`, `complete`, `failed`) |

### `grackle task create <title>`

| Flag                           | Description                                                        |
| ------------------------------ | ------------------------------------------------------------------ |
| `--workspace <id>`             | Workspace to create the task in (optional)                         |
| `--desc <text>`                | Task description                                                   |
| `--depends-on <ids>`           | Comma-separated dependency task IDs                                |
| `--can-decompose`              | Allow this task to create subtasks                                 |
| `--no-inject-knowledge`        | Disable knowledge-graph context injection at spawn (on by default) |
| `--parent <task-id>`           | Parent task ID (creates a subtask)                                 |
| `--token-budget <n>`           | Total token cap (input + output); 0 = unlimited                    |
| `--cost-budget-millicents <n>` | Cost cap in millicents ($0.00001 units); 0 = unlimited             |

### `grackle task show <task-id>`

Display full task details.

### `grackle task update <task-id>`

| Flag                           | Description                                                            |
| ------------------------------ | ---------------------------------------------------------------------- |
| `--title <text>`               | New title                                                              |
| `--desc <text>`                | New description                                                        |
| `--status <status>`            | Task status (`not_started`, `working`, `paused`, `complete`, `failed`) |
| `--depends-on <ids>`           | Comma-separated dependency task IDs                                    |
| `--session <id>`               | Bind an existing session to this task                                  |
| `--persona <id>`               | Default persona ID for this task                                       |
| `--inject-knowledge`           | Enable knowledge-graph context injection at spawn                      |
| `--no-inject-knowledge`        | Disable knowledge-graph context injection at spawn                     |
| `--token-budget <n>`           | Total token cap (input + output); 0 = unlimited                        |
| `--cost-budget-millicents <n>` | Cost cap in millicents ($0.00001 units); 0 = unlimited                 |

### `grackle task start <task-id>`

Start a task by spawning an agent session.

| Flag             | Description                 |
| ---------------- | --------------------------- |
| `--persona <id>` | Persona override            |
| `--env <id>`     | Environment override        |
| `--notes <text>` | Feedback for retry attempts |

### `grackle task complete <task-id>`

Mark a task as complete.

### `grackle task resume <task-id>`

Resume the latest session for a task.

### `grackle task delete <task-id>`

Delete a task (kills active sessions first).

## Personas

A persona is an agent's name and disposition — the system prompt, the runtime, the model, the tools it's allowed to touch. Spawn against one and the agent wears it.

### `grackle persona list`

List all personas.

### `grackle persona create <name>`

| Flag                          | Description                                                                 |
| ----------------------------- | --------------------------------------------------------------------------- |
| `--type <type>`               | Persona type: `agent` or `script` (default: `agent`)                        |
| `--prompt <text>`             | System prompt text                                                          |
| `--prompt-file <path>`        | Read system prompt from file                                                |
| `--script <code>`             | Script source code (for script personas)                                    |
| `--script-file <path>`        | Read script from file (for script personas)                                 |
| `--desc <text>`               | Description                                                                 |
| `--runtime <runtime>`         | Default runtime (`claude-code`, `copilot`, `codex`, `goose`, `genaiscript`) |
| `--model <model>`             | Default model                                                               |
| `--max-turns <n>`             | Maximum turns                                                               |
| `--mcp-tools <tools>`         | Comma-separated list of allowed MCP tool names                              |
| `--mcp-tools-preset <preset>` | Use a preset: `default`, `worker`, `orchestrator`, `admin`                  |

Agent personas require a system prompt (`--prompt` or `--prompt-file`); script personas require a script (`--script` or `--script-file`). `--mcp-tools` and `--mcp-tools-preset` are mutually exclusive.

### `grackle persona show <id>`

Display full persona details including system prompt.

### `grackle persona edit <id>`

Update a persona. All flags optional; only provided fields change.

| Flag                          | Description                                                |
| ----------------------------- | ---------------------------------------------------------- |
| `--name <name>`               | New name                                                   |
| `--type <type>`               | New type (`agent` or `script`)                             |
| `--prompt <text>`             | New system prompt                                          |
| `--prompt-file <path>`        | Read system prompt from file                               |
| `--script <code>`             | New script source code                                     |
| `--script-file <path>`        | Read script from file                                      |
| `--desc <text>`               | New description                                            |
| `--runtime <runtime>`         | New runtime                                                |
| `--model <model>`             | New model                                                  |
| `--max-turns <n>`             | New max turns                                              |
| `--mcp-tools <tools>`         | Comma-separated list of allowed MCP tool names             |
| `--mcp-tools-preset <preset>` | Use a preset: `default`, `worker`, `orchestrator`, `admin` |

### `grackle persona delete <id>`

Delete a persona.

## Runtimes

### `grackle runtimes`

List available agent runtimes, their models, and credential needs. Prints a table of provider, name, models, and the credentials each runtime requires.

## Tokens

A token is a secret an agent carries onto the wire — an env var or a file on PowerLine. The CLI sets it; the value never comes back out.

### `grackle token set <name>`

| Flag                 | Description                                       |
| -------------------- | ------------------------------------------------- |
| `--file <path>`      | Read value from file                              |
| `--env <var>`        | Read value from environment variable              |
| `--type <type>`      | Token type: `env_var` or `file`                   |
| `--env-var <name>`   | Env var name on PowerLine (default: `NAME_TOKEN`) |
| `--file-path <path>` | File path on PowerLine                            |

If no source flag is given, prompts for the value interactively.

### `grackle token list`

List tokens (values are never displayed).

### `grackle token delete <name>`

Delete a token.

## Credential Providers

Every agent gets its own name and its own key. These commands decide which providers are live and how they hand over credentials.

### `grackle credential-provider list`

Show current provider configuration.

### `grackle credential-provider set <provider> <value>`

| Provider  | Valid values                     |
| --------- | -------------------------------- |
| `claude`  | `off`, `subscription`, `api_key` |
| `github`  | `off`, `on`                      |
| `copilot` | `off`, `on`                      |
| `codex`   | `off`, `on`                      |
| `goose`   | `off`, `on`                      |

The full model — who holds what, and how it reaches the wire — is in [Credentials](./credentials).

## Configuration

### `grackle config get <key>`

Read a setting value.

### `grackle config set <key> <value>`

Set a setting value.

## Session Logs

### `grackle logs <session-id>`

| Flag           | Description                                    |
| -------------- | ---------------------------------------------- |
| `--transcript` | Show markdown transcript instead of raw events |
| `--tail`       | Follow live events                             |

Session IDs support prefix matching.

## Schedules

A schedule fires an agent on a clock — an interval or a cron expression — so work happens whether or not you're watching.

### `grackle schedule list`

List all schedules.

| Flag               | Description            |
| ------------------ | ---------------------- |
| `--workspace <id>` | Filter by workspace ID |

### `grackle schedule create <title>`

Create a scheduled trigger.

| Flag                      | Description                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `--schedule <expression>` | Interval (e.g. `30s`, `5m`) or cron expression (e.g. `0 9 * * MON`) (**required**) |
| `--persona <id>`          | Persona ID to use when firing (**required**)                                       |
| `--desc <text>`           | Description                                                                        |
| `--workspace <id>`        | Workspace scope                                                                    |
| `--parent-task <id>`      | Parent task for spawned children                                                   |

### `grackle schedule show <id>`

Show schedule details.

### `grackle schedule enable <id>`

Enable a schedule.

### `grackle schedule disable <id>`

Disable a schedule.

### `grackle schedule delete <id>`

Delete a schedule (running tasks are not affected).

For what fires and when, see [Scheduled tasks](../advanced/scheduled-tasks).

## Notifications

When an agent hits something it can't decide, it escalates. These commands send, list, and acknowledge those escalations — and wire up a webhook so a human gets pinged.

### `grackle notify send <title>`

Send an escalation notification to the human.

| Flag                | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `--workspace <id>`  | Workspace ID                                         |
| `--task <id>`       | Task ID                                              |
| `--message <text>`  | Detailed message                                     |
| `--urgency <level>` | Urgency: `low`, `normal`, `high` (default: `normal`) |

### `grackle notify list`

List recent escalations.

| Flag                | Description                                              |
| ------------------- | -------------------------------------------------------- |
| `--workspace <id>`  | Filter by workspace ID                                   |
| `--status <status>` | Filter by status: `pending`, `delivered`, `acknowledged` |
| `--limit <n>`       | Max results (default: 20)                                |

### `grackle notify ack <id>`

Acknowledge an escalation.

### `grackle notify set-webhook <url>`

Configure a webhook URL for outbound notifications.

### `grackle notify clear-webhook`

Remove the configured webhook URL.

### `grackle notify status`

Show notification configuration (webhook URL and pending escalation count).

## GitHub Accounts

One human, many identities. These commands register the GitHub accounts an agent can act as, so the right name signs the right commit.

### `grackle github-account list`

List all registered GitHub accounts.

### `grackle github-account add <label>`

Register a GitHub account with a personal access token.

| Flag                    | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `--token <token>`       | GitHub personal access token (PAT) (**required**)   |
| `--username <username>` | GitHub username (resolved automatically if omitted) |
| `--default`             | Set as the default account                          |

### `grackle github-account remove <label-or-id>`

Remove a registered GitHub account.

### `grackle github-account set-default <label-or-id>`

Set a GitHub account as the default.

### `grackle github-account import`

Import accounts from the local `gh` CLI authentication state.

## Plugins

Whole feature sets — orchestration, the knowledge graph — are plugins. Toggle them here. The change lands after a restart, not before.

### `grackle plugin list`

List all plugins and their current state (name, description, enabled, loaded, required).

### `grackle plugin enable <name>`

Enable a plugin. Enabling **requires a server restart to take effect.**

### `grackle plugin disable <name>`

Disable a plugin. Disabling **requires a server restart to take effect.**

## Channels

A channel is a narrow seam to the outside — a capability-scoped webhook that can drop messages into one session and nothing more. Mint it, use it, revoke it.

### `grackle channel expose`

Mint a capability webhook URL that injects user messages into a session.

| Flag              | Description                                    |
| ----------------- | ---------------------------------------------- |
| `--session <id>`  | Session ID to expose (**required**)            |
| `--verb <verb>`   | Permitted verb (default: `send_input`)         |
| `--ttl <seconds>` | Token lifetime in seconds (0 = server default) |
| `--label <text>`  | Label for audit and revocation                 |

### `grackle channel ls`

List channel grants.

### `grackle channel revoke <grant-id>`

Revoke a channel grant (its webhook URL stops working immediately).

## Event & Stream Inspection

The forensics layer. Every domain event is persisted; every live stream is inspectable. When one does something stupid at 3 AM, this is where you find out which.

### `grackle events`

Query the persisted domain-event log (most recent first).

| Flag            | Description                                        |
| --------------- | -------------------------------------------------- |
| `--type <type>` | Filter by exact event type (e.g. `task.created`)   |
| `--since <iso>` | Only events at/after this ISO 8601 timestamp       |
| `--until <iso>` | Only events at/before this ISO 8601 timestamp      |
| `--before <id>` | Only events older than this id (page into history) |
| `--limit <n>`   | Max rows to return (default: 100)                  |

### `grackle streams list`

List active IPC streams with subscriber details.

| Flag         | Description                                         |
| ------------ | --------------------------------------------------- |
| `--internal` | Include internal IPC streams (lifecycle/pipe/stdin) |

### `grackle streams transcript <streamId>`

Show a stream room's durable transcript (most recent first).

| Flag             | Description                                           |
| ---------------- | ----------------------------------------------------- |
| `--before <seq>` | Only messages older than this seq (page into history) |
| `--limit <n>`    | Max messages to return (default: 100)                 |

---

The same machine wears a face in the browser — see [Web UI](./web-ui). To let an agent drive Grackle itself, point it at the [MCP server](./mcp-server).
