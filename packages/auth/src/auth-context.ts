/**
 * Authentication context resolved from an incoming MCP request.
 *
 * - `"api-key"`: Full-access authentication via the global API key.
 * - `"scoped"`: Session-scoped token identifying a specific task/session/persona.
 * - `"oauth"`: OAuth-authorized client — full tool access (user explicitly approved).
 */
export type AuthContext =
  | { type: "api-key" }
  | {
      type: "scoped";
      taskId: string;
      workspaceId?: string;
      personaId: string;
      taskSessionId: string;
      /**
       * Owning Grackle Agent id (#1418). Present when the task was spawned
       * under an Agent's principal. Distinct from the ACP runtime "agent id"
       * used in session metadata.
       */
      agentId?: string;
    }
  | { type: "oauth"; clientId: string };
