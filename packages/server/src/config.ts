import { DEFAULT_SERVER_PORT, DEFAULT_WEB_PORT, DEFAULT_MCP_PORT, DEFAULT_POWERLINE_PORT } from "@grackle-ai/common";

/** Validated server configuration resolved from environment variables. */
export interface ServerConfig {
  /** gRPC server port (GRACKLE_PORT). */
  grpcPort: number;
  /** Web UI + WebSocket port (GRACKLE_WEB_PORT). */
  webPort: number;
  /** MCP server port (GRACKLE_MCP_PORT). */
  mcpPort: number;
  /** PowerLine server port (GRACKLE_POWERLINE_PORT). */
  powerlinePort: number;
  /** Bind address for all servers (GRACKLE_HOST). */
  host: string;
  /** Skip auto-starting the local PowerLine process (GRACKLE_SKIP_LOCAL_POWERLINE=1). */
  skipLocalPowerline: boolean;
  /** Skip auto-starting the root task when an environment connects (GRACKLE_SKIP_ROOT_AUTOSTART=1). */
  skipRootAutostart: boolean;
}

/**
 * Parse and validate a port number from an environment variable.
 * Returns the default if the variable is not set.
 * Throws if the value is not a valid port (integer 1-65535).
 */
function parsePort(envName: string, defaultValue: number): number {
  const raw = process.env[envName];
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `Invalid port for ${envName}: "${raw}". Must be an integer between 1 and 65535.`,
    );
  }
  return parsed;
}

/** Parse a boolean flag from an environment variable ("1" = true, anything else = false). */
function parseFlag(envName: string): boolean {
  return process.env[envName] === "1";
}

/**
 * Resolve and validate all server configuration from environment variables.
 * Throws on invalid values so the server fails fast at startup with a clear error.
 */
export function resolveServerConfig(): ServerConfig {
  return Object.freeze({
    grpcPort: parsePort("GRACKLE_PORT", DEFAULT_SERVER_PORT),
    webPort: parsePort("GRACKLE_WEB_PORT", DEFAULT_WEB_PORT),
    mcpPort: parsePort("GRACKLE_MCP_PORT", DEFAULT_MCP_PORT),
    powerlinePort: parsePort("GRACKLE_POWERLINE_PORT", DEFAULT_POWERLINE_PORT),
    host: process.env.GRACKLE_HOST || "127.0.0.1",
    skipLocalPowerline: parseFlag("GRACKLE_SKIP_LOCAL_POWERLINE"),
    skipRootAutostart: parseFlag("GRACKLE_SKIP_ROOT_AUTOSTART"),
  });
}
