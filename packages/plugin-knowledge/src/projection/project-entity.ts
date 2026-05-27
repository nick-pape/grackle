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

/**
 * Reconcile a node's outgoing structural edges.
 *
 * Always (re-)applies the current edge set with `MERGE` (idempotent + additive),
 * so an edge that was skipped on an earlier pass because an endpoint node did not
 * exist yet is healed on a later pass — even when the node's projection hash is
 * unchanged. `removeOutgoingEdges` (clearing stale edges, e.g. from a changed
 * foreign key) runs **only** when `clearStale` is set, i.e. when the projection
 * actually changed; an unchanged re-apply must never bulk-remove.
 */
async function reconcileEdges(
  nodeId: string,
  types: EdgeType[],
  specs: EdgeSpec[],
  clearStale: boolean,
): Promise<void> {
  if (clearStale) {
    await removeOutgoingEdges(nodeId, types);
  }
  for (const spec of specs) {
    await applyEdge(spec);
  }
}

/** Resolve a workspace's LINKED_TO edge specs from the junction table. */
function workspaceLinkEdges(workspaceId: string): EdgeSpec[] {
  return workspaceEnvironmentLinkStore
    .getLinkedEnvironmentIds(workspaceId)
    .map((environmentId) => workspaceLinkEdge(workspaceId, environmentId));
}

/** Project a Task node + reconcile its IN_WORKSPACE / PART_OF / DEPENDS_ON edges (clearing stale). */
export async function projectTask(task: TaskRow): Promise<void> {
  const nodeId = await upsertEntityNode(taskToNodeInput(task));
  await reconcileEdges(nodeId, TASK_EDGE_TYPES, taskEdges(task), true);
}

/** Project a Workspace node + reconcile its LINKED_TO edges (clearing stale). */
export async function projectWorkspace(workspace: WorkspaceRow): Promise<void> {
  // The link set feeds the projection hash (so link changes trigger re-project)
  // and the LINKED_TO edge reconciliation below.
  const nodeId = await upsertEntityNode(
    workspaceToNodeInput(
      workspace,
      workspaceEnvironmentLinkStore.getLinkedEnvironmentIds(workspace.id),
    ),
  );
  await reconcileEdges(nodeId, WORKSPACE_EDGE_TYPES, workspaceLinkEdges(workspace.id), true);
}

/**
 * Project a Session node + reconcile its ATTEMPT_OF / RAN_IN / USED_PERSONA edges
 * (clearing stale). The incoming SPAWNED edge is handled by {@link linkSessionSpawn}.
 *
 * @param workspaceId - Resolved from the session's task (empty if none).
 */
export async function projectSession(session: SessionRow, workspaceId: string): Promise<void> {
  const nodeId = await upsertEntityNode(sessionToNodeInput(session, workspaceId));
  await reconcileEdges(nodeId, SESSION_EDGE_TYPES, sessionEdges(session), true);
}

/**
 * Re-apply an entity's outgoing edges with `MERGE` **without** clearing stale ones
 * (additive). Used by the reconciliation scan for rows whose hash is unchanged, so
 * any edge previously dropped (endpoint projected later, or a transient failure) is
 * eventually healed. A no-op if the node is not projected yet (the next pass or a
 * rebuild closes the gap once it exists).
 */
export async function reconcileTaskEdges(task: TaskRow): Promise<void> {
  const node = await findReferenceNodeBySource(REFERENCE_SOURCE.TASK, task.id);
  if (node) {
    await reconcileEdges(node.id, TASK_EDGE_TYPES, taskEdges(task), false);
  }
}

/** Additive re-apply of a Workspace's LINKED_TO edges (see {@link reconcileTaskEdges}). */
export async function reconcileWorkspaceEdges(workspace: WorkspaceRow): Promise<void> {
  const node = await findReferenceNodeBySource(REFERENCE_SOURCE.WORKSPACE, workspace.id);
  if (node) {
    await reconcileEdges(node.id, WORKSPACE_EDGE_TYPES, workspaceLinkEdges(workspace.id), false);
  }
}

/** Additive re-apply of a Session's outgoing edges (see {@link reconcileTaskEdges}). */
export async function reconcileSessionEdges(session: SessionRow): Promise<void> {
  const node = await findReferenceNodeBySource(REFERENCE_SOURCE.SESSION, session.id);
  if (node) {
    await reconcileEdges(node.id, SESSION_EDGE_TYPES, sessionEdges(session), false);
  }
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
