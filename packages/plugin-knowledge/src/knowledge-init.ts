/**
 * Knowledge graph subsystem initialization and lifecycle management.
 *
 * Opens Neo4j, creates the local embedder, and initializes the schema so the
 * knowledge graph read surface (search / get / expand / list) can serve
 * queries. The graph is populated by the derived-mirror projection (epic
 * #1256), not by agent-authored writes. Opt-in by loading the plugin.
 *
 * @module
 */

import {
  openNeo4j,
  initSchema,
  closeNeo4j,
  healthCheck as neo4jHealthCheck,
  createLocalEmbedder,
  listRecentNodes,
  type Embedder,
} from "@grackle-ai/knowledge";
import type { PluginContext } from "@grackle-ai/plugin-sdk";
import { rebuild } from "./projection/rebuild.js";

/** Re-export Neo4j health check for use by the reconciliation health phase. */
export { neo4jHealthCheck };

/** Module-level embedder, available after initKnowledge() completes. */
let knowledgeEmbedder: Embedder | undefined;

/** Get the knowledge embedder. Returns undefined if knowledge is not initialized. */
export function getKnowledgeEmbedder(): Embedder | undefined {
  return knowledgeEmbedder;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Initialize the knowledge graph subsystem.
 *
 * Opens Neo4j, initializes the schema, and creates the local embedder used to
 * embed search queries. If any step after the Neo4j connection fails, cleans up
 * the connection before re-throwing.
 *
 * @returns A cleanup function that closes Neo4j.
 */
export async function initKnowledge(ctx: PluginContext): Promise<() => Promise<void>> {
  ctx.logger.info("Initializing knowledge graph subsystem");

  const embedder: Embedder = createLocalEmbedder();

  await openNeo4j();

  try {
    await initSchema(embedder.dimensions);

    knowledgeEmbedder = embedder;

    // Startup-if-empty: a fresh or wiped graph re-projects itself from SQL +
    // session logs (recovery = re-project, never replay). Runs in the background
    // so a large rebuild (CPU-bound embeddings) doesn't block plugin init.
    const recent = await listRecentNodes(1);
    if (recent.nodes.length === 0) {
      ctx.logger.info("Knowledge graph is empty — starting background rebuild from SQL + logs");
      void rebuild(embedder).catch((err: unknown) => {
        ctx.logger.error({ err }, "Knowledge graph rebuild failed");
      });
    }

    ctx.logger.info("Knowledge graph subsystem ready");

    return async (): Promise<void> => {
      ctx.logger.info("Shutting down knowledge graph subsystem");
      knowledgeEmbedder = undefined;
      await closeNeo4j();
      ctx.logger.info("Knowledge graph subsystem stopped");
    };
  } catch (err) {
    // Clean up Neo4j if a later step fails
    knowledgeEmbedder = undefined;
    await closeNeo4j().catch(() => {});
    throw err;
  }
}
