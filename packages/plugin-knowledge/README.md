# @grackle-ai/plugin-knowledge

Knowledge graph plugin for Grackle. Provides Neo4j-backed semantic search, knowledge node management, and entity sync via the `GracklePlugin` interface.

## Overview

Loading this plugin opts the server into knowledge graph functionality. When enabled (`GRACKLE_KNOWLEDGE_ENABLED=true`), the plugin:

- Connects to Neo4j and initializes the schema
- Creates a local embedding model for semantic search
- Registers gRPC handlers for knowledge operations
- Syncs task and finding entities to the knowledge graph
- Exposes `knowledge_search`, `knowledge_get_node`, and `knowledge_create_node` MCP tools
- Monitors Neo4j health via a reconciliation phase

## Usage

```ts
import { createKnowledgePlugin } from "@grackle-ai/plugin-knowledge";

const plugins = [createCorePlugin()];
if (config.knowledgeEnabled) {
  plugins.push(createKnowledgePlugin());
}
const loaded = await loadPlugins(plugins, ctx);
```

## gRPC Handlers

- `searchKnowledge` — Semantic similarity search
- `getKnowledgeNode` — Retrieve a node by ID
- `expandKnowledgeNode` — Expand a node's neighbors
- `listRecentKnowledgeNodes` — List recently created nodes
- `createKnowledgeNode` — Create a native node with embedding

## MCP Tools

- `knowledge_search` — Natural language search
- `knowledge_get_node` — Retrieve a node by ID
- `knowledge_create_node` — Create a knowledge entry
