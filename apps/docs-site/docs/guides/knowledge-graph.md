---
id: knowledge-graph
title: Knowledge Graph
sidebar_position: 8
---

# Knowledge Graph

Grackle's knowledge graph gives agents a shared semantic memory backed by [Neo4j](https://neo4j.com/). Agents query it by concept — not keyword — and get back connected knowledge with context. As of epic #1256 the graph is a **derived projection** of Grackle's entities (agent-authored writes were removed in #1257); it exposes a read-only surface and stays unpopulated until the derived-mirror projection lands (#1258).

![Knowledge graph — semantic search with interactive graph explorer](/img/knowledge-graph.png)

## Why a graph?

A flat list of notes works for small teams, but as agents accumulate knowledge, you need **relationships**. A graph lets you ask "what do we know about the auth module?" and get back the architectural decision that changed it, the bug that was found in it, the dependency that constrains it, and the task that implemented it — all connected.

## Setup

The knowledge graph requires a running Neo4j instance and an opt-in environment variable.

### 1. Start Neo4j

```bash
# Docker (quickest)
docker run -d --name neo4j \
  -p 7687:7687 -p 7474:7474 \
  -e NEO4J_AUTH=neo4j/grackle-dev \
  neo4j:5
```

### 2. Configure Grackle

Set these environment variables before starting the server:

```bash
GRACKLE_KNOWLEDGE_ENABLED=true
GRACKLE_NEO4J_URL=bolt://localhost:7687
GRACKLE_NEO4J_USER=neo4j
GRACKLE_NEO4J_PASSWORD=grackle-dev
```

### 3. Start the server

```bash
grackle serve
```

On startup, the knowledge plugin connects to Neo4j, creates schema constraints and indexes, and initializes the local embedding model. If Neo4j is unreachable, the plugin enters degraded mode — everything else works normally, but knowledge queries return empty results.

## How it works

### Derived projection

The graph is a **derived projection** of Grackle's primary data, not a separate store. **Reference nodes** point to entities in Grackle's database — tasks and sessions — without duplicating content; their embedding is derived from the source entity.

As of epic #1256 the graph is being reworked into a purely derived mirror of these entities. Agent-authored ("native") writes were **removed in #1257**, so the graph exposes only a read surface — and stays **unpopulated until the derived-mirror projection lands** (#1258).

### Semantic search

Every node gets a vector embedding computed by a local embedding model. When you search, Grackle computes the query embedding and finds the closest nodes by cosine similarity. This means "authentication flow" matches nodes about "JWT token validation" and "OAuth2 PKCE" even if those exact words aren't used.

### Graph traversal

Once you find a relevant node, you can **expand** it to see connected nodes — what it relates to, what references it, what was created alongside it. This multi-hop traversal surfaces context that flat search would miss.

## Agent MCP tools

When the knowledge plugin is enabled, agents get two additional MCP tools (read-only):

| Tool                 | Description                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `knowledge_search`   | Search the graph by natural language query. Returns nodes ranked by semantic similarity. |
| `knowledge_get_node` | Retrieve a specific node by ID, including its properties and relationships.              |

### Example: agent workflow

An agent working on a task might:

1. **Search** for existing knowledge about the area it's working on
2. **Expand** a relevant node to understand the broader context
3. Use that context to inform its work

> **Note:** agent-authored knowledge writes were removed in #1257. Until the derived-mirror projection (#1258) populates the graph from Grackle's entities and session transcripts, these read tools return empty results.

## Web UI

The knowledge graph explorer is accessible from the sidebar. It shows:

- **Search bar** — Type a natural language query to find relevant nodes
- **Graph view** — Interactive visualization of nodes and their relationships (powered by D3)
- **Detail panel** — Click any node to see its full content, category, tags, and connections

## Health monitoring

The knowledge plugin contributes a `knowledge-health` reconciliation phase that periodically checks Neo4j connectivity. This status is exposed via the server's `/readyz` endpoint, but knowledge health is **non-blocking** — the server reports ready even if Neo4j is down.
