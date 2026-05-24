/**
 * Project a single Grackle entity into the knowledge graph (#1258): upsert its
 * reference node and reconcile its structural edges. Used by both the
 * incremental event subscriber and the full rebuild.
 *
 * @module
 */

import {
  upsertReferenceNode,
  upsertEdge,
  removeOutgoingEdges,
  findReferenceNodeBySource,
  getReferenceNodeProps,
  updateNode,
  deleteReferenceNodeBySource,
  REFERENCE_SOURCE,
  type UpsertReferenceNodeInput,
  type EdgeType,
} from "@grackle-ai/knowledge";
import { workspaceEnvironmentLinkStore } from "@grackle-ai/database";
import type {
  TaskRow,
  WorkspaceRow,
  SessionRow,
  PersonaRow,
  EnvironmentRow,
} from "@grackle-ai/database";
import {
  taskToNodeInput,
  workspaceToNodeInput,
  sessionToNodeInput,
  personaToNodeInput,
  environmentToNodeInput,
} from "./node-mappers.js";
import {
  taskEdges,
  taskRelationEdges,
  sessionEdges,
  sessionSpawnEdge,
  workspaceLinkEdge,
  TASK_EDGE_TYPES,
  SESSION_EDGE_TYPES,
  WORKSPACE_EDGE_TYPES,
  type EdgeSpec,
} from "./edge-mappers.js";

/**
 * Resolve both endpoints of an edge spec and upsert the edge. Returns `false`
 * (a no-op) if either endpoint node is not projected yet — the next tick or a
 * rebuild will close the gap once both nodes exist.
 */
async function applyEdge(spec: EdgeSpec): Promise<boolean> {
  const [from, to] = await Promise.all([
    findReferenceNodeBySource(spec.from.sourceType, spec.from.sourceId),
    findReferenceNodeBySource(spec.to.sourceType, spec.to.sourceId),
  ]);
  if (!from || !to) {
    return false;
  }
  await upsertEdge(from.id, to.id, spec.type);
  return true;
}

/**
 * Upsert an entity reference node and, when its projected text changed, clear the
 * stale embedding so the off-write-path backfill recomputes it.
 *
 * `upsertReferenceNode` sets the embedding only on create, so a re-projection
 * (e.g. a changed task title, persona prompt/model, or workspace scope) would
 * otherwise keep the old vector and leave semantic search stale. We detect the
 * change via the `projectionHash` (compared to the stored one) and reset the
 * embedding to `[]`; new nodes already start empty. Centralized here so every
 * caller (event subscriber, reconciliation scan, rebuild) stays consistent.
 *
 * @returns The (stable) node ID.
 */
async function upsertEntityNode(input: UpsertReferenceNodeInput): Promise<string> {
  const newHash = input.extraProps?.projectionHash;
  const existing = await getReferenceNodeProps(input.sourceType, input.sourceId);
  const nodeId = await upsertReferenceNode(input);
  if (existing && newHash !== undefined && existing.projectionHash !== newHash) {
    await updateNode(nodeId, { embedding: [] });
  }
  return nodeId;
}

/** Clear the given outgoing edge types from a node, then upsert the current set. */
async function reconcileEdges(
  nodeId: string,
  types: EdgeType[],
  specs: EdgeSpec[],
): Promise<void> {
  await removeOutgoingEdges(nodeId, types);
  for (const spec of specs) {
    await applyEdge(spec);
  }
}

/** Project a Task node + its IN_WORKSPACE / PART_OF / DEPENDS_ON edges. */
export async function projectTask(task: TaskRow): Promise<void> {
  const nodeId = await upsertEntityNode(taskToNodeInput(task));
  await reconcileEdges(nodeId, TASK_EDGE_TYPES, taskEdges(task));
}

/**
 * Re-apply a Task's task→task edges (PART_OF parent, DEPENDS_ON dependencies) as
 * a second pass *after* all task nodes exist, so an edge whose endpoint task was
 * projected later (out of list order) is never permanently dropped. Idempotent
 * (MERGE via `applyEdge`), so it is safe to call every pass. Stale task→task
 * edges (a removed dependency) are cleared separately by {@link projectTask}'s
 * `reconcileEdges` when the task's hash changes.
 */
export async function linkTaskRelations(task: TaskRow): Promise<void> {
  for (const spec of taskRelationEdges(task)) {
    await applyEdge(spec);
  }
}

/** Project a Workspace node + its LINKED_TO edges (from the junction table). */
export async function projectWorkspace(workspace: WorkspaceRow): Promise<void> {
  const environmentIds = workspaceEnvironmentLinkStore.getLinkedEnvironmentIds(workspace.id);
  // The link set feeds the projection hash (so link changes trigger re-project)
  // and the LINKED_TO edge reconciliation below.
  const nodeId = await upsertEntityNode(workspaceToNodeInput(workspace, environmentIds));
  await reconcileEdges(
    nodeId,
    WORKSPACE_EDGE_TYPES,
    environmentIds.map((environmentId) => workspaceLinkEdge(workspace.id, environmentId)),
  );
}

/**
 * Project a Session node + its ATTEMPT_OF / RAN_IN / USED_PERSONA edges and the
 * incoming SPAWNED edge from its parent.
 *
 * @param workspaceId - Resolved from the session's task (empty if none).
 */
export async function projectSession(session: SessionRow, workspaceId: string): Promise<void> {
  const nodeId = await upsertEntityNode(sessionToNodeInput(session, workspaceId));
  await reconcileEdges(nodeId, SESSION_EDGE_TYPES, sessionEdges(session));
}

/**
 * Upsert the incoming SPAWNED edge (parent session → this session), if any.
 *
 * Run as a separate pass *after* all session nodes exist so that ordering
 * (e.g. a child projected before its parent) never permanently drops the edge.
 * Idempotent (MERGE), so it is safe to call every pass.
 */
export async function linkSessionSpawn(session: SessionRow): Promise<void> {
  const spawn = sessionSpawnEdge(session);
  if (spawn) {
    await applyEdge(spawn);
  }
}

/** Project a Persona node (no outgoing structural edges). */
export async function projectPersona(persona: PersonaRow): Promise<void> {
  await upsertEntityNode(personaToNodeInput(persona));
}

/** Project an Environment node (no outgoing structural edges). */
export async function projectEnvironment(environment: EnvironmentRow): Promise<void> {
  await upsertEntityNode(environmentToNodeInput(environment));
}

/** Remove a Task node and its edges. */
export async function unprojectTask(id: string): Promise<void> {
  await deleteReferenceNodeBySource(REFERENCE_SOURCE.TASK, id);
}

/** Remove a Workspace node and its edges. */
export async function unprojectWorkspace(id: string): Promise<void> {
  await deleteReferenceNodeBySource(REFERENCE_SOURCE.WORKSPACE, id);
}

/** Remove a Session node and its edges. */
export async function unprojectSession(id: string): Promise<void> {
  await deleteReferenceNodeBySource(REFERENCE_SOURCE.SESSION, id);
}

/** Remove a Persona node and its edges. */
export async function unprojectPersona(id: string): Promise<void> {
  await deleteReferenceNodeBySource(REFERENCE_SOURCE.PERSONA, id);
}

/** Remove an Environment node and its edges. */
export async function unprojectEnvironment(id: string): Promise<void> {
  await deleteReferenceNodeBySource(REFERENCE_SOURCE.ENVIRONMENT, id);
}
