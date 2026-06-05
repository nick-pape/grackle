/**
 * Shared gRPC request validation helpers.
 *
 * These functions consolidate the repeated required-field and entity-lookup
 * validation patterns that appear across handler files. Each entity helper
 * combines the "id is required" check with the "entity not found" lookup into
 * a single call that returns the row on success.
 *
 * All helpers throw typed {@link GrackleError} subclasses (not raw ConnectError)
 * so domain code stays transport-agnostic. The server-side interceptor
 * translates these to ConnectError at the gRPC boundary.
 *
 * @module
 */

import { NotFoundError, ValidationError } from "@grackle-ai/common";
import type {
  AgentRow,
  ChannelGrantRow,
  ComponentRow,
  EnvironmentRow,
  EscalationRow,
  PersonaRow,
  SessionRow,
  TaskRow,
  WorkspaceRow,
} from "@grackle-ai/database";
import type { GitHubAccountInfo } from "@grackle-ai/database";
import {
  agentStore,
  componentStore,
  envRegistry,
  escalationStore,
  githubAccountStore,
  channelGrantStore,
  personaStore,
  sessionStore,
  taskStore,
  workspaceStore,
} from "@grackle-ai/database";

// ── Required Field Helpers ──────────────────────────────────────

/** Throw `ValidationError` if `value` is falsy (empty string, 0, undefined, null). */
export function requireField(value: unknown, fieldName: string): asserts value {
  if (!value) {
    throw new ValidationError(`${fieldName} is required`);
  }
}

/**
 * Throw `ValidationError` if `value` is empty after trimming.
 * Returns the trimmed string on success.
 */
export function requireTrimmed(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(`${fieldName} is required`);
  }
  return trimmed;
}

/**
 * Throw `ValidationError` if `value` is empty after trimming.
 * Unlike {@link requireTrimmed}, uses "cannot be empty" semantics for update
 * fields where the caller explicitly set the field to a blank value.
 */
export function requireNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new ValidationError(`${fieldName} cannot be empty`);
  }
  return trimmed;
}

/**
 * Throw `ValidationError` unless at least one of the given fields is truthy.
 * Returns the key of the first truthy field so the caller can branch on it.
 *
 * The error message is auto-generated from the object keys, e.g.
 * `requireOneOf({ id, name })` throws `"id or name is required"`.
 */
export function requireOneOf<T extends Record<string, unknown>>(fields: T): keyof T & string {
  for (const key of Object.keys(fields)) {
    if (fields[key]) {
      return key as keyof T & string;
    }
  }
  const keys = Object.keys(fields);
  let label: string;
  if (keys.length === 0) {
    label = "a field";
  } else if (keys.length === 1) {
    label = keys[0];
  } else if (keys.length === 2) {
    label = `${keys[0]} or ${keys[1]}`;
  } else {
    label = `${keys.slice(0, -1).join(", ")}, or ${keys[keys.length - 1]}`;
  }
  throw new ValidationError(`${label} is required`);
}

// ── Entity Lookup Helpers ───────────────────────────────────────

/** Look up a workspace by ID; throw `NotFoundError` if missing. */
export function requireWorkspace(id: string, context?: Record<string, unknown>): WorkspaceRow {
  requireField(id, "workspaceId");
  const row = workspaceStore.getWorkspace(id);
  if (!row) {
    throw new NotFoundError(`Workspace not found: ${id}`, { ...context, id });
  }
  return row;
}

/** Look up an environment by ID; throw `NotFoundError` if missing. */
export function requireEnvironment(id: string, context?: Record<string, unknown>): EnvironmentRow {
  requireField(id, "environmentId");
  const row = envRegistry.getEnvironment(id);
  if (!row) {
    throw new NotFoundError(`Environment not found: ${id}`, { ...context, id });
  }
  return row;
}

/** Look up a session by ID; throw `NotFoundError` if missing. */
export function requireSession(id: string, context?: Record<string, unknown>): SessionRow {
  requireField(id, "sessionId");
  const row = sessionStore.getSession(id);
  if (!row) {
    throw new NotFoundError(`Session not found: ${id}`, { ...context, id });
  }
  return row;
}

/** Look up a task by ID; throw `NotFoundError` if missing. */
export function requireTask(id: string, context?: Record<string, unknown>): TaskRow {
  requireField(id, "taskId");
  const row = taskStore.getTask(id);
  if (!row) {
    throw new NotFoundError(`Task not found: ${id}`, { ...context, id });
  }
  return row;
}

/** Look up an agent by ID; throw `NotFoundError` if missing. */
export function requireAgent(id: string, context?: Record<string, unknown>): AgentRow {
  requireField(id, "agentId");
  const row = agentStore.getAgent(id);
  if (!row) {
    throw new NotFoundError(`Agent not found: ${id}`, { ...context, id });
  }
  return row;
}

/** Look up a persona by ID; throw `NotFoundError` if missing. */
export function requirePersona(id: string, context?: Record<string, unknown>): PersonaRow {
  requireField(id, "personaId");
  const row = personaStore.getPersona(id);
  if (!row) {
    throw new NotFoundError(`Persona not found: ${id}`, { ...context, id });
  }
  return row;
}

/** Look up a component by ID; throw `NotFoundError` if missing. */
export function requireComponent(id: string, context?: Record<string, unknown>): ComponentRow {
  requireField(id, "componentId");
  const row = componentStore.getComponent(id);
  if (!row) {
    throw new NotFoundError(`Component not found: ${id}`, { ...context, id });
  }
  return row;
}

/** Look up an escalation by ID; throw `NotFoundError` if missing. */
export function requireEscalation(id: string, context?: Record<string, unknown>): EscalationRow {
  requireField(id, "escalationId");
  const row = escalationStore.getEscalation(id);
  if (!row) {
    throw new NotFoundError(`Escalation not found: ${id}`, { ...context, id });
  }
  return row;
}

/** Look up a GitHub account by ID; throw `NotFoundError` if missing. */
export function requireGitHubAccount(
  id: string,
  context?: Record<string, unknown>,
): GitHubAccountInfo {
  requireField(id, "id");
  const row = githubAccountStore.getGitHubAccount(id);
  if (!row) {
    throw new NotFoundError(`GitHub account not found: ${id}`, { ...context, id });
  }
  return row;
}

/** Look up a channel grant by ID; throw `NotFoundError` if missing. */
export function requireChannelGrant(
  id: string,
  context?: Record<string, unknown>,
): ChannelGrantRow {
  requireField(id, "grantId");
  const row = channelGrantStore.getGrant(id);
  if (!row) {
    throw new NotFoundError(`Channel grant not found: ${id}`, { ...context, id });
  }
  return row;
}

// ── Format / Constraint Helpers ─────────────────────────────────

/** Parse a string as a JSON object; throw `ValidationError` on failure. Empty/whitespace-only input defaults to `{}`. */
export function requireJsonObject(value: string, fieldName: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.trim() || "{}");
  } catch {
    throw new ValidationError(`${fieldName} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError(`${fieldName} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** Throw `ValidationError` if any budget value is negative. */
export function requireNonNegativeBudget(
  tokenBudget: number | undefined,
  costBudgetMillicents: number | undefined,
): void {
  if ((tokenBudget ?? 0) < 0 || (costBudgetMillicents ?? 0) < 0) {
    throw new ValidationError("Budget values must be >= 0");
  }
}
