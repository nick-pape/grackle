import { create } from "@bufbuild/protobuf";
import { grackle, ConflictError, ValidationError } from "@grackle-ai/common";
import { ALL_MCP_TOOL_NAMES } from "@grackle-ai/common";
import { getDatabaseStores } from "@grackle-ai/database";
import { v4 as uuid } from "uuid";
import { slugify } from "@grackle-ai/database";
import { emit } from "@grackle-ai/core";
import { personaRowToProto } from "./grpc-proto-converters.js";
import { requireField, requirePersona } from "./require-helpers.js";

/** List all personas. */
export async function listPersonas(): Promise<grackle.PersonaList> {
  const { personaStore } = getDatabaseStores();
  const rows = personaStore.listPersonas();
  return create(grackle.PersonaListSchema, {
    personas: rows.map(personaRowToProto),
  });
}

/** Create a new persona. */
export async function createPersona(req: grackle.CreatePersonaRequest): Promise<grackle.Persona> {
  const { personaStore } = getDatabaseStores();
  requireField(req.name, "name");
  const personaType = req.type || "agent";
  if (personaType !== "agent" && personaType !== "script") {
    throw new ValidationError(
      `Invalid persona type: "${personaType}". Must be "agent" or "script".`,
    );
  }
  if (personaType === "script") {
    requireField(req.script, "script");
  } else {
    requireField(req.systemPrompt, "systemPrompt");
  }

  // Enforce unique ID and unique name
  let id = slugify(req.name) || uuid().slice(0, 8);
  if (personaStore.getPersona(id)) {
    id = `${id}-${uuid().slice(0, 4)}`;
  }
  if (personaStore.getPersonaByName(req.name)) {
    throw new ConflictError(`Persona with name "${req.name}" already exists`);
  }

  const toolConfigJson = JSON.stringify({
    allowedTools: [...(req.toolConfig?.allowedTools || [])],
    disallowedTools: [...(req.toolConfig?.disallowedTools || [])],
  });
  const mcpServersJson = JSON.stringify(
    req.mcpServers.map((s) => ({
      name: s.name,
      command: s.command,
      args: [...s.args],
      tools: [...s.tools],
    })),
  );

  // Validate allowed MCP tools against the known tool registry
  const allowedMcpTools = Array.isArray(req.allowedMcpTools) ? [...req.allowedMcpTools] : [];
  if (allowedMcpTools.length > 0) {
    const invalid = allowedMcpTools.filter((t) => !ALL_MCP_TOOL_NAMES.has(t));
    if (invalid.length > 0) {
      throw new ValidationError(`Invalid MCP tool name(s): ${invalid.join(", ")}`);
    }
  }
  const allowedMcpToolsJson = JSON.stringify(allowedMcpTools);

  personaStore.createPersona(
    id,
    req.name,
    req.description,
    req.systemPrompt,
    toolConfigJson,
    req.runtime,
    req.model,
    req.maxTurns,
    mcpServersJson,
    personaType,
    req.script,
    allowedMcpToolsJson,
  );
  emit("persona.created", { personaId: id });
  const row = personaStore.getPersona(id);
  return personaRowToProto(row!);
}

/** Get a persona by ID. */
export async function getPersona(req: grackle.PersonaId): Promise<grackle.Persona> {
  const row = requirePersona(req.id);
  return personaRowToProto(row);
}

/** Update an existing persona. */
export async function updatePersona(req: grackle.UpdatePersonaRequest): Promise<grackle.Persona> {
  const { personaStore, settingsStore, envRegistry } = getDatabaseStores();
  const existing = requirePersona(req.id);

  // Only update toolConfig/mcpServers if the request provides non-empty values;
  // otherwise keep the existing stored value.
  const hasNewToolConfig =
    !!req.toolConfig &&
    (req.toolConfig.allowedTools.length > 0 || req.toolConfig.disallowedTools.length > 0);
  const toolConfigJson = hasNewToolConfig
    ? JSON.stringify({
        allowedTools: [...(req.toolConfig?.allowedTools || [])],
        disallowedTools: [...(req.toolConfig?.disallowedTools || [])],
      })
    : existing.toolConfig;

  const hasNewMcpServers = Array.isArray(req.mcpServers) && req.mcpServers.length > 0;
  const mcpServersJson = hasNewMcpServers
    ? JSON.stringify(
        req.mcpServers.map((s) => ({
          name: s.name,
          command: s.command,
          args: [...s.args],
          tools: [...s.tools],
        })),
      )
    : existing.mcpServers;

  // Treat empty string / 0 as "not set" and keep existing value
  const name = req.name || existing.name;
  if (name !== existing.name && personaStore.getPersonaByName(name)) {
    throw new ConflictError(`Persona with name "${name}" already exists`);
  }
  const description = req.description || existing.description;
  const systemPrompt = req.systemPrompt || existing.systemPrompt;
  const runtime = req.runtime || existing.runtime;
  const model = req.model || existing.model;
  const maxTurns = req.maxTurns === 0 ? existing.maxTurns : req.maxTurns;
  // Empty string means "keep existing", non-empty means "set to this value"
  const updatedType = req.type || existing.type;
  const updatedScript = req.script || existing.script;

  // AllowedMcpTools is a wrapper message with proto3 presence tracking:
  // - absent (undefined) → preserve existing value
  // - present with empty tools → clear to default (revert to full set)
  // - present with tools → validate and replace
  let allowedMcpToolsJson: string;
  if (req.allowedMcpTools) {
    const tools = [...req.allowedMcpTools.tools];
    if (tools.length > 0) {
      const invalid = tools.filter((t) => !ALL_MCP_TOOL_NAMES.has(t));
      if (invalid.length > 0) {
        throw new ValidationError(`Invalid MCP tool name(s): ${invalid.join(", ")}`);
      }
    }
    allowedMcpToolsJson = JSON.stringify(tools);
  } else {
    allowedMcpToolsJson = existing.allowedMcpTools;
  }

  personaStore.updatePersona(
    req.id,
    name,
    description,
    systemPrompt,
    toolConfigJson,
    runtime,
    model,
    maxTurns,
    mcpServersJson,
    updatedType,
    updatedScript,
    allowedMcpToolsJson,
  );

  // Sync the local environment's defaultRuntime when the app-level default
  // persona's runtime changes, so bootstrap pre-installs the correct packages.
  if (runtime !== existing.runtime) {
    const appDefault = settingsStore.getSetting("default_persona_id") || "";
    if (appDefault === req.id) {
      const localEnv = envRegistry.getEnvironment("local");
      if (localEnv) {
        envRegistry.updateDefaultRuntime("local", runtime);
        emit("environment.changed", {});
      }
    }
  }

  emit("persona.updated", { personaId: req.id });
  const row = personaStore.getPersona(req.id);
  return personaRowToProto(row!);
}

/** Delete a persona by ID. */
export async function deletePersona(req: grackle.PersonaId): Promise<grackle.Empty> {
  const { personaStore } = getDatabaseStores();
  personaStore.deletePersona(req.id);
  emit("persona.deleted", { personaId: req.id });
  return create(grackle.EmptySchema, {});
}
