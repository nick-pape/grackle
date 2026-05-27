/**
 * Pure mappers from Grackle SQL rows to knowledge-graph reference-node upsert
 * inputs (#1258), plus a cheap change-detection hash.
 *
 * Kept pure (no IO) so they are unit-testable without Neo4j.
 *
 * @module
 */

import { createHash } from "node:crypto";
import { REFERENCE_SOURCE, type UpsertReferenceNodeInput } from "@grackle-ai/knowledge";
import type {
  TaskRow,
  WorkspaceRow,
  SessionRow,
  PersonaRow,
  EnvironmentRow,
} from "@grackle-ai/database";
import {
  deriveTaskText,
  deriveWorkspaceText,
  deriveSessionText,
  derivePersonaText,
  deriveEnvironmentText,
} from "./derive-text.js";

/**
 * Stable hash of the projected fields, stored on the node as `projectionHash`
 * so the reconciliation scan can skip rows whose projection is unchanged.
 *
 * Non-cryptographic use (change detection only); SHA-256 is used purely to keep
 * static analysis happy — no weak-algorithm dependence.
 */
export function computeProjectionHash(...parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Map a Task row to its reference-node upsert input. */
export function taskToNodeInput(task: TaskRow): UpsertReferenceNodeInput {
  const label = deriveTaskText(task);
  const workspaceId = task.workspaceId ?? "";
  return {
    sourceType: REFERENCE_SOURCE.TASK,
    sourceId: task.id,
    label,
    workspaceId,
    extraProps: {
      status: task.status,
      projectionHash: computeProjectionHash(
        "task",
        label,
        workspaceId,
        task.parentTaskId,
        task.dependsOn,
        task.status,
      ),
    },
  };
}

/**
 * Map a Workspace row to its reference-node upsert input.
 *
 * @param linkedEnvironmentIds - IDs of the environments linked to this workspace
 *   (the `LINKED_TO` edge set). Folded into the projection hash so a link/unlink
 *   changes the hash and the reconciliation scan re-projects the workspace,
 *   keeping `LINKED_TO` edges converged even if the change's event was missed
 *   (e.g. while Neo4j was down).
 */
export function workspaceToNodeInput(
  workspace: WorkspaceRow,
  linkedEnvironmentIds: string[] = [],
): UpsertReferenceNodeInput {
  const label = deriveWorkspaceText(workspace);
  return {
    sourceType: REFERENCE_SOURCE.WORKSPACE,
    sourceId: workspace.id,
    label,
    // A workspace's own scope is itself.
    workspaceId: workspace.id,
    extraProps: {
      status: workspace.status,
      // Sort so the hash is order-independent (the link store's order is not
      // guaranteed) and only changes when the link *set* actually changes.
      projectionHash: computeProjectionHash(
        "workspace",
        label,
        workspace.status,
        [...linkedEnvironmentIds].sort(),
      ),
    },
  };
}

/**
 * Map a Session row to its reference-node upsert input.
 *
 * @param workspaceId - Resolved from the session's task (sessions have no direct
 *   workspace column); empty string when the session has no task.
 */
export function sessionToNodeInput(
  session: SessionRow,
  workspaceId: string,
): UpsertReferenceNodeInput {
  const label = deriveSessionText(session);
  return {
    sourceType: REFERENCE_SOURCE.SESSION,
    sourceId: session.id,
    label,
    workspaceId,
    extraProps: {
      status: session.status,
      projectionHash: computeProjectionHash(
        "session",
        label,
        workspaceId,
        session.taskId,
        session.environmentId,
        session.personaId,
        session.parentSessionId,
        session.status,
      ),
    },
  };
}

/** Map a Persona row to its reference-node upsert input (global scope). */
export function personaToNodeInput(persona: PersonaRow): UpsertReferenceNodeInput {
  const label = derivePersonaText(persona);
  return {
    sourceType: REFERENCE_SOURCE.PERSONA,
    sourceId: persona.id,
    label,
    workspaceId: "",
    extraProps: { projectionHash: computeProjectionHash("persona", label) },
  };
}

/** Map an Environment row to its reference-node upsert input (global scope). */
export function environmentToNodeInput(environment: EnvironmentRow): UpsertReferenceNodeInput {
  const label = deriveEnvironmentText(environment);
  return {
    sourceType: REFERENCE_SOURCE.ENVIRONMENT,
    sourceId: environment.id,
    label,
    workspaceId: "",
    extraProps: {
      status: environment.status,
      projectionHash: computeProjectionHash("environment", label, environment.status),
    },
  };
}
