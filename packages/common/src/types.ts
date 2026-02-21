// ─── Enums as string unions ─────────────────────────────────

export type SessionStatus =
  | "pending"
  | "running"
  | "waiting_input"
  | "suspended"
  | "completed"
  | "failed"
  | "killed";

export type EnvironmentStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "sleeping"
  | "error";

export type AgentEventType =
  | "text"
  | "tool_use"
  | "tool_result"
  | "error"
  | "status"
  | "system";

export type AdapterType = "codespace" | "docker" | "ssh" | "local";

export type RuntimeName = "claude-code" | "stub";

export type TokenType = "env_var" | "file";

export type ProvisionStage =
  | "creating"
  | "starting"
  | "bootstrapping"
  | "tunneling"
  | "connecting"
  | "pushing_tokens"
  | "ready"
  | "error";

// ─── Constants ──────────────────────────────────────────────

export const DEFAULT_SIDECAR_PORT = 7433;
export const DEFAULT_SERVER_PORT = 7434;
export const DEFAULT_WEB_PORT = 3000;
export const DEFAULT_RUNTIME: RuntimeName = "claude-code";
export const GRACKLE_DIR = ".grackle";
export const DB_FILENAME = "grackle.db";
export const LOGS_DIR = "logs";
export const API_KEY_FILENAME = "api-key";
