---
id: mcp-server
title: MCP Server
sidebar_position: 4
---

# MCP Server

Grackle's whole API, handed to an agent as tools. Point an MCP client at the server and it can drive the rest of Grackle: open tasks, spawn agents, search the knowledge graph, set budgets, read logs.

The server speaks MCP over HTTP at **http://127.0.0.1:7435/mcp** by default (port configurable via `--mcp-port` or `GRACKLE_MCP_PORT`). Tools are namespaced `mcp__grackle__<tool>`.

## Connecting

### From an agent running inside Grackle

Agents Grackle spawns get the `mcp__grackle__*` tools automatically — no configuration. The tools just appear in the agent's toolset.

### From an external client

External clients (Claude Desktop, Claude Code, and the like) connect over HTTP. Add Grackle as an MCP server:

```json
{
  "mcpServers": {
    "grackle": {
      "type": "http",
      "url": "http://127.0.0.1:7435/mcp",
      "headers": { "Authorization": "Bearer <your-api-key>" }
    }
  }
}
```

The API key lives at `~/.grackle/api-key` (or wherever `GRACKLE_HOME` points). Clients that speak OAuth can skip the static token — the server advertises its metadata at `/.well-known/oauth-protected-resource/mcp`.

## The tool catalog

Roughly 80 tools across 15 groups. Tool names are snake_case; an agent calls them prefixed `mcp__grackle__`.

### Environments

| Tool                         | Description                        | Parameters                      |
| ---------------------------- | ---------------------------------- | ------------------------------- |
| `env_list`                   | List all environments              | —                               |
| `env_add`                    | Add an environment                 | `name`, `adapter`, adapter opts |
| `env_provision`              | Provision / connect an environment | `environmentId`                 |
| `env_list_docker_containers` | List attachable Docker containers  | —                               |

### Sessions

| Tool                 | Description                        | Parameters                              |
| -------------------- | ---------------------------------- | --------------------------------------- |
| `session_spawn`      | Spawn an agent session             | `environmentId`, `prompt`, `personaId?` |
| `session_resume`     | Resume a stopped/suspended session | `sessionId`                             |
| `session_kill`       | Terminate a session                | `sessionId`, `graceful?`                |
| `session_send_input` | Send input to a waiting session    | `sessionId`, `text`                     |
| `session_list`       | List sessions                      | `environmentId?`, `taskId?`             |
| `session_events`     | Durable action log for a session   | `sessionId`, `fromSeq?`                 |

### Tasks

| Tool            | Description                        | Parameters                                        |
| --------------- | ---------------------------------- | ------------------------------------------------- |
| `task_create`   | Create a task                      | `title`, `workspaceId?`, `parentTaskId?`, budgets |
| `task_list`     | List tasks (status/parent filters) | `workspaceId?`, `status?`                         |
| `task_search`   | Relevance-ranked task search       | `query`, `workspaceId?`, `limit?`                 |
| `task_show`     | Full task details                  | `taskId`                                          |
| `task_update`   | Update task fields                 | `taskId`, fields                                  |
| `task_start`    | Start / spawn a task's agent       | `taskId`, `personaId?`                            |
| `task_complete` | Mark a task complete               | `taskId`                                          |
| `task_resume`   | Resume the latest session          | `taskId`                                          |
| `task_delete`   | Delete a task                      | `taskId`                                          |

### Workspaces

| Tool                           | Description              | Parameters                       |
| ------------------------------ | ------------------------ | -------------------------------- |
| `workspace_create`             | Create a workspace       | `name`, `environmentId`, budgets |
| `workspace_list`               | List workspaces          | `environmentId?`                 |
| `workspace_get`                | Workspace details        | `workspaceId`                    |
| `workspace_update`             | Update workspace fields  | `workspaceId`, fields            |
| `workspace_archive`            | Archive a workspace      | `workspaceId`                    |
| `workspace_link_environment`   | Link another environment | `workspaceId`, `environmentId`   |
| `workspace_unlink_environment` | Unlink an environment    | `workspaceId`, `environmentId`   |

### Personas

| Tool             | Description          | Parameters                                     |
| ---------------- | -------------------- | ---------------------------------------------- |
| `persona_list`   | List personas        | —                                              |
| `persona_create` | Create a persona     | `name`, `runtime`, `model`, `systemPrompt?`, … |
| `persona_show`   | Full persona details | `personaId`                                    |
| `persona_edit`   | Update a persona     | `personaId`, fields                            |
| `persona_delete` | Delete a persona     | `personaId`                                    |

### Knowledge

| Tool                 | Description                     | Parameters                                                   |
| -------------------- | ------------------------------- | ------------------------------------------------------------ |
| `knowledge_search`   | Semantic search over the graph  | `query`, `limit?`, `expand?`, `expandDepth?`, `workspaceId?` |
| `knowledge_get_node` | Fetch one node by ID with edges | `nodeId`, `expand?`, `expandDepth?`                          |

These come from the [knowledge graph plugin](./knowledge-graph), enabled by default. They vanish only if you disable the plugin (`grackle plugin disable knowledge`, or the `plugin_set_enabled` tool — then restart). `GRACKLE_KNOWLEDGE_ENABLED` only sets the initial state when the database is first seeded; on an existing install it does nothing.

### Workpad

| Tool            | Description                   | Parameters          |
| --------------- | ----------------------------- | ------------------- |
| `workpad_write` | Write/update the task workpad | `taskId`, `content` |
| `workpad_read`  | Read a task's workpad         | `taskId`            |

### Escalations

| Tool                     | Description                    | Parameters                       |
| ------------------------ | ------------------------------ | -------------------------------- |
| `escalate_to_human`      | Raise an escalation to a human | `taskId?`, `message`, `urgency?` |
| `escalation_list`        | List escalations               | `workspaceId?`, `status?`        |
| `escalation_acknowledge` | Acknowledge an escalation      | `escalationId`                   |

### Inter-agent IPC

How agents coordinate while they work — see [Coordination](./coordination) for the model.

| Tool                | Description                         | Parameters                                            |
| ------------------- | ----------------------------------- | ----------------------------------------------------- |
| `ipc_spawn`         | Spawn a child session with a pipe   | `prompt`, `pipe?`, `environmentId?`                   |
| `ipc_write`         | Write to a child/stream fd          | `fd`, `message`                                       |
| `ipc_close`         | Close an fd                         | `fd`                                                  |
| `ipc_list_fds`      | List open fds                       | —                                                     |
| `ipc_terminate`     | SIGTERM a child via fd              | `fd`                                                  |
| `ipc_list_streams`  | List active streams                 | —                                                     |
| `ipc_create_stream` | Create a named stream               | `name`, `selfEcho?`                                   |
| `ipc_attach`        | Grant another session onto a stream | `fd`, `targetSessionId`, `permission`, `deliveryMode` |
| `ipc_share_stream`  | Share a stream with the parent      | `fd?` or `streamName?`, `permission?`                 |

### Components & widgets

Agent-authored UI — see [Generative UX (Widgets)](./widgets).

| Tool                 | Description                          | Parameters                       |
| -------------------- | ------------------------------------ | -------------------------------- |
| `component_register` | Register a reusable component        | `name`, `source`, `propsSchema?` |
| `component_update`   | Update a registered component        | `name`, `source?`, …             |
| `component_list`     | List registered components           | `workspaceId?`                   |
| `component_search`   | Search components                    | `query`                          |
| `component_promote`  | Promote a component to a render tool | `name`                           |
| `component_render`   | Render a component to a widget       | `name`, `props?`                 |
| `component_show`     | Show a component's source/metadata   | `name`                           |
| `widget_show`        | Render an inline HTML/React widget   | `html?` or `component`, `props?` |

Promoting a component mints a dynamic `render_<name>` tool.

### Credentials & tokens

| Tool                       | Description               | Parameters                     |
| -------------------------- | ------------------------- | ------------------------------ |
| `credential_provider_list` | List credential providers | —                              |
| `credential_provider_set`  | Set a provider mode       | `provider`, `value`            |
| `token_list`               | List stored tokens        | —                              |
| `token_set`                | Set a token               | `name`, `value?`, `envVar?`, … |
| `token_delete`             | Delete a token            | `name`                         |

### Schedules

| Tool              | Description                              | Parameters                                                 |
| ----------------- | ---------------------------------------- | ---------------------------------------------------------- |
| `schedule_create` | Create a scheduled trigger               | `title`, `scheduleExpression`, `personaId`, `workspaceId?` |
| `schedule_list`   | List schedules                           | `workspaceId?`                                             |
| `schedule_show`   | Schedule details                         | `scheduleId`                                               |
| `schedule_update` | Update a schedule (incl. enable/disable) | `scheduleId`, fields                                       |
| `schedule_delete` | Delete a schedule                        | `scheduleId`                                               |

### Plugins

| Tool                 | Description                                | Parameters        |
| -------------------- | ------------------------------------------ | ----------------- |
| `plugin_list`        | List plugins and state                     | —                 |
| `plugin_set_enabled` | Enable/disable a plugin (restart to apply) | `name`, `enabled` |

### Diagnostics

| Tool                 | Description                    | Parameters     |
| -------------------- | ------------------------------ | -------------- |
| `usage_get`          | Token/cost usage by scope      | `scope`, `id`  |
| `logs_get`           | Session logs                   | `sessionId`, … |
| `get_version_status` | Server version / update status | —              |

### Configuration

| Tool                         | Description             | Parameters  |
| ---------------------------- | ----------------------- | ----------- |
| `config_get_default_persona` | Get the default persona | —           |
| `config_set_default_persona` | Set the default persona | `personaId` |

## Tool scoping per persona

By default an agent sees the whole catalog. A persona can narrow that with an allowed-tools list or a preset (`default`, `worker`, `orchestrator`, `admin`) — see [Personas & Runtimes](../building-blocks/personas-runtimes). The `worker` preset strips orchestration tools, so a leaf agent can't spawn its own children. [Architecture > MCP](../architecture/mcp) covers the broker model.

## Security

- Every tool call runs server-side, authenticated by the Bearer token or an OAuth session.
- Credential values never come back out through MCP — tokens are write-only. See [Credentials & Access](./credentials).
- Per-persona scoping limits which tools a given agent can reach.
- The server binds to `127.0.0.1` unless you pass `--allow-network`.

## See also

- [Let Claude Drive Grackle](../getting-started/claude-drives-grackle) — the quickstart.
- [Architecture > MCP](../architecture/mcp) — the broker model and per-agent scoping.
