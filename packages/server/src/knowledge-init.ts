/**
 * Knowledge graph subsystem initialization and lifecycle management.
 *
 * Wires Neo4j, the local embedder, and event-driven reference node sync
 * into the Grackle server. Opt-in via `GRACKLE_KNOWLEDGE_ENABLED=true`.
 *
 * @module
 */

import {
  openNeo4j,
  initSchema,
  closeNeo4j,
  createLocalEmbedder,
  syncReferenceNode,
  deleteReferenceNodeBySource,
  deriveTaskText,
  deriveFindingText,
  type Embedder,
} from "@grackle-ai/knowledge";
import { setKnowledgeEmbedder } from "@grackle-ai/mcp";
import { subscribe, type GrackleEvent } from "./event-bus.js";
import * as taskStore from "./task-store.js";
import * as findingStore from "./finding-store.js";
import { safeParseJsonArray } from "./json-helpers.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Whether the knowledge graph subsystem is enabled. */
export function isKnowledgeEnabled(): boolean {
  return process.env.GRACKLE_KNOWLEDGE_ENABLED === "true";
}

/** Module-level embedder, available after initKnowledge() completes. */
let knowledgeEmbedder: Embedder | undefined;

/** Get the knowledge embedder. Returns undefined if knowledge is not initialized. */
export function getKnowledgeEmbedder(): Embedder | undefined {
  return knowledgeEmbedder;
}

// ---------------------------------------------------------------------------
// Event handler
// ---------------------------------------------------------------------------

/**
 * Create an event bus subscriber that syncs reference nodes.
 *
 * Sync is fire-and-forget — errors are logged but never propagated.
 */
function createEntitySyncHandler(embedder: Embedder): (event: GrackleEvent) => void {
  return (event: GrackleEvent): void => {
    // Fire-and-forget async — errors handled inside handleEvent
    handleEvent(embedder, event).catch(() => {});
  };
}

/** Handle a single entity event. */
async function handleEvent(embedder: Embedder, event: GrackleEvent): Promise<void> {
  try {
    const payload: Record<string, unknown> = event.payload;

    switch (event.type) {
      case "task.created":
      case "task.updated": {
        const taskId: unknown = payload.taskId;
        if (typeof taskId !== "string" || !taskId) {
          return;
        }
        const task = taskStore.getTask(taskId);
        if (!task) {
          logger.warn({ taskId }, "Knowledge sync: task not found, skipping");
          return;
        }
        await syncReferenceNode(embedder, {
          sourceType: "task",
          sourceId: taskId,
          label: task.title,
          text: deriveTaskText(task.title, task.description),
          workspaceId: task.workspaceId ?? "",
        });
        break;
      }

      case "task.deleted": {
        const taskId: unknown = payload.taskId;
        if (typeof taskId !== "string" || !taskId) {
          return;
        }
        await deleteReferenceNodeBySource("task", taskId);
        break;
      }

      case "finding.posted": {
        const findingId: unknown = payload.findingId;
        if (typeof findingId !== "string" || !findingId) {
          return;
        }
        const workspaceId: string =
          typeof payload.workspaceId === "string" ? payload.workspaceId : "";
        const findings = findingStore.queryFindings(workspaceId);
        const finding = findings.find((f) => f.id === findingId);
        if (!finding) {
          logger.warn({ findingId }, "Knowledge sync: finding not found, skipping");
          return;
        }
        const tags: string[] = safeParseJsonArray(
          typeof finding.tags === "string" ? finding.tags : null,
        );
        await syncReferenceNode(embedder, {
          sourceType: "finding",
          sourceId: findingId,
          label: finding.title,
          text: deriveFindingText(finding.title, finding.content, tags),
          workspaceId,
        });
        break;
      }

      default:
        // Ignore events we don't handle
        break;
    }
  } catch (err) {
    logger.error(
      { err, eventType: event.type, eventId: event.id },
      "Knowledge sync failed for entity event",
    );
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Initialize the knowledge graph subsystem.
 *
 * Opens Neo4j, initializes the schema, creates the local embedder,
 * injects it into MCP tools, and subscribes to the event bus for
 * automatic reference node sync.
 *
 * If any step after Neo4j connection fails, cleans up the connection
 * before re-throwing.
 *
 * @returns A cleanup function that closes Neo4j and unsubscribes from events.
 */
export async function initKnowledge(): Promise<() => Promise<void>> {
  logger.info("Initializing knowledge graph subsystem");

  await openNeo4j();

  try {
    await initSchema();

    const embedder: Embedder = createLocalEmbedder();
    knowledgeEmbedder = embedder;
    setKnowledgeEmbedder(embedder);

    const unsubscribe: () => void = subscribe(createEntitySyncHandler(embedder));

    logger.info("Knowledge graph subsystem ready");

    return async (): Promise<void> => {
      logger.info("Shutting down knowledge graph subsystem");
      unsubscribe();
      knowledgeEmbedder = undefined;
      setKnowledgeEmbedder(undefined);
      await closeNeo4j();
      logger.info("Knowledge graph subsystem stopped");
    };
  } catch (err) {
    // Clean up Neo4j if a later step fails
    knowledgeEmbedder = undefined;
    setKnowledgeEmbedder(undefined);
    await closeNeo4j().catch(() => {});
    throw err;
  }
}
