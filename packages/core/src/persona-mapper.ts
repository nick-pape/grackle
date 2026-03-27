/**
 * Maps database PersonaRow to the prompt package's PersonaResolveInput.
 */
import type { PersonaRow } from "@grackle-ai/database";
import type { PersonaResolveInput } from "@grackle-ai/prompt";

/** Convert a database PersonaRow to a PersonaResolveInput for prompt resolution. */
export function toPersonaResolveInput(row: PersonaRow | undefined): PersonaResolveInput | undefined {
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    name: row.name,
    runtime: row.runtime,
    model: row.model,
    maxTurns: row.maxTurns,
    systemPrompt: row.systemPrompt,
    toolConfig: row.toolConfig,
    mcpServers: row.mcpServers,
    type: row.type,
    script: row.script,
  };
}
