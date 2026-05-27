/**
 * Reconciliation phase that keeps the derived KG mirror converged (#1258).
 *
 * The correctness backbone of the projection. Each tick (gated on Neo4j health
 * + an available embedder):
 *   1. **Entity sync** — re-project changed task/workspace/persona/environment
 *      rows (hash-gated; unchanged rows are skipped) + bulk-prune vanished ones.
 *   2. **Session sync** — the same for sessions, plus incremental transcript
 *      chunking (the per-session byte cursor reads at most one bounded window of
 *      new log content per pass).
 *   3. **Embed backfill** — embed a bounded batch (`EMBED_BACKFILL_BATCH`) of
 *      nodes upserted structurally with no embedding (keeps embedding off the
 *      write path).
 *
 * Entity nodes are also projected low-latency by the event subscriber; this
 * phase guarantees eventual convergence for all (e.g. events missed while Neo4j
 * was down).
 *
 * Bounding: the expensive work is bounded per tick — transcript reads are
 * byte-capped and embedding is batch-limited. Entity/session reconciliation does
 * a hash-gated scan of all rows each tick (cheap reads; only changed rows write),
 * which is acceptable for current entity volumes.
 *
 * @module
 */

import type { ReconciliationPhase } from "@grackle-ai/plugin-sdk";
import {
  sessionStore,
  taskStore,
  workspaceStore,
  personaStore,
  envRegistry,
  workspaceEnvironmentLinkStore,
} from "@grackle-ai/database";
import {
  getReferenceNodeProps,
  listReferenceSourceIds,
  listNodesMissingEmbedding,
  updateNode,
  pruneReferenceNodesNotIn,
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
  linkSessionSpawn,
  projectEnvironment,
  projectPersona,
  projectWorkspace,
  projectTask,
  reconcileTaskEdges,
  reconcileWorkspaceEdges,
  reconcileSessionEdges,
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

    // Hash-gate the node write, but always reconcile edges: on change re-project
    // (clears stale + re-applies); when unchanged, re-apply additively so an edge
    // dropped on an earlier pass (endpoint missing, transient failure) still heals.
    const desired = sessionToNodeInput(session, workspaceId);
    const existing = await getReferenceNodeProps(REFERENCE_SOURCE.SESSION, session.id);
    if (existing?.projectionHash !== desired.extraProps?.projectionHash) {
      await projectSession(session, workspaceId);
    } else {
      await reconcileSessionEdges(session);
    }

    // Incremental transcript chunking (cursor-based; cheap when no new content).
    await projectSessionTranscript(session, embedder);
  }

  // SPAWNED edges in a second pass — all session nodes now exist, so a child
  // projected before its parent still gets its edge (order-independent).
  for (const session of sessions) {
    await linkSessionSpawn(session);
  }

  // Prune sessions whose row no longer exists, plus their transcript chunks.
  const existingSessionIds = await listReferenceSourceIds(REFERENCE_SOURCE.SESSION);
  const vanished = existingSessionIds.filter((id) => !liveSessionIds.has(id));
  if (vanished.length > 0) {
    await pruneReferenceNodesNotIn(REFERENCE_SOURCE.SESSION, [...liveSessionIds]);
    for (const sessionId of vanished) {
      await unprojectSessionTranscript(sessionId);
    }
  }
}

/**
 * Reconcile one reference-node entity type: hash-gated re-project of changed
 * rows + prune of nodes whose source row no longer exists. This is the
 * correctness backbone for entities — it converges the mirror even if the
 * low-latency event subscriber missed an event (e.g. while Neo4j was down).
 *
 * @param reconcileEdges - When a row's hash is unchanged (node already current),
 *   this re-applies its outgoing edges additively (no node write, no stale-clear),
 *   so an edge dropped on an earlier pass still heals. Omit for edgeless entities.
 */
async function syncEntity<T>(
  sourceType: ReferenceSource,
  rows: T[],
  getId: (row: T) => string,
  toInput: (row: T) => UpsertReferenceNodeInput,
  project: (row: T) => Promise<void>,
  reconcileEdges?: (row: T) => Promise<void>,
): Promise<void> {
  const liveIds = new Set<string>();
  for (const row of rows) {
    const id = getId(row);
    liveIds.add(id);
    const existing = await getReferenceNodeProps(sourceType, id);
    if (existing?.projectionHash !== toInput(row).extraProps?.projectionHash) {
      await project(row);
    } else if (reconcileEdges) {
      await reconcileEdges(row);
    }
  }
  await pruneReferenceNodesNotIn(sourceType, [...liveIds]);
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
      // Endpointless entities first (env/persona), then workspaces, then tasks/
      // sessions — so an edge's endpoint node already exists when it is applied.
      // The `reconcileEdges` arg re-applies edges additively for unchanged rows
      // each tick, so a transiently-dropped edge eventually heals.
      await syncEntity(
        REFERENCE_SOURCE.ENVIRONMENT,
        envRegistry.listEnvironments(),
        (row) => row.id,
        environmentToNodeInput,
        projectEnvironment,
      );
      await syncEntity(
        REFERENCE_SOURCE.PERSONA,
        personaStore.listPersonas(),
        (row) => row.id,
        personaToNodeInput,
        projectPersona,
      );
      // Workspace hash folds in the linked-env set so a link/unlink re-projects
      // (keeps LINKED_TO converged even if the change's event was missed).
      await syncEntity(
        REFERENCE_SOURCE.WORKSPACE,
        workspaceStore.listWorkspaces(),
        (row) => row.id,
        (row) =>
          workspaceToNodeInput(row, workspaceEnvironmentLinkStore.getLinkedEnvironmentIds(row.id)),
        projectWorkspace,
        reconcileWorkspaceEdges,
      );
      await syncEntity(
        REFERENCE_SOURCE.TASK,
        taskStore.listTasks(),
        (row) => row.id,
        taskToNodeInput,
        projectTask,
        reconcileTaskEdges,
      );
      await syncSessions(embedder);
      await backfillEmbeddings(embedder);
    },
  };
}
