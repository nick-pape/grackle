/**
 * Maps database rows to prompt package input types.
 * Centralizes the DB-to-prompt mapping so callers don't duplicate it.
 */
import type { PersonaRow } from "@grackle-ai/database";
import { personaStore, envRegistry, findingStore, taskStore, safeParseJsonArray } from "@grackle-ai/database";
import type { PersonaResolveInput, OrchestratorContextInput } from "@grackle-ai/prompt";

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

/**
 * Build the OrchestratorContextInput by reading from database stores.
 *
 * @param workspaceId - The workspace to scope queries to.
 * @param workspace - Pre-fetched workspace metadata (avoids a redundant lookup).
 */
export function buildOrchestratorContextInput(
  workspaceId: string,
  workspace?: { name: string; description: string; repoUrl: string },
): OrchestratorContextInput {
  return {
    workspace,
    tasks: taskStore.listTasks(workspaceId).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      depth: t.depth,
      parentTaskId: t.parentTaskId,
      dependsOn: safeParseJsonArray(t.dependsOn),
      defaultPersonaId: t.defaultPersonaId,
      branch: t.branch,
      canDecompose: t.canDecompose,
    })),
    personas: personaStore.listPersonas().map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      runtime: p.runtime,
      model: p.model,
    })),
    environments: envRegistry.listEnvironments().map((e) => ({
      displayName: e.displayName,
      adapterType: e.adapterType,
      status: e.status,
      defaultRuntime: e.defaultRuntime,
    })),
    findings: findingStore.queryFindings(workspaceId, undefined, undefined, 20).map((f) => ({
      category: f.category,
      title: f.title,
      content: f.content,
    })),
  };
}
