---
id: mcp
title: MCP
sidebar_position: 3
---

# MCP

The Model Context Protocol is a wire format for handing an agent tools, resources, and prompts. It is a standard. Anthropic published it; everyone implements it. There is nothing proprietary here.

Grackle composes it. MCP is commodity — the orchestration wrapped around it is the point. Grackle speaks both halves of the protocol at once: it **serves** tools, and it **brokers** them.

## Grackle as server

Grackle exposes its own API as MCP tools. Create a task, spawn a session, search the knowledge graph, page a human — all of it, addressable by any MCP client. Point Claude Desktop or Claude Code at the endpoint and it drives Grackle without ever touching the CLI.

The full catalog lives in [MCP Server](../features/mcp-server). It is long. We do not repeat it here.

For the walkthrough — Claude on one end, Grackle on the other — see [Claude drives Grackle](../getting-started/claude-drives-grackle).

## Grackle as broker

The other half is harder, and it is the half that matters.

When Grackle spawns an agent, that agent needs tools. Grackle assembles them and hands them over the wire as a single MCP surface:

- **Grackle's own tools**, scoped down — not the full catalog, the subset this agent is allowed to call.
- **External MCP servers** configured for the agent's persona — a GitHub server, a database server, whatever the persona declares. Grackle merges them into the spawn request alongside its own.

The agent sees one tool list. It does not know or care which tools came from Grackle and which from a third-party server three networks away. That seam is the broker's job.

## Per-agent scoping

An agent does not get an API key. It gets a **session token** — its own identity, its own scope.

What that token can call is decided by the agent's persona:

- A **persona allowlist** filters Grackle's tools. A reviewer agent might see only read-only tools. A worker agent cannot spawn children. An orchestrator agent can.
- Presets — `worker`, `orchestrator`, `admin` — are named starting points. A persona overrides them as needed.
- With no override, the agent gets the default scoped set: enough to do work and report back, nothing more.
- `workspaceId` is injected. The agent cannot reach across workspaces. It cannot see what it was not given.

An agent that does something stupid at 3 AM can only do it with the tools you handed it.

## The seam

This is where external agents plug in. An MCP client connects and Grackle is just a server. A spawned agent connects and Grackle is its broker. Same protocol, two postures.

Related surfaces:

- [ACP](./acp) — the protocol an agent speaks back to its runtime.
- [MCP Apps](./mcp-apps) — agents rendering UI through the same broker.
- [Personas and runtimes](../building-blocks/personas-runtimes) — where allowlists and external servers are declared.

A first-party MCP gateway — one front door for every external server, brokered once — is on the [Roadmap](../roadmap). Today the broker merges servers per agent, at spawn.
