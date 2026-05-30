---
id: knowledge-graph
title: Knowledge Graph
sidebar_position: 8
---

# Knowledge Graph

Grackle's knowledge graph gives agents a shared semantic memory backed by [Neo4j](https://neo4j.com/). Agents query it by concept — not keyword — and get back connected knowledge with context. As of epic #1256 the graph is a **derived projection** of Grackle's entities (agent-authored writes were removed in #1257); it exposes a read-only surface that is continuously populated by the derived-mirror projection (#1258) — tasks, sessions, workspaces, personas, environments, and session-transcript chunks are mirrored into the graph automatically.

![Knowledge graph — semantic search with interactive graph explorer](/img/knowledge-graph.png)

## Why a graph?

A flat list of notes works for small teams, but as agents accumulate knowledge, you need **relationships**. A graph lets you ask "what do we know about the auth module?" and get back the architectural decision that changed it, the bug that was found in it, the dependency that constrains it, and the task that implemented it — all connected.

## Setup

The knowledge plugin is **enabled by default** — it loads unless you explicitly set `GRACKLE_KNOWLEDGE_ENABLED=false`. All it needs to become useful is a running Neo4j instance to connect to.

### 1. Start Neo4j

```bash
# Docker (quickest)
docker run -d --name neo4j \
  -p 7687:7687 -p 7474:7474 \
  -e NEO4J_AUTH=neo4j/grackle-dev \
  neo4j:5
```

### 2. Configure Grackle

Point Grackle at your Neo4j instance before starting the server. The plugin is already enabled by default, so you only need the connection settings:

```bash
GRACKLE_NEO4J_URL=bolt://localhost:7687
GRACKLE_NEO4J_USER=neo4j
GRACKLE_NEO4J_PASSWORD=grackle-dev
GRACKLE_NEO4J_DATABASE=neo4j   # optional; defaults to "neo4j"
```

To turn the plugin off entirely, set `GRACKLE_KNOWLEDGE_ENABLED=false`.

### 3. Start the server

```bash
grackle serve
```

On startup, the knowledge plugin connects to Neo4j, creates schema constraints and indexes, and initializes the local embedding model. If Neo4j is unreachable, the plugin enters **degraded mode** — everything else works normally, but while Neo4j is down knowledge queries return empty results and the projection pauses. Once Neo4j recovers, the reconciliation phase reconverges the graph automatically.

## How it works

### Derived projection

The graph is a **derived projection** of Grackle's primary data, not a separate store. **Reference nodes** point to entities in Grackle's database — tasks, sessions, workspaces, personas, and environments — without duplicating content; their embedding is derived from the source entity. Session transcripts are mirrored incrementally as embedded chunks.

As of epic #1256 the graph is a purely derived mirror of these entities. Agent-authored ("native") writes were **removed in #1257**, so the graph exposes only a read surface — and the derived-mirror projection (#1258) keeps that surface populated:

- A **`knowledge-projection` reconciliation phase** runs on every reconciliation tick (gated on Neo4j health and an available embedder). It hash-gates a scan of all tasks, sessions, workspaces, personas, and environments — re-projecting changed rows and pruning vanished ones — then incrementally chunks new session-transcript content and backfills embeddings in bounded batches. This is the correctness backbone: it converges the mirror even after Neo4j was down.
- An **event-driven subscriber** projects entity mutations (task/workspace/persona/environment create/update/delete) low-latency as an optimization on top of the phase. Missed events are healed on the next reconciliation scan.

### Semantic search

Every node gets a vector embedding computed by a local embedding model. When you search, Grackle computes the query embedding and finds the closest nodes by cosine similarity. This means "authentication flow" matches nodes about "JWT token validation" and "OAuth2 PKCE" even if those exact words aren't used.

### Graph traversal

Once you find a relevant node, you can **expand** it to see connected nodes — what it relates to, what references it, what was created alongside it. This multi-hop traversal surfaces context that flat search would miss.

## Agent MCP tools

When the knowledge plugin is enabled, agents get two additional MCP tools. Both are **read-only** (non-mutating) — agent-authored writes were removed in #1257.

| Tool                 | Description                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `knowledge_search`   | Search the graph by natural language query. Returns nodes ranked by semantic similarity. |
| `knowledge_get_node` | Retrieve a specific node by ID, including its properties and relationships.              |

#### `knowledge_search` parameters

| Parameter     | Type    | Description                                                                                 |
| ------------- | ------- | ------------------------------------------------------------------------------------------- |
| `query`       | string  | Natural-language search query (required).                                                   |
| `limit`       | number  | Maximum number of results (default `10`, max `50`).                                         |
| `workspaceId` | string  | Restrict results to a specific workspace. Scoped callers are pinned to their own workspace. |
| `expand`      | boolean | If `true`, also return nodes connected to the search results (default `false`).             |
| `expandDepth` | number  | How many hops to traverse when expanding (default `1`, max `5`).                            |

`knowledge_get_node` takes the node `id` plus the same optional `expand` / `expandDepth` parameters.

### Example: agent workflow

An agent working on a task might:

1. **Search** for existing knowledge about the area it's working on
2. **Expand** a relevant node to understand the broader context
3. Use that context to inform its work

> **Note:** these tools are read-only — agent-authored knowledge writes were removed in #1257. The graph is populated automatically by the derived-mirror projection (#1258), so the tools return real results as soon as there are entities and transcripts to mirror. They only return empty results while Neo4j is down (degraded mode).

### Related prior work (automatic retrieval)

Agents don't have to call `knowledge_search` to benefit from the graph. When a task spawns a session, the knowledge plugin **pushes** relevant context into the agent's system prompt — the PUSH half of the retrieval loop (#1259).

At spawn time the plugin searches the graph with the task's title and description, expands one hop from the top hit, excludes the task's own node, scopes to the task's workspace, and renders a budgeted `## Related prior work` section. This runs only when the per-task `injectKnowledge` flag is on (default on), Neo4j is healthy, and something relevant is found above a conservative similarity floor. All knobs are tunable via `GRACKLE_KG_RELATED_*` environment variables.

## Web UI

The knowledge graph explorer is accessible from the sidebar. It shows:

- **Search bar** — Type a natural language query to find relevant nodes
- **Graph view** — Interactive force-directed visualization of nodes and their relationships (powered by D3-force)
- **Detail panel** — Click any node to see its full content, category, tags, and connections

## Health monitoring

The knowledge plugin contributes a `knowledge-health` reconciliation phase that periodically checks Neo4j connectivity. This status is exposed via the server's `/readyz` endpoint, but knowledge health is **non-blocking** — the server reports ready even if Neo4j is down.
