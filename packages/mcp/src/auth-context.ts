/**
 * Authentication context resolved from an incoming MCP request.
 *
 * - `"api-key"`: Full-access authentication via the global API key.
 * - `"scoped"`: Session-scoped token identifying a specific task/session/persona.
 * - `"oauth"`: OAuth-authorized client — full tool access (user explicitly approved).
 */
export type AuthContext =
  | { type: "api-key" }
  | { type: "scoped"; taskId: string; projectId?: string; personaId: string; taskSessionId: string }
  | { type: "oauth"; clientId: string };
