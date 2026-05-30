---
id: claude-drives-grackle
title: Let Claude Drive Grackle
sidebar_position: 6
---

# Let Claude Drive Grackle

Point an external agent — Claude Code, Copilot CLI, Codex CLI, any MCP client — at Grackle's MCP server, and it can drive Grackle itself: create tasks, spawn agents, search the knowledge graph, read logs. The orchestrator, one level up.

## The endpoint

`grackle serve` exposes an MCP server at **http://127.0.0.1:7435/mcp** by default. It speaks streamable HTTP.

```bash
grackle serve
```

Loopback by default — the MCP server binds wherever the Grackle server binds (`GRACKLE_HOST`, `127.0.0.1` out of the box). `grackle serve --allow-network` binds `0.0.0.0` and opens it to the LAN; to reach it from another machine, do that or front it with a reverse proxy you control. (The standalone `@grackle-ai/mcp` binary is stricter — it refuses any non-loopback bind.)

## Connect a client

An MCP client connects over HTTP. Most clients take a server entry like this:

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

The API key is the one Grackle generated on first run (`~/.grackle/api-key`). Clients that speak OAuth can skip the static token: Grackle advertises its authorization server at `/.well-known/oauth-protected-resource/mcp` and the client negotiates from there.

## What the agent can do

Once connected, Grackle's tools show up in the client namespaced `mcp__grackle__<tool>`. A few it will reach for:

| Tool                             | Does                                  |
| -------------------------------- | ------------------------------------- |
| `mcp__grackle__task_create`      | Create a task in a workspace          |
| `mcp__grackle__session_spawn`    | Spawn an agent against an environment |
| `mcp__grackle__knowledge_search` | Search the knowledge graph by concept |

So you can sit in Claude Code and say:

> Create a task to add rate limiting to the auth service, then spawn an agent on it.

and it does — through Grackle, on a real environment, with its own credentials and its own entry in the log.

## Next

- [MCP Server](../features/mcp-server) — the full tool catalog and connection detail.
- [Knowledge Graph](../features/knowledge-graph) — what the agents leave behind for the next one.
- [Web UI](../features/web-ui) — watch the work the driven agent kicks off.
