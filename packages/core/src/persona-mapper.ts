/**
 * Maps domain models to prompt package input types.
 * Centralizes the model-to-prompt mapping so callers don't duplicate it.
 */
import type { PersonaModel } from "./domain/index.js";
import { personaStore, envRegistry, taskStore, safeParseJsonArray } from "@grackle-ai/database";
import type { PersonaResolveInput, OrchestratorContextInput } from "@grackle-ai/prompt";

/** Convert a PersonaModel to a PersonaResolveInput for prompt resolution. */
export function toPersonaResolveInput(
  model: PersonaModel | undefined,
): PersonaResolveInput | undefined {
  if (!model) {
    return undefined;
  }
  return {
    id: model.id,
    name: model.name,
    runtime: model.runtime,
    model: model.model,
    maxTurns: model.maxTurns,
    systemPrompt: model.systemPrompt,
    toolConfig: model.toolConfig,
    mcpServers: model.mcpServers,
    type: model.type,
    script: model.script,
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
  };
}
