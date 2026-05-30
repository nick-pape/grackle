---
id: claude-drives-grackle
title: Let Claude Drive Grackle
sidebar_position: 6
---

# Let Claude Drive Grackle

Turn the tables. Point an outside agent — Claude Code, Copilot CLI, Codex CLI, any MCP client — at Grackle's MCP server, and the agent drives Grackle for you. It creates tasks, spawns claws, searches the knowledge graph. You ask in plain language; it pulls the levers.

## The endpoint

`grackle serve` starts the MCP server on port **7435**. One endpoint:

```
http://127.0.0.1:7435/mcp
```

Loopback only. The server refuses to bind anywhere but `127.0.0.1`.

## Connect a client

Most MCP clients take a small JSON block. Add Grackle as an HTTP MCP server with a Bearer token:

```json
{
  "mcpServers": {
    "grackle": {
      "type": "http",
      "url": "http://127.0.0.1:7435/mcp",
      "headers": {
        "Authorization": "Bearer <your-api-key>"
      }
    }
  }
}
```

The API key is the one `grackle serve` writes on first run. Set `GRACKLE_API_KEY` or read it from your Grackle home.

Clients that speak OAuth (Claude Desktop and the like) skip the token. The server advertises its metadata at `/.well-known/oauth-protected-resource/mcp` and runs the flow for you.

## What the agent can pull

Every tool is namespaced `mcp__grackle__<tool>`. The agent sees the full set — roughly 80 tools across environments, sessions, tasks, knowledge, and more. A few it reaches for first:

| Tool                             | Does                                     |
| -------------------------------- | ---------------------------------------- |
| `mcp__grackle__task_create`      | Open a task                              |
| `mcp__grackle__session_spawn`    | Spawn a claw against an environment      |
| `mcp__grackle__knowledge_search` | Semantic search over the knowledge graph |

Ask the agent in its own chat:

> "Use Grackle to create a task for fixing the flaky auth test, then spawn a session on the build-server environment to work it."

It calls `task_create`, then `session_spawn`, and reports back what it did.

## Next

- [MCP Server](../features/mcp-server) — every tool, parameters, and the broker architecture.
- [Knowledge Graph](../features/knowledge-graph) — what `knowledge_search` reaches into.
- [Features](../features/web-ui) — the rest of Grackle.
