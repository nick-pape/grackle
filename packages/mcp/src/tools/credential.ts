import {
  claudeProviderModeToString,
  providerToggleToString,
} from "@grackle-ai/common";
import { z } from "zod";
import type { GrackleClients, ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";

/** Serialize a CredentialProviderConfig proto to a plain object with string values. */
function serializeConfig(config: {
  claude: number;
  github: number;
  copilot: number;
  codex: number;
}): Record<string, string> {
  return {
    claude: claudeProviderModeToString(config.claude) || "off",
    github: providerToggleToString(config.github) || "off",
    copilot: providerToggleToString(config.copilot) || "off",
    codex: providerToggleToString(config.codex) || "off",
  };
}

/** MCP tools for Grackle credential provider management. */
export const credentialTools: ToolDefinition[] = [
  {
    name: "credential_provider_list",
    group: "credential",
    description: "List current credential provider configuration showing which providers are enabled for auto-forwarding.",
    inputSchema: z.object({}),
    rpcMethod: "getCredentialProviders",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(_args: Record<string, unknown>, { core: client }: GrackleClients) {
      try {
        const config = await client.getCredentialProviders({});
        return jsonResult(serializeConfig(config));
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "credential_provider_set",
    group: "credential",
    description: "Set a credential provider mode. Provider must be one of: claude, github, copilot, codex. Claude accepts: off, subscription, api_key. Others accept: off, on.",
    inputSchema: z.object({
      provider: z.enum(["claude", "github", "copilot", "codex"]).describe("The credential provider to configure"),
      value: z.enum(["off", "on", "subscription", "api_key"]).describe("The mode to set (claude: off/subscription/api_key, others: off/on)"),
    }),
    rpcMethod: "setCredentialProvider",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, { core: client }: GrackleClients) {
      try {
        const updated = await client.setCredentialProvider({
          provider: args.provider as string,
          value: args.value as string,
        });
        return jsonResult(serializeConfig(updated));
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
];
