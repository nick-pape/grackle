/**
 * Reconciliation phase that keeps the derived KG mirror converged (#1258).
 *
 * The correctness backbone of the projection. Each tick (gated on Neo4j health
 * + an available embedder, bounded per pass):
 *   1. **Session sync** — project changed sessions (hash-gated) + their edges;
 *      prune sessions (and their transcript chunks) whose row vanished.
 *   2. **Transcript sync** — incrementally chunk new log content per session
 *      (via the per-session cursor).
 *   3. **Embed backfill** — embed a bounded batch of nodes that were upserted
 *      structurally with no embedding (keeps embeddings off the write path).
 *
 * Entity nodes (task/workspace/persona/environment) are projected low-latency by
 * the event subscriber; this phase guarantees eventual convergence for all.
 *
 * @module
 */

import type { ReconciliationPhase } from "@grackle-ai/plugin-sdk";
import { sessionStore, taskStore, workspaceStore, personaStore, envRegistry } from "@grackle-ai/database";
import {
  getReferenceNodeProps,
  listReferenceSourceIds,
  listNodesMissingEmbedding,
  updateNode,
  deleteReferenceNodeBySource,
  REFERENCE_SOURCE,
  type Embedder,
  type KnowledgeNode,
  type ReferenceSource,
  type UpsertReferenceNodeInput,
} from "@grackle-ai/knowledge";
import { logger } from "./logger.js";
import {
  sessionToNodeInput,
  environmentToNodeInput,
  personaToNodeInput,
  workspaceToNodeInput,
  taskToNodeInput,
} from "./projection/node-mappers.js";
import {
  projectSession,
  unprojectSession,
  linkSessionSpawn,
  projectEnvironment,
  projectPersona,
  projectWorkspace,
  projectTask,
} from "./projection/project-entity.js";
import {
  projectSessionTranscript,
  unprojectSessionTranscript,
} from "./projection/project-transcript.js";

/** Max nodes embedded per tick so CPU-bound embedding never starves the loop. */
const EMBED_BACKFILL_BATCH = 32;

/** Dependencies for the projection phase (injected for testability). */
export interface KnowledgeProjectionPhaseDeps {
  /** Returns the embedder, or undefined when knowledge is not initialized. */
  getEmbedder: () => Embedder | undefined;
  /** Returns whether Neo4j is currently reachable. */
  isHealthy: () => boolean;
}

/** Text to embed for a node: a reference node's content (chunk) or label, else a native node's content. */
function embedText(node: KnowledgeNode): string {
  if (node.kind === "reference") {
    return node.content ?? node.label;
  }
  return node.content;
}

/** Resolve a session's workspace scope via its task (empty when no task). */
function resolveSessionWorkspaceId(taskId: string): string {
  if (!taskId) {
    return "";
  }
  return taskStore.getTask(taskId)?.workspaceId ?? "";
}

async function syncSessions(embedder: Embedder): Promise<void> {
  const sessions = sessionStore.listSessions();
  const liveSessionIds = new Set<string>();

  for (const session of sessions) {
    liveSessionIds.add(session.id);
    const workspaceId = resolveSessionWorkspaceId(session.taskId);

    // Hash-gate: only re-project structure when the projection changed.
    const desired = sessionToNodeInput(session, workspaceId);
    const existing = await getReferenceNodeProps(REFERENCE_SOURCE.SESSION, session.id);
    if (existing?.projectionHash !== desired.extraProps?.projectionHash) {
      await projectSession(session, workspaceId);
    }

    // Incremental transcript chunking (cursor-based; cheap when no new content).
    await projectSessionTranscript(session, embedder);
  }

  // SPAWNED edges in a second pass — all session nodes now exist, so a child
  // projected before its parent still gets its edge (order-independent).
  for (const session of sessions) {
    await linkSessionSpawn(session);
  }

  // Prune sessions (and their chunks) whose row no longer exists.
  for (const sourceId of await listReferenceSourceIds(REFERENCE_SOURCE.SESSION)) {
    if (!liveSessionIds.has(sourceId)) {
      await unprojectSession(sourceId);
      await unprojectSessionTranscript(sourceId);
    }
  }
}

/**
 * Reconcile one reference-node entity type: hash-gated re-project of changed
 * rows + prune of nodes whose source row no longer exists. This is the
 * correctness backbone for entities — it converges the mirror even if the
 * low-latency event subscriber missed an event (e.g. while Neo4j was down).
 */
async function syncEntity<T>(
  sourceType: ReferenceSource,
  rows: T[],
  getId: (row: T) => string,
  toInput: (row: T) => UpsertReferenceNodeInput,
  project: (row: T) => Promise<void>,
): Promise<void> {
  const liveIds = new Set<string>();
  for (const row of rows) {
    const id = getId(row);
    liveIds.add(id);
    const existing = await getReferenceNodeProps(sourceType, id);
    if (existing?.projectionHash !== toInput(row).extraProps?.projectionHash) {
      await project(row);
    }
  }
  for (const sourceId of await listReferenceSourceIds(sourceType)) {
    if (!liveIds.has(sourceId)) {
      await deleteReferenceNodeBySource(sourceType, sourceId);
    }
  }
}

async function backfillEmbeddings(embedder: Embedder): Promise<void> {
  const pending = await listNodesMissingEmbedding(EMBED_BACKFILL_BATCH);
  for (const node of pending) {
    const text = embedText(node);
    if (!text) {
      continue;
    }
    try {
      const { vector } = await embedder.embed(text);
      await updateNode(node.id, { embedding: vector });
    } catch (err) {
      // Non-fatal: leave the node unembedded; it retries on the next tick.
      logger.debug({ err, nodeId: node.id }, "Embedding backfill failed; will retry");
    }
  }
}

/**
 * Create the `knowledge-projection` reconciliation phase.
 */
export function createKnowledgeProjectionPhase(
  deps: KnowledgeProjectionPhaseDeps,
): ReconciliationPhase {
  return {
    name: "knowledge-projection",
    execute: async (): Promise<void> => {
      const embedder = deps.getEmbedder();
      if (!embedder || !deps.isHealthy()) {
        return;
      }
      // Entity backbone (hash-gated): converges the mirror even if the
      // low-latency event subscriber missed events (e.g. while Neo4j was down).
      // Endpoints (env/persona/workspace) before tasks/sessions so edges resolve.
      await syncEntity(REFERENCE_SOURCE.ENVIRONMENT, envRegistry.listEnvironments(), (row) => row.id, environmentToNodeInput, projectEnvironment);
      await syncEntity(REFERENCE_SOURCE.PERSONA, personaStore.listPersonas(), (row) => row.id, personaToNodeInput, projectPersona);
      await syncEntity(REFERENCE_SOURCE.WORKSPACE, workspaceStore.listWorkspaces(), (row) => row.id, workspaceToNodeInput, projectWorkspace);
      await syncEntity(REFERENCE_SOURCE.TASK, taskStore.listTasks(), (row) => row.id, taskToNodeInput, projectTask);
      await syncSessions(embedder);
      await backfillEmbeddings(embedder);
    },
  };
}
