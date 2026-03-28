# @grackle-ai/mcp

**MCP (Model Context Protocol) server for [Grackle](https://github.com/nick-pape/grackle)** — exposes Grackle's full capabilities as MCP tools so any AI agent can manage environments, spawn sessions, orchestrate tasks, and share knowledge.

This package translates MCP tool calls into [ConnectRPC](https://connectrpc.com/) requests to the Grackle server. It implements the [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) and supports multiple concurrent client sessions.

## Installation

```bash
npm install @grackle-ai/mcp
```

Or run the standalone server directly:

```bash
npx @grackle-ai/mcp
```

## Quick Start

The MCP server connects to an already-running Grackle server. Start the Grackle server first, then launch the MCP server:

```bash
# 1. Start the Grackle server (installs the CLI if needed)
npx @grackle-ai/cli serve

# 2. Start the MCP server (reads the API key automatically)
npx @grackle-ai/mcp
```

The MCP server listens on `http://127.0.0.1:7435/mcp` by default.

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `GRACKLE_MCP_PORT` | `7435` | Port the MCP server listens on |
| `GRACKLE_HOST` | `127.0.0.1` | Bind address (must be a loopback address) |
| `GRACKLE_URL` | `http://127.0.0.1:7434` | URL of the Grackle gRPC server to connect to |
| `GRACKLE_API_KEY` | *(auto-loaded)* | API key for authenticating with the gRPC server. If not set, reads from `~/.grackle/api-key` |
| `LOG_LEVEL` | `info` | Logging level (`debug`, `info`, `warn`, `error`) |

## Programmatic Usage

The package also exports `createMcpServer` for embedding the MCP server in your own application:

```ts
import { createMcpServer } from "@grackle-ai/mcp";

const server = createMcpServer({
  bindHost: "127.0.0.1",
  mcpPort: 7435,
  grpcPort: 7434,
  apiKey: "your-api-key",
});

server.listen(7435, "127.0.0.1", () => {
  console.log("MCP server ready");
});
```

## Authentication

The MCP server supports three authentication modes:

- **API key** — Full access. Pass as `Authorization: Bearer <api-key>`.
- **OAuth** — Full access. Token issued by the Grackle OAuth authorization server.
- **Scoped token** — Limited tool access. Issued to agents working on a specific task. Only a subset of tools is available (see [Scoped Access](#scoped-access) below).

## Client Configuration

### Claude Desktop / Claude Code

Add to your MCP configuration (`claude_desktop_config.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "grackle": {
      "url": "http://127.0.0.1:7435/mcp",
      "headers": {
        "Authorization": "Bearer <your-api-key>"
      }
    }
  }
}
```

### Any MCP-compatible client

Point your client at `http://127.0.0.1:7435/mcp` using the Streamable HTTP transport with a Bearer token in the `Authorization` header.

---

## Tool Reference

The MCP server exposes 50 tools organized into 13 groups. Each tool validates its inputs against a strict schema and returns structured JSON results.

### Environment Tools

Manage compute environments where agents run (Docker, SSH, Codespace, local).

| Tool | Description | Parameters |
|------|-------------|------------|
| `env_list` | List all registered environments with status, adapter type, and runtime. | *(none)* |
| `env_add` | Register a new environment. | `displayName` (string), `adapterType` (string), `adapterConfig?` (object) |
| `env_provision` | Provision an environment — start resources, install the agent, and connect. | `environmentId` (string), `force?` (boolean) |
| `env_stop` | Stop a running environment without destroying its resources. | `environmentId` (string) |
| `env_destroy` | Destroy an environment's backing resources (e.g., delete the container). | `environmentId` (string) |
| `env_remove` | Remove an environment registration. Must be stopped first. | `environmentId` (string) |
| `env_wake` | Wake a stopped environment by re-provisioning it. | `environmentId` (string) |

### Session Tools

Manage AI agent sessions — spawn, monitor, interact, and terminate.

| Tool | Description | Parameters |
|------|-------------|------------|
| `session_spawn` | Spawn a new agent session with a prompt and optional model config. | `environmentId` (string), `prompt` (string), `maxTurns?` (int), `personaId?` (string), `workingDirectory?` (string) |
| `session_resume` | Resume a stopped agent session. | `sessionId` (string) |
| `session_status` | List sessions with optional filtering by environment and status. | `environmentId?` (string), `all?` (boolean, default false) |
| `session_kill` | Terminate a running session. Hard kill by default; graceful=true sends SIGTERM. | `sessionId` (string), `graceful?` (boolean, default false) |
| `session_attach` | Stream events from a running session for a limited duration. | `sessionId` (string), `timeoutSeconds?` (int, default 30, max 300), `maxEvents?` (int) |
| `session_send_input` | Send a text message to a session waiting for user input. | `sessionId` (string), `text` (string) |

### Workspace Tools

Manage workspaces that group tasks, agents, and repositories.

| Tool | Description | Parameters |
|------|-------------|------------|
| `workspace_list` | List all workspaces with names, descriptions, repos, and status. | `environmentId?` (string) |
| `workspace_create` | Create a new workspace. | `name` (string), `environmentId` (string), `description?` (string), `repoUrl?` (string), `workingDirectory?` (string), `useWorktrees?` (boolean), `defaultPersonaId?` (string) |
| `workspace_get` | Get full details of a workspace by ID. | `workspaceId` (string) |
| `workspace_update` | Update a workspace's name, description, repo, or settings. | `workspaceId` (string), `name?`, `description?`, `repoUrl?`, `environmentId?`, `workingDirectory?`, `useWorktrees?`, `defaultPersonaId?` |
| `workspace_archive` | Archive a workspace, marking it as inactive. | `workspaceId` (string) |

### Task Tools

Create, manage, and run tasks within workspaces. Supports hierarchical task trees and dependency gating.

| Tool | Description | Parameters |
|------|-------------|------------|
| `task_list` | List tasks with optional search and status filters. | `workspaceId?` (string), `search?` (string), `status?` (string: `not_started`, `working`, `paused`, `complete`, `failed`) |
| `task_create` | Create a new task with dependencies and parent hierarchy. | `workspaceId?` (string), `title` (string), `description?` (string), `dependsOn?` (string[]), `parentTaskId?` (string), `canDecompose?` (boolean), `defaultPersonaId?` (string) |
| `task_show` | Get full details of a task. | `taskId` (string) |
| `task_update` | Update a task's title, description, status, or dependencies. | `taskId` (string), `title?`, `description?`, `status?` (enum), `dependsOn?` (string[]), `sessionId?` (string) |
| `task_start` | Start a task by spawning an agent session. Supports IPC pipe modes. | `taskId` (string), `personaId?` (string), `environmentId?` (string), `notes?` (string), `pipe?` (`sync` \| `async` \| `detach`) |
| `task_delete` | Permanently delete a task. | `taskId` (string) |
| `task_complete` | Mark a task as complete (sticky status). | `taskId` (string) |
| `task_resume` | Resume the latest session for a task. | `taskId` (string) |

### Finding Tools

Post and query categorized discoveries shared across agents.

| Tool | Description | Parameters |
|------|-------------|------------|
| `finding_list` | Query findings for a workspace with optional filters. | `workspaceId?` (string, auto-injected for scoped sessions; required for API key/OAuth), `category?` (string), `tag?` (string), `limit?` (int) |
| `finding_post` | Post a new finding with title, category, content, and tags. | `workspaceId?` (string, auto-injected for scoped sessions; required for API key/OAuth), `title` (string), `category?` (string), `content?` (string), `tags?` (string[]) |

### Persona Tools

Manage agent personas — reusable templates defining system prompt, runtime, and model.

| Tool | Description | Parameters |
|------|-------------|------------|
| `persona_list` | List all available personas. | *(none)* |
| `persona_create` | Create a new persona template (`agent` or `script` type). | `name` (string), `systemPrompt?` (string), `description?` (string), `runtime?` (string), `model?` (string), `maxTurns?` (int), `type?` (`agent` \| `script`), `script?` (string) |
| `persona_show` | Get full details of a persona. | `personaId` (string) |
| `persona_edit` | Update an existing persona. | `personaId` (string), `name?`, `systemPrompt?`, `description?`, `runtime?`, `model?`, `maxTurns?`, `type?`, `script?` |
| `persona_delete` | Delete a persona permanently. | `personaId` (string) |

### Knowledge Graph Tools

Search and build a semantic knowledge graph across sessions, findings, and task context.

| Tool | Description | Parameters |
|------|-------------|------------|
| `knowledge_search` | Semantic search over the knowledge graph using natural language. | `query` (string), `limit?` (int, max 50), `workspaceId?` (string), `expand?` (boolean), `expandDepth?` (int, max 5) |
| `knowledge_get_node` | Retrieve a specific node by ID with optional neighbor expansion. | `id` (string), `expand?` (boolean), `expandDepth?` (int, max 5) |
| `knowledge_create_node` | Create a new knowledge entry (decision, insight, concept, snippet). | `title` (string), `content` (string), `category?` (string), `tags?` (string[]), `workspaceId?` (string), `edges?` (array of `{toId, type}`) |

### IPC Tools

Inter-process communication between parent and child agent sessions.

| Tool | Description | Parameters |
|------|-------------|------------|
| `ipc_spawn` | Spawn a child agent session with an IPC pipe. | `prompt` (string), `pipe` (`sync` \| `async` \| `detach`), `environmentId` (string), `personaId?` (string), `maxTurns?` (int) |
| `ipc_write` | Write a message to a child session via a file descriptor. | `fd` (int), `message` (string) |
| `ipc_close` | Close a file descriptor, optionally stopping the child. | `fd` (int) |
| `ipc_terminate` | Send SIGTERM to a child session via its fd for graceful shutdown. | `fd` (int) |
| `ipc_list_fds` | List your open file descriptors (IPC connections). | *(none)* |
| `ipc_create_stream` | Create a named stream for inter-session communication. Returns an rw fd. | `name` (string) |
| `ipc_attach` | Grant another session access to a stream you hold an fd on. | `fd` (int), `targetSessionId` (string), `permission?` (`r` \| `w` \| `rw`), `deliveryMode?` (`sync` \| `async` \| `detach`) |

### Log Tools

Retrieve session logs — raw events, formatted transcripts, or live tails.

| Tool | Description | Parameters |
|------|-------------|------------|
| `logs_get` | Retrieve session logs in raw, transcript, or live-tail mode. | `sessionId` (string), `transcript?` (boolean), `tail?` (boolean), `timeoutSeconds?` (int, default 10, max 60), `maxEvents?` (int) |

### Token Tools

Manage secrets that are auto-forwarded to environments.

| Tool | Description | Parameters |
|------|-------------|------------|
| `token_list` | List configured tokens (values are never returned). | *(none)* |
| `token_set` | Set a token for auto-forwarding to environments. | `name` (string), `value` (string), `type?` (`env_var` \| `file`), `envVar?` (string), `filePath?` (string) |
| `token_delete` | Delete a configured token. | `name` (string) |

### Credential Provider Tools

Configure which credential providers (Claude, GitHub, Copilot, Codex) are auto-forwarded.

| Tool | Description | Parameters |
|------|-------------|------------|
| `credential_provider_list` | List current provider configuration. | *(none)* |
| `credential_provider_set` | Set a provider mode. | `provider` (`claude` \| `github` \| `copilot` \| `codex`), `value` (`off` \| `on` \| `subscription` \| `api_key`) |

### Config Tools

Read and write global configuration settings.

| Tool | Description | Parameters |
|------|-------------|------------|
| `config_get_default_persona` | Get the default persona for new sessions. | *(none)* |
| `config_set_default_persona` | Set the default persona for new sessions. | `personaId` (string) |

### Usage Tools

Query aggregated token usage and cost data.

| Tool | Description | Parameters |
|------|-------------|------------|
| `usage_get` | Get token usage and cost for a session, task, task tree, workspace, or environment. | `scope` (`session` \| `task` \| `task_tree` \| `workspace` \| `environment`), `id` (string) |

---

## Scoped Access

When an agent authenticates with a **scoped token** (issued automatically when a task session is started), tool access is controlled by the task's **persona configuration**.

### Persona-Scoped Tool Filtering

Each persona can define an `allowed_mcp_tools` list that restricts which MCP tools its agents can use. When a scoped token connects:

1. The server looks up the persona's `allowed_mcp_tools` from the token's `personaId` claim.
2. If the persona defines a non-empty tool list, only those tools are exposed via `tools/list`.
3. If the persona has no explicit tool list (empty `allowed_mcp_tools`), the **default scoped set** is used:
   - `finding_post`, `finding_list`
   - `task_create`, `task_list`, `task_show`, `task_start`, `task_complete`
   - `session_attach`, `session_send_input`
   - `persona_list`, `persona_show`
   - `ipc_spawn`, `ipc_write`, `ipc_close`, `ipc_terminate`, `ipc_list_fds`, `ipc_create_stream`, `ipc_attach`
   - `knowledge_search`, `knowledge_get_node`
   - `logs_get`
   - `workpad_write`, `workpad_read`
   - `schedule_list`, `schedule_show`

### Preset Tool Sets

Predefined presets are available for convenience (via CLI `--mcp-tools-preset` or the web UI):

| Preset | Description |
|--------|-------------|
| `default` | The 25-tool default scoped set (backward compatible) |
| `worker` | Subset of default — no task creation capabilities |
| `orchestrator` | Default + task management, session spawning, persona creation, scheduling |
| `admin` | Full access to all 60 tools |

Scoped tokens also enforce workspace isolation — agents can only see tasks and findings within their own workspace. Subtasks created by a scoped agent are automatically parented to the agent's own task. Tool calls to non-permitted tools return an error with a descriptive message listing the available tools.

## Requirements

- Node.js >= 22
- A running [Grackle](https://github.com/nick-pape/grackle) server (`@grackle-ai/cli`)

## License

MIT
