/**
 * Persona resolution with cascade logic.
 * Pure function — no database or store dependencies.
 */

/** Database-agnostic persona data for resolution. */
export interface PersonaResolveInput {
  /** Persona ID. */
  id: string;
  /** Display name. */
  name: string;
  /** Agent runtime implementation (e.g. "claude-code", "codex", "genaiscript"). */
  runtime: string;
  /** LLM model identifier (e.g. "sonnet", "gpt-4.1"). */
  model: string;
  /** Maximum turns for the agent session (0 = unlimited). */
  maxTurns: number;
  /** System prompt to prepend. */
  systemPrompt: string;
  /** JSON tool configuration. */
  toolConfig: string;
  /** JSON array of MCP server configs. */
  mcpServers: string;
  /** Persona type: "agent" (interactive LLM session) or "script" (run-to-completion). */
  type: string;
  /** Script source code (non-empty for script personas). */
  script: string;
}

/** Resolved persona fields needed to start a session. */
export interface ResolvedPersona {
  /** The persona ID that was resolved. */
  personaId: string;
  /** Agent runtime implementation (e.g. "claude-code", "codex", "genaiscript"). */
  runtime: string;
  /** LLM model identifier (e.g. "sonnet", "gpt-4.1"). */
  model: string;
  /** Maximum turns for the agent session (0 = unlimited). */
  maxTurns: number;
  /** System prompt to prepend. */
  systemPrompt: string;
  /** JSON tool configuration. */
  toolConfig: string;
  /** JSON array of MCP server configs. */
  mcpServers: string;
  /** Persona type: "agent" (interactive LLM session) or "script" (run-to-completion). */
  type: string;
  /** Script source code (non-empty for script personas). */
  script: string;
}

/**
 * Resolve a persona using the cascade:
 *   request persona, task default, workspace default, app default, then error
 *
 * The first non-empty persona ID in the cascade is used to look up the persona
 * via the provided lookup function. Throws if no persona ID is found at any
 * level, or if the resolved ID does not exist.
 *
 * @param requestPersonaId - Persona ID from the request (highest priority).
 * @param taskDefaultPersonaId - Task-level default persona ID.
 * @param workspaceDefaultPersonaId - Workspace-level default persona ID.
 * @param appDefaultPersonaId - App-level default persona ID (pre-fetched from settings).
 * @param lookupPersona - Function to look up a persona by ID. Returns undefined if not found.
 */
export function resolvePersona(
  requestPersonaId: string,
  taskDefaultPersonaId: string | undefined,
  workspaceDefaultPersonaId: string | undefined,
  appDefaultPersonaId: string | undefined,
  lookupPersona: (id: string) => PersonaResolveInput | undefined,
): ResolvedPersona {
  const personaId =
    requestPersonaId ||
    taskDefaultPersonaId ||
    workspaceDefaultPersonaId ||
    appDefaultPersonaId ||
    "";

  if (!personaId) {
    throw new Error(
      "No persona configured. Set a default persona at the app, workspace, or task level, or specify one explicitly.",
    );
  }

  const persona = lookupPersona(personaId);
  if (!persona) {
    throw new Error(`Persona not found: ${personaId}`);
  }

  const personaType = persona.type || "agent";

  if (!persona.runtime) {
    throw new Error(`Persona "${persona.name}" has no runtime configured`);
  }
  // Model is required for agent personas but optional for script personas
  if (personaType !== "script" && !persona.model) {
    throw new Error(`Persona "${persona.name}" has no model configured`);
  }

  return {
    personaId: persona.id,
    runtime: persona.runtime,
    model: persona.model,
    maxTurns: persona.maxTurns,
    systemPrompt: persona.systemPrompt,
    toolConfig: persona.toolConfig,
    mcpServers: persona.mcpServers,
    type: personaType,
    script: persona.script,
  };
}
