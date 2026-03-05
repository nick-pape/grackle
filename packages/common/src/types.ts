// ─── Enums as string unions ─────────────────────────────────

/** Lifecycle status of an agent session. */
export type SessionStatus =
  | "pending"
  | "running"
  | "waiting_input"
  | "suspended"
  | "completed"
  | "failed"
  | "killed";

/** Connection status of a remote environment. */
export type EnvironmentStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "sleeping"
  | "error";

/** Discriminator for events emitted by an agent runtime. */
export type AgentEventType =
  | "text"
  | "tool_use"
  | "tool_result"
  | "error"
  | "status"
  | "system"
  | "finding";

export type TaskStatus = "pending" | "assigned" | "in_progress" | "review" | "done" | "failed";
export type ProjectStatus = "active" | "archived";
export type FindingCategory = "architecture" | "api" | "bug" | "decision" | "dependency" | "pattern" | "general";

/** Supported environment adapter backends. */
export type AdapterType = "docker" | "local" | "codespace" | "ssh";

/** Supported agent runtime implementations. */
export type RuntimeName = "claude-code" | "copilot" | "stub";

/** How a token is delivered to the PowerLine: as an env var or written to a file. */
export type TokenType = "env_var" | "file";

/** Stages reported during environment provisioning. */
export type ProvisionStage =
  | "creating"
  | "starting"
  | "cloning"
  | "bootstrapping"
  | "tunneling"
  | "connecting"
  | "pushing_tokens"
  | "ready"
  | "error";

// ─── Constants ──────────────────────────────────────────────

/** Default port the PowerLine gRPC server listens on. */
export const DEFAULT_POWERLINE_PORT: number = 7433;
/** Default port the central Grackle gRPC server listens on. */
export const DEFAULT_SERVER_PORT: number = 7434;
/** Default port for the web UI and WebSocket bridge. */
export const DEFAULT_WEB_PORT: number = 3000;
/** Default agent runtime used when none is specified. */
export const DEFAULT_RUNTIME: RuntimeName = "claude-code";
/** Name of the Grackle config directory under the user's home. */
export const GRACKLE_DIR: string = ".grackle";
/** SQLite database filename. */
export const DB_FILENAME: string = "grackle.db";
/** Subdirectory for session log files. */
export const LOGS_DIR: string = "logs";
/** Filename for the locally-stored API key. */
export const API_KEY_FILENAME: string = "api-key";
/** Default LLM model identifier for new sessions. */
export const DEFAULT_MODEL: string = "sonnet";
