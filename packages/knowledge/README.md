# @grackle-ai/knowledge

Knowledge graph subsystem for [Grackle](https://github.com/nick-pape/grackle) — keeps AI agent context (tasks, findings, sessions, workspaces) synchronized into a Neo4j knowledge graph with vector embeddings for semantic search.

This package is the Grackle-specific integration layer on top of [`@grackle-ai/knowledge-core`](https://www.npmjs.com/package/@grackle-ai/knowledge-core). It re-exports the full core SDK (connection management, node/edge CRUD, ingestion pipeline, semantic search, graph traversal) and adds reference node synchronization — the glue that keeps the knowledge graph in sync with Grackle's relational database as entities are created, updated, and deleted.

## Install

```bash
npm install @grackle-ai/knowledge
```

Requires **Node.js >= 22** and a running [Neo4j](https://neo4j.com/) 5.x instance with vector index support. See the [`@grackle-ai/knowledge-core` README](https://www.npmjs.com/package/@grackle-ai/knowledge-core) for Neo4j setup instructions.

## How It Works

Grackle entities (tasks, findings, sessions, workspaces) live in SQLite. To make them semantically searchable and graph-connected, this package provides **reference node sync**: when an entity changes, a corresponding reference node in Neo4j is created or updated with a fresh embedding vector. This lets agents query the knowledge graph with natural language and discover related context across entity types.

The package also includes pure text-derivation helpers that produce consistent, embeddable text representations from entity data — ensuring that the same task or finding always generates the same embedding input format.

## Relationship to `@grackle-ai/knowledge-core`

| Package | Role |
|---------|------|
| `@grackle-ai/knowledge-core` | Domain-agnostic graph SDK — Neo4j client, embedders, chunkers, search, traversal. Standalone, no Grackle dependency. |
| `@grackle-ai/knowledge` | Grackle integration layer — re-exports the core SDK and adds entity-aware sync, lookup, and text derivation. |

If you are building on Grackle, use `@grackle-ai/knowledge` — it gives you the full core API plus Grackle-specific helpers in a single import. If you want a standalone knowledge graph library with no Grackle coupling, use `@grackle-ai/knowledge-core` directly.

## License

MIT
