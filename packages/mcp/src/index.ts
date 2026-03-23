export { createMcpServer } from "./mcp-server.js";
export type { McpServerOptions } from "./mcp-server.js";
export { createToolRegistry } from "./tools/index.js";
export { ToolRegistry } from "./tool-registry.js";
export type { ToolDefinition, ToolResult } from "./tool-registry.js";

// Re-export auth primitives from @grackle-ai/auth for backwards compatibility
export type { AuthContext, OAuthTokenClaims } from "@grackle-ai/auth";
export {
  createScopedToken, revokeTask, verifyScopedToken,
  createOAuthAccessToken, verifyOAuthAccessToken,
  OAUTH_ACCESS_TOKEN_TTL_MS, OAUTH_REFRESH_TOKEN_TTL_MS,
  authenticateMcpRequest,
} from "@grackle-ai/auth";
