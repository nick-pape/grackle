import { z } from "zod";
import type { GrackleClients, ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

/** Sanitize a string into a valid environment variable name (uppercase, A-Z0-9_ only). */
function sanitizeEnvVarName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/^(\d)/, "_$1");
}

/** Serialize a TokenInfo proto to a plain object. */
function serializeTokenInfo(t: {
  name: string;
  type: string;
  envVar: string;
  filePath: string;
  expiresAt: string;
}): Record<string, string> {
  return {
    name: t.name,
    type: t.type,
    target: t.type === "env_var" ? t.envVar : t.filePath,
    expiresAt: t.expiresAt || "never",
  };
}

/** MCP tools for Grackle token management. */
export const tokenTools: ToolDefinition[] = [
  {
    name: "token_list",
    group: "token",
    description: "List all configured tokens showing name, type, target, and expiry. Token values are never returned.",
    inputSchema: z.object({}),
    rpcMethod: "listTokens",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(_args: Record<string, unknown>, { core: client }: GrackleClients) {
      try {
        const response = await client.listTokens({});
        return jsonResult(response.tokens.map(serializeTokenInfo));
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "token_set",
    group: "token",
    description: "Set a token that will be auto-forwarded to environments. The token value is encrypted at rest and never returned by list operations.",
    inputSchema: z.object({
      name: z.string().describe("Unique name for the token"),
      value: z.string().describe("The secret token value"),
      type: z.enum(["env_var", "file"]).default("env_var").describe("How to inject the token: as an environment variable or a file"),
      envVar: z.string().optional().describe("Environment variable name (defaults to NAME_TOKEN)"),
      filePath: z.string().optional().describe("File path to write the token to (required when type is file)"),
    }).refine(
      (data) => data.type !== "file" || (data.filePath !== undefined && data.filePath.length > 0),
      { message: "filePath is required when type is 'file'", path: ["filePath"] },
    ),
    rpcMethod: "setToken",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { core: client }: GrackleClients) {
      try {
        const name = args.name as string;
        await client.setToken({
          name,
          type: (args.type as string) || "env_var",
          envVar: (args.envVar as string) || sanitizeEnvVarName(name) + "_TOKEN",
          filePath: (args.filePath as string) || "",
          value: args.value as string,
          expiresAt: "",
        });
        return jsonResult({ success: true, name });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "token_delete",
    group: "token",
    description: "Delete a configured token by name. The token will no longer be forwarded to environments.",
    inputSchema: z.object({
      name: z.string().describe("Name of the token to delete"),
    }),
    rpcMethod: "deleteToken",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { core: client }: GrackleClients) {
      try {
        await client.deleteToken({ name: args.name as string });
        return jsonResult({ success: true, name: args.name });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
