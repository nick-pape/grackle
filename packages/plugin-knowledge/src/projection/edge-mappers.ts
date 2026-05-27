/**
 * Pure mappers from Grackle SQL rows to structural knowledge-graph edge specs
 * (#1258). An {@link EdgeSpec} identifies endpoints by `(sourceType, sourceId)`;
 * the projector resolves those to node IDs at write time.
 *
 * Edge rule: an empty/`""` soft foreign-key reference produces NO edge.
 *
 * @module
 */

import {
  EDGE_TYPE,
  REFERENCE_SOURCE,
  type EdgeType,
  type ReferenceSource,
} from "@grackle-ai/knowledge";
import type { TaskRow, SessionRow } from "@grackle-ai/database";

/** Identifies a reference node by its source identity. */
export interface SourceKey {
  sourceType: ReferenceSource;
  sourceId: string;
}

/** A structural edge to project, with endpoints identified by source key. */
export interface EdgeSpec {
  from: SourceKey;
  to: SourceKey;
  type: EdgeType;
}

const key = (sourceType: ReferenceSource, sourceId: string): SourceKey => ({
  sourceType,
  sourceId,
});

/** Outgoing structural edge types reconciled on a Task node. */
export const TASK_EDGE_TYPES: EdgeType[] = [
  EDGE_TYPE.IN_WORKSPACE,
  EDGE_TYPE.PART_OF,
  EDGE_TYPE.DEPENDS_ON,
];

/** Outgoing structural edge types reconciled on a Session node. */
export const SESSION_EDGE_TYPES: EdgeType[] = [
  EDGE_TYPE.ATTEMPT_OF,
  EDGE_TYPE.RAN_IN,
  EDGE_TYPE.USED_PERSONA,
];

/** Outgoing structural edge types reconciled on a Workspace node. */
export const WORKSPACE_EDGE_TYPES: EdgeType[] = [EDGE_TYPE.LINKED_TO];

/** Defensively parse the `tasks.dependsOn` JSON-array column. */
export function parseDependsOn(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
  } catch {
    return [];
  }
}

/** Structural edges originating from a Task: IN_WORKSPACE, PART_OF, DEPENDS_ON. */
export function taskEdges(task: TaskRow): EdgeSpec[] {
  const from = key(REFERENCE_SOURCE.TASK, task.id);
  const edges: EdgeSpec[] = [];
  if (task.workspaceId) {
    edges.push({
      from,
      to: key(REFERENCE_SOURCE.WORKSPACE, task.workspaceId),
      type: EDGE_TYPE.IN_WORKSPACE,
    });
  }
  if (task.parentTaskId) {
    edges.push({
      from,
      to: key(REFERENCE_SOURCE.TASK, task.parentTaskId),
      type: EDGE_TYPE.PART_OF,
    });
  }
  for (const dependencyId of parseDependsOn(task.dependsOn)) {
    edges.push({ from, to: key(REFERENCE_SOURCE.TASK, dependencyId), type: EDGE_TYPE.DEPENDS_ON });
  }
  return edges;
}

/** Outgoing structural edges from a Session: ATTEMPT_OF, RAN_IN, USED_PERSONA. */
export function sessionEdges(session: SessionRow): EdgeSpec[] {
  const from = key(REFERENCE_SOURCE.SESSION, session.id);
  const edges: EdgeSpec[] = [];
  if (session.taskId) {
    edges.push({
      from,
      to: key(REFERENCE_SOURCE.TASK, session.taskId),
      type: EDGE_TYPE.ATTEMPT_OF,
    });
  }
  if (session.environmentId) {
    edges.push({
      from,
      to: key(REFERENCE_SOURCE.ENVIRONMENT, session.environmentId),
      type: EDGE_TYPE.RAN_IN,
    });
  }
  if (session.personaId) {
    edges.push({
      from,
      to: key(REFERENCE_SOURCE.PERSONA, session.personaId),
      type: EDGE_TYPE.USED_PERSONA,
    });
  }
  return edges;
}

/**
 * The SPAWNED edge (parent Session → this Session). Originates from the parent,
 * so it is reconciled with the child (parent_session_id is immutable); returned
 * separately from {@link sessionEdges} and upserted (never bulk-removed) so a
 * parent's spawn edges aren't cleared when the parent re-projects.
 */
export function sessionSpawnEdge(session: SessionRow): EdgeSpec | undefined {
  if (!session.parentSessionId) {
    return undefined;
  }
  return {
    from: key(REFERENCE_SOURCE.SESSION, session.parentSessionId),
    to: key(REFERENCE_SOURCE.SESSION, session.id),
    type: EDGE_TYPE.SPAWNED,
  };
}

/** The LINKED_TO edge for a workspace↔environment link. */
export function workspaceLinkEdge(workspaceId: string, environmentId: string): EdgeSpec {
  return {
    from: key(REFERENCE_SOURCE.WORKSPACE, workspaceId),
    to: key(REFERENCE_SOURCE.ENVIRONMENT, environmentId),
    type: EDGE_TYPE.LINKED_TO,
  };
}
