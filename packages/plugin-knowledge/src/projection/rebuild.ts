/**
 * Full re-projection of the knowledge graph from SQL + session logs (#1258).
 *
 * This is the deterministic backbone of the derived mirror: recovery is
 * re-projection, never replay. Running it is idempotent — it MERGE-upserts every
 * node + edge and prunes mirror nodes whose source row no longer exists, so the
 * graph converges to a faithful projection regardless of prior state.
 *
 * @module
 */

import {
  taskStore,
  sessionStore,
  workspaceStore,
  personaStore,
  envRegistry,
} from "@grackle-ai/database";
import {
  REFERENCE_SOURCE,
  listReferenceSourceIds,
  deleteReferenceNodeBySource,
  pruneReferenceNodesNotIn,
  type ReferenceSource,
  type Embedder,
  logger,
} from "@grackle-ai/knowledge";
import {
  projectEnvironment,
  projectPersona,
  projectWorkspace,
  projectTask,
  projectSession,
  linkSessionSpawn,
} from "./project-entity.js";
import { projectSessionTranscript } from "./project-transcript.js";

/** Summary of a rebuild pass. */
export interface RebuildResult {
  workspaces: number;
  environments: number;
  personas: number;
  tasks: number;
  sessions: number;
  chunks: number;
  pruned: number;
}

/**
 * Re-project the entire knowledge graph from SQL + session logs.
 *
 * @param embedder - Used to embed transcript chunks (entity-node embeddings are
 *   backfilled off the write path by the reconciliation phase).
 */
export async function rebuild(embedder: Embedder): Promise<RebuildResult> {
  const environments = envRegistry.listEnvironments();
  const personas = personaStore.listPersonas();
  const workspaces = workspaceStore.listWorkspaces();
  const tasks = taskStore.listTasks();
  const sessions = sessionStore.listSessions();

  // Project nodes + structural edges. Order ensures edge endpoints exist when
  // each entity's edges are reconciled (env/persona/workspace before task/session).
  for (const environment of environments) {
    await projectEnvironment(environment);
  }
  for (const persona of personas) {
    await projectPersona(persona);
  }
  for (const workspace of workspaces) {
    await projectWorkspace(workspace);
  }
  for (const task of tasks) {
    await projectTask(task);
  }
  const workspaceByTask = new Map(tasks.map((task) => [task.id, task.workspaceId ?? ""]));
  for (const session of sessions) {
    const workspaceId = session.taskId ? workspaceByTask.get(session.taskId) ?? "" : "";
    await projectSession(session, workspaceId);
  }
  // SPAWNED edges in a second pass, once all session nodes exist (order-independent).
  for (const session of sessions) {
    await linkSessionSpawn(session);
  }

  // Transcript chunks (sessions now exist as edge endpoints).
  let chunks = 0;
  for (const session of sessions) {
    chunks += await projectSessionTranscript(session, embedder);
  }

  // Prune mirror nodes whose source entity no longer exists.
  let pruned = await pruneOrphans({
    [REFERENCE_SOURCE.ENVIRONMENT]: environments.map((environment) => environment.id),
    [REFERENCE_SOURCE.PERSONA]: personas.map((persona) => persona.id),
    [REFERENCE_SOURCE.WORKSPACE]: workspaces.map((workspace) => workspace.id),
    [REFERENCE_SOURCE.TASK]: tasks.map((task) => task.id),
    [REFERENCE_SOURCE.SESSION]: sessions.map((session) => session.id),
  });
  pruned += await pruneChunks(new Set(sessions.map((session) => session.id)));

  const result: RebuildResult = {
    workspaces: workspaces.length,
    environments: environments.length,
    personas: personas.length,
    tasks: tasks.length,
    sessions: sessions.length,
    chunks,
    pruned,
  };
  logger.info(result, "Knowledge graph rebuild complete");
  return result;
}

/** Delete reference nodes whose `sourceId` is not in the live set, per source type. */
async function pruneOrphans(liveBySource: Record<string, string[]>): Promise<number> {
  let pruned = 0;
  for (const [sourceType, liveIds] of Object.entries(liveBySource)) {
    pruned += await pruneReferenceNodesNotIn(sourceType as ReferenceSource, liveIds);
  }
  return pruned;
}

/** Delete transcript-chunk nodes whose owning session no longer exists. */
async function pruneChunks(liveSessions: Set<string>): Promise<number> {
  let pruned = 0;
  const chunkSourceIds = await listReferenceSourceIds(REFERENCE_SOURCE.TRANSCRIPT_CHUNK);
  for (const chunkSourceId of chunkSourceIds) {
    const sessionId = chunkSourceId.split("#")[0];
    if (!liveSessions.has(sessionId)) {
      const deleted = await deleteReferenceNodeBySource(REFERENCE_SOURCE.TRANSCRIPT_CHUNK, chunkSourceId);
      if (deleted) {
        pruned += 1;
      }
    }
  }
  return pruned;
}
