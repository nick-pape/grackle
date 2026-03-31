import { z } from "zod";
import type { GrackleClients, ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

/** Serialize a Persona proto message to a plain object. */
function serializePersona(p: {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  runtime: string;
  model: string;
  maxTurns: number;
  createdAt: string;
  updatedAt: string;
  type: string;
  script: string;
}): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    systemPrompt: p.systemPrompt,
    runtime: p.runtime,
    model: p.model,
    maxTurns: p.maxTurns,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    type: p.type || "agent",
    script: p.script || "",
  };
}

/** MCP tools for Grackle persona management. */
export const personaTools: ToolDefinition[] = [
  {
    name: "persona_list",
    group: "persona",
    description: "List all available personas with their names, descriptions, and configurations.",
    inputSchema: z.object({}),
    rpcMethod: "listPersonas",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(_args: Record<string, unknown>, { orchestration: client }: GrackleClients) {
      try {
        const response = await client.listPersonas({});
        return jsonResult(response.personas.map(serializePersona));
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "persona_create",
    group: "persona",
    description: "Create a new persona template. Use type 'agent' for interactive LLM sessions or 'script' for run-to-completion GenAIScript programs.",
    inputSchema: z.object({
      name: z.string().describe("Persona name"),
      systemPrompt: z.string().optional().describe("System prompt for the persona (required for agent type)"),
      description: z.string().optional().describe("Human-readable description"),
      runtime: z.string().optional().describe("Agent runtime (e.g. 'claude-code', 'genaiscript')"),
      model: z.string().optional().describe("Model to use"),
      maxTurns: z.number().int().positive().optional().describe("Maximum turns for sessions"),
      type: z.enum(["agent", "script"]).optional().describe("Persona type: 'agent' (default) or 'script'"),
      script: z.string().optional().describe("Script source code (required for script type)"),
    }),
    rpcMethod: "createPersona",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { orchestration: client }: GrackleClients) {
      try {
        const persona = await client.createPersona({
          name: args.name as string,
          systemPrompt: (args.systemPrompt as string | undefined) ?? "",
          description: (args.description as string | undefined) ?? "",
          runtime: (args.runtime as string | undefined) ?? "",
          model: (args.model as string | undefined) ?? "",
          maxTurns: (args.maxTurns as number | undefined) ?? 0,
          mcpServers: [],
          type: (args.type as string | undefined) ?? "agent",
          script: (args.script as string | undefined) ?? "",
        });
        return jsonResult(serializePersona(persona));
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "persona_show",
    group: "persona",
    description: "Get full details of a persona including its system prompt, script, and configuration.",
    inputSchema: z.object({
      personaId: z.string().describe("Persona ID"),
    }),
    rpcMethod: "getPersona",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { orchestration: client }: GrackleClients) {
      try {
        const persona = await client.getPersona({ id: args.personaId as string });
        return jsonResult(serializePersona(persona));
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "persona_edit",
    group: "persona",
    description: "Update an existing persona's name, system prompt, script, description, or runtime settings.",
    inputSchema: z.object({
      personaId: z.string().describe("Persona ID to update"),
      name: z.string().optional().describe("New persona name"),
      systemPrompt: z.string().optional().describe("New system prompt"),
      description: z.string().optional().describe("New description"),
      runtime: z.string().optional().describe("New agent runtime"),
      model: z.string().optional().describe("New model"),
      maxTurns: z.number().int().positive().optional().describe("New maximum turns"),
      type: z.enum(["agent", "script"]).optional().describe("New persona type"),
      script: z.string().optional().describe("New script source code"),
    }),
    rpcMethod: "updatePersona",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { orchestration: client }: GrackleClients) {
      try {
        const persona = await client.updatePersona({
          id: args.personaId as string,
          name: (args.name as string | undefined) ?? "",
          systemPrompt: (args.systemPrompt as string | undefined) ?? "",
          description: (args.description as string | undefined) ?? "",
          runtime: (args.runtime as string | undefined) ?? "",
          model: (args.model as string | undefined) ?? "",
          maxTurns: (args.maxTurns as number | undefined) ?? 0,
          mcpServers: [],
          type: (args.type as string | undefined) ?? "",
          script: (args.script as string | undefined) ?? "",
        });
        return jsonResult(serializePersona(persona));
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "persona_delete",
    group: "persona",
    description: "Delete a persona template permanently. This cannot be undone.",
    inputSchema: z.object({
      personaId: z.string().describe("Persona ID to delete"),
    }),
    rpcMethod: "deletePersona",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { orchestration: client }: GrackleClients) {
      try {
        await client.deletePersona({ id: args.personaId as string });
        return jsonResult({ success: true });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
