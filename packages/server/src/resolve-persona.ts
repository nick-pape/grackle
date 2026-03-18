import * as personaStore from "./persona-store.js";
import * as settingsStore from "./settings-store.js";
import type { PersonaRow } from "./schema.js";

/** Resolved persona fields needed to start a session. */
export interface ResolvedPersona {
  /** The persona ID that was resolved. */
  personaId: string;
  /** Agent runtime implementation (e.g. "claude-code", "codex"). */
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
  /** The full persona row for additional fields. */
  persona: PersonaRow;
}

/**
 * Resolve a persona using the cascade:
 *   request persona → task default → project default → app default → error
 *
 * The first non-empty persona ID in the cascade is used to look up the persona.
 * Throws if no persona ID is found at any level, or if the resolved ID does not exist.
 */
export function resolvePersona(
  requestPersonaId: string,
  taskDefaultPersonaId?: string,
  projectDefaultPersonaId?: string,
): ResolvedPersona {
  const personaId =
    requestPersonaId ||
    taskDefaultPersonaId ||
    projectDefaultPersonaId ||
    settingsStore.getSetting("default_persona_id") ||
    "";

  if (!personaId) {
    throw new Error(
      "No persona configured. Set a default persona at the app, project, or task level, or specify one explicitly.",
    );
  }

  const persona = personaStore.getPersona(personaId);
  if (!persona) {
    throw new Error(`Persona not found: ${personaId}`);
  }

  return {
    personaId: persona.id,
    runtime: persona.runtime,
    model: persona.model,
    maxTurns: persona.maxTurns,
    systemPrompt: persona.systemPrompt,
    toolConfig: persona.toolConfig,
    mcpServers: persona.mcpServers,
    persona,
  };
}
