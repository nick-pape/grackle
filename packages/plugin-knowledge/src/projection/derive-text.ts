/**
 * Pure text derivers that turn a Grackle entity row into an embeddable string
 * for its knowledge-graph node (#1258).
 *
 * Each mirrors the `[Entity] ...` shape of the original task deriver so the
 * embedding captures the entity's human-meaningful content.
 *
 * @module
 */

import type {
  TaskRow,
  WorkspaceRow,
  SessionRow,
  PersonaRow,
  EnvironmentRow,
} from "@grackle-ai/database";

/** Join non-empty parts with " - ". */
function joinParts(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" - ");
}

/** Embeddable text for a Task node. */
export function deriveTaskText(task: TaskRow): string {
  return joinParts([`[Task] ${task.title}`, task.description]);
}

/** Embeddable text for a Workspace node. */
export function deriveWorkspaceText(workspace: WorkspaceRow): string {
  return joinParts([`[Workspace] ${workspace.name}`, workspace.description]);
}

/** Embeddable text for a Session node (its prompt is the meaningful content). */
export function deriveSessionText(session: SessionRow): string {
  return joinParts([
    `[Session] ${session.prompt}`,
    session.model ? `model:${session.model}` : undefined,
  ]);
}

/** Embeddable text for a Persona node. */
export function derivePersonaText(persona: PersonaRow): string {
  return joinParts([`[Persona] ${persona.name}`, persona.description]);
}

/** Embeddable text for an Environment node. */
export function deriveEnvironmentText(environment: EnvironmentRow): string {
  return joinParts([
    `[Environment] ${environment.displayName}`,
    `adapter:${environment.adapterType}`,
  ]);
}
