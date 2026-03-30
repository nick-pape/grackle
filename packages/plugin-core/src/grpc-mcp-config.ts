import { logger } from "@grackle-ai/core";

/** Build a JSON string of MCP server configs for the PowerLine SpawnRequest. */
export function buildMcpServersJson(
  mcpServers: {
    name: string;
    command: string;
    args?: string[];
    tools?: string[];
  }[],
): string {
  const obj: Record<string, unknown> = {};
  for (const s of mcpServers) {
    obj[s.name] = {
      command: s.command,
      args: s.args || [],
      ...(s.tools && s.tools.length > 0 ? { tools: s.tools } : {}),
    };
  }
  return JSON.stringify(obj);
}

/** Convert persona MCP server JSON string to a PowerLine-formatted JSON string. */
export function personaMcpServersToJson(mcpServersJson: string, personaId: string): string {
  let mcpServers: { name: string; command: string; args?: string[]; tools?: string[] }[];
  try {
    mcpServers = JSON.parse(mcpServersJson || "[]") as typeof mcpServers;
  } catch {
    logger.warn({ personaId }, "Failed to parse persona mcpServers JSON; ignoring");
    return "";
  }
  if (!Array.isArray(mcpServers) || mcpServers.length === 0) {
    return "";
  }
  return buildMcpServersJson(mcpServers);
}
