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
  deleteReferenceNodeBySource,
  REFERENCE_SOURCE,
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
  const nodeId = await upsertReferenceNode(taskToNodeInput(task));
  await reconcileEdges(nodeId, TASK_EDGE_TYPES, taskEdges(task));
}

/** Project a Workspace node + its LINKED_TO edges (from the junction table). */
export async function projectWorkspace(workspace: WorkspaceRow): Promise<void> {
  const nodeId = await upsertReferenceNode(workspaceToNodeInput(workspace));
  const environmentIds = workspaceEnvironmentLinkStore.getLinkedEnvironmentIds(workspace.id);
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
  const nodeId = await upsertReferenceNode(sessionToNodeInput(session, workspaceId));
  await reconcileEdges(nodeId, SESSION_EDGE_TYPES, sessionEdges(session));
  const spawn = sessionSpawnEdge(session);
  if (spawn) {
    await applyEdge(spawn);
  }
}

/** Project a Persona node (no outgoing structural edges). */
export async function projectPersona(persona: PersonaRow): Promise<void> {
  await upsertReferenceNode(personaToNodeInput(persona));
}

/** Project an Environment node (no outgoing structural edges). */
export async function projectEnvironment(environment: EnvironmentRow): Promise<void> {
  await upsertReferenceNode(environmentToNodeInput(environment));
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
