// ─── Status Constants ───────────────────────────────────────
// Use these constants instead of string literals to get compile-time safety.
// The types are derived from the const objects so they stay in sync automatically.

/** All valid session lifecycle statuses. Import and use these instead of string literals. */
export const SESSION_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  IDLE: "idle",
  STOPPED: "stopped",
  SUSPENDED: "suspended",
} as const;

/** Lifecycle status of an agent session. */
export type SessionStatus = typeof SESSION_STATUS[keyof typeof SESSION_STATUS];

/** Session statuses that represent a terminal (ended) state. */
export const TERMINAL_SESSION_STATUSES: ReadonlySet<SessionStatus> = new Set([
  SESSION_STATUS.STOPPED,
]);

/** Why a session stopped. Only meaningful when status is STOPPED. */
export const END_REASON = {
  COMPLETED: "completed",
  KILLED: "killed",
  INTERRUPTED: "interrupted",
  TERMINATED: "terminated",
  BUDGET_EXCEEDED: "budget_exceeded",
} as const;

/** The reason a session transitioned to STOPPED. */
export type EndReason = typeof END_REASON[keyof typeof END_REASON];

/** Pipe mode for parent↔child IPC on spawn. */
export type PipeMode = "sync" | "async" | "detach" | "";

/** All valid task lifecycle statuses. Import and use these instead of string literals. */
export const TASK_STATUS = {
  NOT_STARTED: "not_started",
  WORKING: "working",
  PAUSED: "paused",
  COMPLETE: "complete",
  FAILED: "failed",
} as const;

/** Lifecycle status of a task, derived from session history. */
export type TaskStatus = typeof TASK_STATUS[keyof typeof TASK_STATUS];

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
  | "finding"
  | "subtask_create"
  | "runtime_session_id"
  | "usage";

/** Discriminator for all session events, including user input and signals. */
export type EventType = AgentEventType | "user_input" | "signal";

/** Supported environment adapter backends. */
export type AdapterType = "docker" | "local" | "codespace" | "ssh";

/** Supported agent runtime implementations. */
export type RuntimeName = "claude-code" | "copilot" | "codex" | "goose" | "stub";

/** How a token is delivered to the PowerLine: as an env var or written to a file. */
export type TokenType = "env_var" | "file";

// ─── Constants ──────────────────────────────────────────────

/** Default port the PowerLine gRPC server listens on. */
export const DEFAULT_POWERLINE_PORT: number = 7433;
/** Default port the central Grackle gRPC server listens on. */
export const DEFAULT_SERVER_PORT: number = 7434;
/** Default port for the web UI and WebSocket bridge. */
export const DEFAULT_WEB_PORT: number = 3000;
/** Default port for the MCP (Model Context Protocol) server. */
export const DEFAULT_MCP_PORT: number = 7435;
/** Name of the seed persona created on first run. */
export const DEFAULT_PERSONA_NAME: string = "Software Engineer";
/** ID of the seed persona created on first run. */
export const SEED_PERSONA_ID: string = "claude-code";
/** Name of the Grackle config directory under the user's home. */
export const GRACKLE_DIR: string = ".grackle";
/** SQLite database filename. */
export const DB_FILENAME: string = "grackle.db";
/** Subdirectory for session log files. */
export const LOGS_DIR: string = "logs";
/** Filename for the locally-stored API key. */
export const API_KEY_FILENAME: string = "api-key";
/** Maximum allowed nesting depth for task hierarchies. */
export const MAX_TASK_DEPTH: number = 8;
/** Well-known ID for the System persona (orchestrator). */
export const SYSTEM_PERSONA_ID: string = "system";
/** Display name for the System persona. */
export const SYSTEM_PERSONA_NAME: string = "System";
/** Well-known ID for the root task (always present). */
export const ROOT_TASK_ID: string = "system";
/** Initial prompt sent to the root task on auto-start (and manual restart). */
export const ROOT_TASK_INITIAL_PROMPT: string = "Introduce yourself and Grackle!";
/** Well-known ID for the default workspace (created on first run, tied to local env). */
export const DEFAULT_WORKSPACE_ID: string = "default";
/** Default maximum concurrent agent sessions when no limit is configured. */
export const DEFAULT_MAX_CONCURRENT_SESSIONS: number = 4;
/** Settings-store key for the global concurrent session limit. */
export const SETTINGS_KEY_MAX_CONCURRENT_SESSIONS: string = "max_concurrent_sessions";
