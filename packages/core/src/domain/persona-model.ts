/**
 * Domain model for a Persona, decoupled from the database row shape.
 *
 * Key differences from PersonaRow:
 * - `toolConfig` is a parsed `ToolConfigSpec | undefined` (not a JSON string)
 * - `mcpServers` is a parsed `McpServerSpec[]` (not a JSON string)
 * - `allowedMcpTools` is a `string[]` (not a JSON string)
 *
 * @module
 */
import type { PersonaRow } from "@grackle-ai/database";
import type { ToolConfigSpec, McpServerSpec } from "@grackle-ai/common";
import { logger } from "../logger.js";

/** Domain view of a persona record with parsed JSON config fields. */
export interface PersonaModel {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  /** Parsed tool policy (allowedTools / disallowedTools). `undefined` = no policy. */
  toolConfig: ToolConfigSpec | undefined;
  runtime: string;
  model: string;
  maxTurns: number;
  /** Parsed MCP server entries. */
  mcpServers: McpServerSpec[];
  type: string;
  script: string;
  /** Parsed allowed MCP tool names. */
  allowedMcpTools: string[];
  createdAt: string;
  updatedAt: string;
}

/** Convert a database PersonaRow to a PersonaModel. Parses JSON config fields. */
export function toPersonaModel(row: PersonaRow): PersonaModel {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.systemPrompt,
    toolConfig: parseToolConfig(row.toolConfig, row.id),
    runtime: row.runtime,
    model: row.model,
    maxTurns: row.maxTurns,
    mcpServers: parseMcpServers(row.mcpServers, row.id),
    type: row.type,
    script: row.script,
    allowedMcpTools: parseStringArray(row.allowedMcpTools, row.id, "allowedMcpTools"),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseToolConfig(json: string, personaId: string): ToolConfigSpec | undefined {
  if (!json) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    logger.warn({ personaId }, "Failed to parse persona toolConfig JSON; ignoring");
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const obj = parsed as { allowedTools?: unknown; disallowedTools?: unknown };
  const allowed = safeStringArray(obj.allowedTools);
  const disallowed = safeStringArray(obj.disallowedTools);
  if (allowed.length === 0 && disallowed.length === 0) {
    return undefined;
  }
  return { allowedTools: allowed, disallowedTools: disallowed };
}

function parseMcpServers(json: string, personaId: string): McpServerSpec[] {
  if (!json) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    logger.warn({ personaId }, "Failed to parse persona mcpServers JSON; ignoring");
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return [];
  }
  const servers: McpServerSpec[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const e = entry as {
      name?: unknown;
      command?: unknown;
      args?: unknown;
      tools?: unknown;
    };
    if (typeof e.name !== "string" || !e.name) {
      continue;
    }
    servers.push({
      name: e.name,
      command: typeof e.command === "string" ? e.command : "",
      args: safeStringArray(e.args),
      tools: safeStringArray(e.tools),
    });
  }
  return servers;
}

function parseStringArray(json: string, personaId: string, field: string): string[] {
  if (!json) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    logger.warn({ personaId, field }, "Failed to parse persona JSON field; ignoring");
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((x): x is string => typeof x === "string");
}

function safeStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v.filter((x): x is string => typeof x === "string");
}
