/**
 * Knowledge plugin factory.
 *
 * Wires Neo4j, embeddings, gRPC handlers, entity sync, and MCP tools
 * into the Grackle plugin system.
 *
 * @module
 */

import type { GracklePlugin, PluginContext } from "@grackle-ai/plugin-sdk";
import { grackle } from "@grackle-ai/common";
import { logger } from "./logger.js";
import {
  initKnowledge,
  createEntitySyncSubscriber,
  neo4jHealthCheck,
} from "./knowledge-init.js";
import { createKnowledgeHealthPhase, markKnowledgeInitFailed } from "./knowledge-health.js";
import {
  searchKnowledge,
  getKnowledgeNode,
  expandKnowledgeNode,
  listRecentKnowledgeNodes,
  createKnowledgeNode,
} from "./knowledge-handlers.js";
import { knowledgeMcpTools } from "./mcp-tools.js";

/**
 * Create the knowledge plugin that contributes Neo4j-backed knowledge graph
 * capabilities to the Grackle server.
 *
 * - **gRPC handlers**: searchKnowledge, getKnowledgeNode, expandKnowledgeNode,
 *   listRecentKnowledgeNodes, createKnowledgeNode
 * - **Reconciliation phases**: knowledge-health (Neo4j connectivity check)
 * - **Event subscribers**: entity sync (task/finding → knowledge graph)
 * - **MCP tools**: knowledge_search, knowledge_get_node, knowledge_create_node
 *
 * Depends on the "core" plugin.
 *
 * @returns A GracklePlugin ready to pass to `loadPlugins()`.
 */
export function createKnowledgePlugin(): GracklePlugin {
  let cleanup: (() => Promise<void>) | undefined;

  return {
    name: "knowledge",
    dependencies: ["core"],

    initialize: async (ctx: PluginContext): Promise<void> => {
      try {
        cleanup = await initKnowledge(ctx);
      } catch (err: unknown) {
        // Knowledge init failure (e.g. Neo4j unreachable) is non-fatal.
        // Mark health as failed immediately so /readyz reflects accurate status.
        markKnowledgeInitFailed();
        logger.error({ err }, "Knowledge plugin initialization failed — running degraded");
      }
    },

    shutdown: async (): Promise<void> => {
      await cleanup?.();
      cleanup = undefined;
    },

    grpcHandlers: () => [{
      service: grackle.GrackleKnowledge,
      handlers: {
        searchKnowledge,
        getKnowledgeNode,
        expandKnowledgeNode,
        listRecentKnowledgeNodes,
        createKnowledgeNode,
      },
    }],

    reconciliationPhases: () => [
      createKnowledgeHealthPhase({ healthCheck: neo4jHealthCheck }),
    ],

    eventSubscribers: (ctx: PluginContext) => [createEntitySyncSubscriber(ctx)],

    mcpTools: () => knowledgeMcpTools,
  };
}
