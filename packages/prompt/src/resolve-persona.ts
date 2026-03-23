import { personaStore, settingsStore } from "@grackle-ai/database";
import type { PersonaRow } from "@grackle-ai/database";

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
  /** The full persona row for additional fields. */
  persona: PersonaRow;
}

/**
 * Resolve a persona using the cascade:
 *   request persona → task default → workspace default → app default → error
 *
 * The first non-empty persona ID in the cascade is used to look up the persona.
 * Throws if no persona ID is found at any level, or if the resolved ID does not exist.
 */
export function resolvePersona(
  requestPersonaId: string,
  taskDefaultPersonaId?: string,
  workspaceDefaultPersonaId?: string,
): ResolvedPersona {
  const personaId =
    requestPersonaId ||
    taskDefaultPersonaId ||
    workspaceDefaultPersonaId ||
    settingsStore.getSetting("default_persona_id") ||
    "";

  if (!personaId) {
    throw new Error(
      "No persona configured. Set a default persona at the app, workspace, or task level, or specify one explicitly.",
    );
  }

  const persona = personaStore.getPersona(personaId);
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
    persona,
  };
}
