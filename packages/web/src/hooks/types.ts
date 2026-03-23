/**
 * Shared types, type guards, and utility functions for the Grackle WebSocket hooks.
 *
 * @module
 */

// ─── Data interfaces ──────────────────────────────────────────────────────────

/**
 * A provisioned environment with its current status.
 * After normalization, `adapterConfig` is always a JSON string.
 */
export interface Environment {
  id: string;
  displayName: string;
  adapterType: string;
  adapterConfig: string;
  status: string;
  bootstrapped: boolean;
}


/** An agent session running inside an environment. */
export interface Session {
  id: string;
  environmentId: string;
  runtime: string;
  status: string;
  prompt: string;
  startedAt: string;
  endedAt?: string;
  error?: string;
  personaId?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/** Aggregated usage statistics for a scope (session, task, workspace, environment). */
export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  sessionCount: number;
}

/** A single event emitted by an agent session. */
export interface SessionEvent {
  sessionId: string;
  eventType: string;
  timestamp: string;
  content: string;
  /** Raw JSON payload from the agent runtime (e.g. tool block with is_error flag). Optional. */
  raw?: string;
}

/** A workspace that groups tasks and findings. */
export interface Workspace {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  environmentId: string;
  status: string;
  worktreeBasePath: string;
  useWorktrees: boolean;
  defaultPersonaId: string;
  createdAt: string;
  updatedAt: string;
}

/** A task within a workspace (or workspace-less for the root task). */
export interface TaskData {
  id: string;
  /** Workspace this task belongs to, or empty/undefined for workspace-less tasks (e.g. root task). */
  workspaceId: string | undefined;
  title: string;
  description: string;
  status: string;
  branch: string;
  latestSessionId: string;
  dependsOn: string[];
  /** @deprecated Removed — notes are now passed via StartTask. */
  reviewNotes?: string;
  sortOrder: number;
  createdAt: string;
  /** @deprecated Removed. */
  assignedAt?: string;
  startedAt?: string;
  completedAt?: string;
  parentTaskId: string;
  depth: number;
  childTaskIds: string[];
  canDecompose: boolean;
  defaultPersonaId: string;
}

/** A finding posted by an agent or user. */
export interface FindingData {
  id: string;
  workspaceId: string;
  taskId: string;
  sessionId: string;
  category: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
}

/** Metadata about a stored token. */
export interface TokenInfo {
  name: string;
  tokenType: string;
  envVar: string;
  filePath: string;
  expiresAt: string;
}

/** Configuration for which credential providers are enabled. */
export interface CredentialProviderConfig {
  claude: "off" | "subscription" | "api_key";
  github: "off" | "on";
  copilot: "off" | "on";
  codex: "off" | "on";
}

/** A GitHub Codespace returned from `gh codespace list`. */
export interface Codespace {
  name: string;
  repository: string;
  state: string;
  gitStatus: string;
}

/** An agent or script persona configuration. */
export interface PersonaData {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  toolConfig: string;
  runtime: string;
  model: string;
  maxTurns: number;
  mcpServers: string;
  createdAt: string;
  updatedAt: string;
  type: string;
  script: string;
}

/** Provisioning progress state for a single environment. */
export interface ProvisionStatus {
  stage: string;
  message: string;
  progress: number;
}

/** A domain event emitted by the server event bus and forwarded over WebSocket. */
export interface GrackleEvent {
  /** ULID — chronologically sortable unique identifier. */
  id: string;
  /** Dot-notation event type (e.g. "task.created"). */
  type: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Domain-specific payload. */
  payload: Record<string, unknown>;
}

/** A parsed WebSocket message with a string type and optional payload. */
export interface WsMessage {
  type: string;
  payload?: Record<string, unknown>;
}

/** Function signature for sending a WebSocket message. */
export type SendFunction = (msg: WsMessage) => void;

// ─── Runtime type guards ──────────────────────────────────────────────────────

/** Returns true when `v` is a non-null, non-array object. */
export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Emit a console warning and return `false` when an incoming payload does not
 * match the expected shape.  We warn rather than throw so a single bad message
 * from the server does not crash the entire UI.
 */
export function warnBadPayload(msgType: string, reason: string): false {
  console.warn(`[ws] Malformed "${msgType}" message: ${reason}`);
  return false;
}

/** Type guard for {@link GrackleEvent}. */
export function isGrackleEvent(v: unknown): v is GrackleEvent {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.type === "string" &&
    typeof v.timestamp === "string" &&
    isObject(v.payload)
  );
}

/** Type guard for {@link SessionEvent}. */
export function isSessionEvent(v: unknown): v is SessionEvent {
  return (
    isObject(v) &&
    typeof v.sessionId === "string" &&
    typeof v.eventType === "string" &&
    typeof v.timestamp === "string" &&
    typeof v.content === "string" &&
    (v.raw === undefined || typeof v.raw === "string")
  );
}

/** Valid values for the `claude` credential provider mode. */
const VALID_CLAUDE_MODES: ReadonlySet<string> = new Set(["off", "subscription", "api_key"]);
/** Valid values for toggle-style credential provider modes. */
const VALID_TOGGLE_MODES: ReadonlySet<string> = new Set(["off", "on"]);

/** Type guard for {@link CredentialProviderConfig}. */
export function isCredentialProviderConfig(v: unknown): v is CredentialProviderConfig {
  return (
    isObject(v) &&
    VALID_CLAUDE_MODES.has(v.claude as string) &&
    VALID_TOGGLE_MODES.has(v.github as string) &&
    VALID_TOGGLE_MODES.has(v.copilot as string) &&
    VALID_TOGGLE_MODES.has(v.codex as string)
  );
}

// ─── Utility functions ────────────────────────────────────────────────────────

/**
 * Parse a raw WebSocket message string into a {@link WsMessage} or
 * {@link GrackleEvent}.  When both `id` and `timestamp` are present the
 * result is a full `GrackleEvent`; otherwise a plain `WsMessage`.
 * Returns `undefined` and logs a warning if parsing fails or the result is
 * not a valid message object.
 */
export function parseWsMessage(data: string): WsMessage | GrackleEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    console.warn("[ws] Failed to parse WebSocket message as JSON");
    return undefined;
  }
  if (!isObject(parsed) || typeof parsed.type !== "string") {
    console.warn(
      "[ws] Received WebSocket message without a string 'type' field:",
      parsed,
    );
    return undefined;
  }
  // When both id and timestamp are present, return a full GrackleEvent
  if (typeof parsed.id === "string" && typeof parsed.timestamp === "string") {
    return {
      id: parsed.id,
      type: parsed.type,
      timestamp: parsed.timestamp,
      payload: isObject(parsed.payload) ? parsed.payload : {},
    };
  }
  return {
    type: parsed.type,
    payload: isObject(parsed.payload) ? parsed.payload : undefined,
  };
}

/**
 * Map runtime status event content to normalized session status strings.
 * The PowerLine runtime emits "waiting_input" and "killed" as event content,
 * but the server stores "idle" and "interrupted". The frontend needs to use
 * the same strings as the server for consistency with list_sessions responses.
 */
export function mapSessionStatus(rawStatus: string): string {
  switch (rawStatus) {
    case "waiting_input": return "idle";
    case "killed": return "interrupted";
    default: return rawStatus;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Delay in milliseconds before attempting a WebSocket reconnect. */
export const WS_RECONNECT_DELAY_MS: number = 3_000;

/** Maximum number of events kept in memory per hook instance. Older events are dropped. */
export const MAX_EVENTS: number = 5_000;

/** WebSocket close code indicating an unauthorized connection. */
export const WS_CLOSE_UNAUTHORIZED: number = 4001;
