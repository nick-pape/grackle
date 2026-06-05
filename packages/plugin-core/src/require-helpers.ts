/**
 * Shared gRPC request validation helpers.
 *
 * These functions consolidate the repeated required-field and entity-lookup
 * validation patterns that appear across handler files. Each entity helper
 * combines the "id is required" check with the "entity not found" lookup into
 * a single call that returns the row on success.
 *
 * @module
 */

import { ConnectError, Code } from "@connectrpc/connect";
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

/** Throw `Code.InvalidArgument` if `value` is falsy (empty string, 0, undefined, null). */
export function requireField(value: unknown, fieldName: string): asserts value {
  if (!value) {
    throw new ConnectError(`${fieldName} is required`, Code.InvalidArgument);
  }
}

/**
 * Throw `Code.InvalidArgument` if `value` is empty after trimming.
 * Returns the trimmed string on success.
 */
export function requireTrimmed(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ConnectError(`${fieldName} is required`, Code.InvalidArgument);
  }
  return trimmed;
}

/**
 * Throw `Code.InvalidArgument` if `value` is empty after trimming.
 * Unlike {@link requireTrimmed}, uses "cannot be empty" semantics for update
 * fields where the caller explicitly set the field to a blank value.
 */
export function requireNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new ConnectError(`${fieldName} cannot be empty`, Code.InvalidArgument);
  }
  return trimmed;
}

// ── Entity Lookup Helpers ───────────────────────────────────────

/** Look up a workspace by ID; throw `Code.NotFound` if missing. */
export function requireWorkspace(id: string): WorkspaceRow {
  requireField(id, "workspaceId");
  const row = workspaceStore.getWorkspace(id);
  if (!row) {
    throw new ConnectError(`Workspace not found: ${id}`, Code.NotFound);
  }
  return row;
}

/** Look up an environment by ID; throw `Code.NotFound` if missing. */
export function requireEnvironment(id: string): EnvironmentRow {
  requireField(id, "environmentId");
  const row = envRegistry.getEnvironment(id);
  if (!row) {
    throw new ConnectError(`Environment not found: ${id}`, Code.NotFound);
  }
  return row;
}

/** Look up a session by ID; throw `Code.NotFound` if missing. */
export function requireSession(id: string): SessionRow {
  requireField(id, "sessionId");
  const row = sessionStore.getSession(id);
  if (!row) {
    throw new ConnectError(`Session not found: ${id}`, Code.NotFound);
  }
  return row;
}

/** Look up a task by ID; throw `Code.NotFound` if missing. */
export function requireTask(id: string): TaskRow {
  requireField(id, "taskId");
  const row = taskStore.getTask(id);
  if (!row) {
    throw new ConnectError(`Task not found: ${id}`, Code.NotFound);
  }
  return row;
}

/** Look up an agent by ID; throw `Code.NotFound` if missing. */
export function requireAgent(id: string): AgentRow {
  requireField(id, "agentId");
  const row = agentStore.getAgent(id);
  if (!row) {
    throw new ConnectError(`Agent not found: ${id}`, Code.NotFound);
  }
  return row;
}

/** Look up a persona by ID; throw `Code.NotFound` if missing. */
export function requirePersona(id: string): PersonaRow {
  requireField(id, "personaId");
  const row = personaStore.getPersona(id);
  if (!row) {
    throw new ConnectError(`Persona not found: ${id}`, Code.NotFound);
  }
  return row;
}

/** Look up a component by ID; throw `Code.NotFound` if missing. */
export function requireComponent(id: string): ComponentRow {
  requireField(id, "componentId");
  const row = componentStore.getComponent(id);
  if (!row) {
    throw new ConnectError(`Component not found: ${id}`, Code.NotFound);
  }
  return row;
}

/** Look up an escalation by ID; throw `Code.NotFound` if missing. */
export function requireEscalation(id: string): EscalationRow {
  requireField(id, "escalationId");
  const row = escalationStore.getEscalation(id);
  if (!row) {
    throw new ConnectError(`Escalation not found: ${id}`, Code.NotFound);
  }
  return row;
}

/** Look up a GitHub account by ID; throw `Code.NotFound` if missing. */
export function requireGitHubAccount(id: string): GitHubAccountInfo {
  requireField(id, "id");
  const row = githubAccountStore.getGitHubAccount(id);
  if (!row) {
    throw new ConnectError(`GitHub account not found: ${id}`, Code.NotFound);
  }
  return row;
}

/** Look up a channel grant by ID; throw `Code.NotFound` if missing. */
export function requireChannelGrant(id: string): ChannelGrantRow {
  requireField(id, "grantId");
  const row = channelGrantStore.getGrant(id);
  if (!row) {
    throw new ConnectError(`Channel grant not found: ${id}`, Code.NotFound);
  }
  return row;
}

// ── Format / Constraint Helpers ─────────────────────────────────

/** Parse a string as a JSON object; throw `Code.InvalidArgument` on failure. Empty/whitespace-only input defaults to `{}`. */
export function requireJsonObject(value: string, fieldName: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.trim() || "{}");
  } catch {
    throw new ConnectError(`${fieldName} is not valid JSON`, Code.InvalidArgument);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConnectError(`${fieldName} must be a JSON object`, Code.InvalidArgument);
  }
  return parsed as Record<string, unknown>;
}

/** Throw `Code.InvalidArgument` if any budget value is negative. */
export function requireNonNegativeBudget(
  tokenBudget: number | undefined,
  costBudgetMillicents: number | undefined,
): void {
  if ((tokenBudget ?? 0) < 0 || (costBudgetMillicents ?? 0) < 0) {
    throw new ConnectError("Budget values must be >= 0", Code.InvalidArgument);
  }
}
