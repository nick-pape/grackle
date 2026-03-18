/**
 * Shared types, type guards, and utility functions for the Grackle WebSocket hooks.
 *
 * @module
 */

// ─── Data interfaces ──────────────────────────────────────────────────────────

/** A provisioned environment with its current status. */
export interface Environment {
  id: string;
  displayName: string;
  adapterType: string;
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

/** A project that groups tasks and findings. */
export interface Project {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  defaultEnvironmentId: string;
  status: string;
  worktreeBasePath: string;
  useWorktrees: boolean;
  defaultPersonaId: string;
  createdAt: string;
  updatedAt: string;
}

/** A task within a project. */
export interface TaskData {
  id: string;
  projectId: string;
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
  projectId: string;
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

/** An agent persona configuration. */
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
}

/** Provisioning progress state for a single environment. */
export interface ProvisionStatus {
  stage: string;
  message: string;
  progress: number;
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

/** Type guard for {@link Environment}. */
export function isEnvironment(v: unknown): v is Environment {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.displayName === "string" &&
    typeof v.adapterType === "string" &&
    typeof v.status === "string" &&
    typeof v.bootstrapped === "boolean"
  );
}

/** Type guard for {@link Session}. */
export function isSession(v: unknown): v is Session {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.environmentId === "string" &&
    typeof v.runtime === "string" &&
    typeof v.status === "string" &&
    typeof v.prompt === "string" &&
    typeof v.startedAt === "string" &&
    (v.endedAt === undefined || typeof v.endedAt === "string") &&
    (v.error === undefined || typeof v.error === "string")
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

/** Type guard for {@link Project}. */
export function isProject(v: unknown): v is Project {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.description === "string" &&
    typeof v.repoUrl === "string" &&
    typeof v.defaultEnvironmentId === "string" &&
    typeof v.status === "string" &&
    typeof v.worktreeBasePath === "string" &&
    typeof v.useWorktrees === "boolean" &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string"
  );
}

/** Type guard for {@link TaskData}. */
export function isTaskData(v: unknown): v is TaskData {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.projectId === "string" &&
    typeof v.title === "string" &&
    typeof v.status === "string" &&
    typeof v.branch === "string" &&
    typeof v.sortOrder === "number" &&
    typeof v.depth === "number" &&
    Array.isArray(v.dependsOn) &&
    Array.isArray(v.childTaskIds)
  );
}

/** Type guard for {@link FindingData}. */
export function isFindingData(v: unknown): v is FindingData {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.projectId === "string" &&
    typeof v.taskId === "string" &&
    typeof v.sessionId === "string" &&
    typeof v.category === "string" &&
    typeof v.title === "string" &&
    typeof v.content === "string" &&
    Array.isArray(v.tags) &&
    typeof v.createdAt === "string"
  );
}

/** Type guard for {@link TokenInfo}. */
export function isTokenInfo(v: unknown): v is TokenInfo {
  return (
    isObject(v) &&
    typeof v.name === "string" &&
    typeof v.tokenType === "string" &&
    typeof v.envVar === "string" &&
    typeof v.filePath === "string" &&
    typeof v.expiresAt === "string"
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

/** Type guard for a provision progress payload (includes `environmentId`). */
export function isProvisionProgress(
  v: unknown,
): v is ProvisionStatus & { environmentId: string } {
  return (
    isObject(v) &&
    typeof v.environmentId === "string" &&
    typeof v.stage === "string" &&
    typeof v.message === "string" &&
    typeof v.progress === "number"
  );
}

/** Type guard for {@link Codespace}. */
export function isCodespace(v: unknown): v is Codespace {
  return (
    isObject(v) &&
    typeof v.name === "string" &&
    typeof v.repository === "string" &&
    typeof v.state === "string" &&
    typeof v.gitStatus === "string"
  );
}

/** Type guard for {@link PersonaData}. */
export function isPersonaData(v: unknown): v is PersonaData {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.description === "string" &&
    typeof v.systemPrompt === "string" &&
    typeof v.toolConfig === "string" &&
    typeof v.runtime === "string" &&
    typeof v.model === "string" &&
    typeof v.maxTurns === "number" &&
    typeof v.mcpServers === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string"
  );
}

// ─── Utility functions ────────────────────────────────────────────────────────

/**
 * Filter an unknown value to a typed array, discarding items that fail the
 * guard and warning about each one.
 */
export function asValidArray<T>(
  v: unknown,
  guard: (item: unknown) => item is T,
  msgType: string,
  fieldName: string,
): T[] {
  if (!Array.isArray(v)) {
    warnBadPayload(
      msgType,
      `expected "${fieldName}" to be an array, got ${typeof v}`,
    );
    return [];
  }
  return (v as unknown[]).filter((item: unknown, i: number): item is T => {
    if (guard(item)) {
      return true;
    }
    warnBadPayload(
      msgType,
      `item at index ${i} in "${fieldName}" has unexpected shape`,
    );
    return false;
  });
}

/**
 * Parse a raw WebSocket message string into a {@link WsMessage}.
 * Returns `undefined` and logs a warning if parsing fails or the result is
 * not a valid message object.
 */
export function parseWsMessage(data: string): WsMessage | undefined {
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
