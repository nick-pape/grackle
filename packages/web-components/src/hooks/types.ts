/**
 * Shared types, type guards, and utility functions for the Grackle WebSocket hooks.
 *
 * @module
 */

// ─── Domain hook lifecycle ────────────────────────────────────────────────────

/** Lifecycle contract that every domain hook must implement. */
export interface DomainHook {
  /** Reload data when the ConnectRPC stream connects or reconnects. */
  onConnect(): Promise<void>;
  /** Reset transient state when the stream disconnects. */
  onDisconnect(): void;
  /** Handle a domain event. Return `true` if the event was consumed. */
  handleEvent(event: GrackleEvent): boolean;
}

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
  endReason?: string;
  personaId?: string;
  inputTokens?: number;
  outputTokens?: number;
  costMillicents?: number;
}

/** Aggregated usage statistics for a scope (session, task, workspace, environment). */
export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  costMillicents: number;
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
  /** IDs of all environments linked to this workspace's pool. */
  linkedEnvironmentIds: string[];
  status: string;
  workingDirectory: string;
  useWorktrees: boolean;
  defaultPersonaId: string;
  /** Total token cap across all tasks; 0 = unlimited. */
  tokenBudget: number;
  /** Cost cap in millicents across all tasks; 0 = unlimited. */
  costBudgetMillicents: number;
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
  workpad: string;
  /** Total token cap (input + output); 0 = unlimited. */
  tokenBudget: number;
  /** Cost cap in millicents ($0.00001 units); 0 = unlimited. */
  costBudgetMillicents: number;
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
  goose: "off" | "on";
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
  allowedMcpTools: string[];
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

// ─── Domain hook result types ─────────────────────────────────────────────────

/** Values returned by the environments domain hook. */
export interface UseEnvironmentsResult {
  /** All known environments. */
  environments: Environment[];
  /** Whether the environment list is currently being loaded. */
  environmentsLoading: boolean;
  /** Per-environment provisioning progress. */
  provisionStatus: Record<string, ProvisionStatus>;
  /** Request the current environment list from the server. */
  loadEnvironments: () => Promise<void>;
  /** Add a new environment. */
  addEnvironment: (
    displayName: string,
    adapterType: string,
    adapterConfig?: Record<string, unknown>,
  ) => Promise<void>;
  /** Update an existing environment's mutable fields. */
  updateEnvironment: (
    environmentId: string,
    fields: { displayName?: string; adapterConfig?: Record<string, unknown> },
  ) => Promise<void>;
  /** Provision an environment by ID. When force is true, kills active sessions and forces full provision. */
  provisionEnvironment: (environmentId: string, force?: boolean) => Promise<void>;
  /** Stop an environment by ID. */
  stopEnvironment: (environmentId: string) => Promise<void>;
  /** Remove an environment by ID. */
  removeEnvironment: (environmentId: string) => Promise<void>;
  /** The last operation error message, or empty string if none. */
  operationError: string;
  /** Clear the current operation error. */
  clearOperationError: () => void;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
  /** Handle legacy WS messages injected by E2E tests. */
  handleLegacyMessage?: (msg: WsMessage) => boolean;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

/** Values returned by the sessions domain hook. */
export interface UseSessionsResult {
  /** All known sessions. */
  sessions: Session[];
  /** Whether the session list is currently being loaded. */
  sessionsLoading: boolean;
  /** Session events currently loaded in memory. */
  events: SessionEvent[];
  /** The total number of events dropped due to the MAX_EVENTS cap. */
  eventsDropped: number;
  /** The ID of the most recently spawned session, or `undefined`. */
  lastSpawnedId: string | undefined;
  /** Sessions grouped by task ID. */
  taskSessions: Record<string, Session[]>;
  /** Refresh the session list from the server. */
  loadSessions: () => Promise<void>;
  /** Spawn a new session in an environment. */
  spawn: (
    environmentId: string,
    prompt: string,
    personaId?: string,
    workingDirectory?: string,
  ) => Promise<void>;
  /** Send text input to a running session. */
  sendInput: (sessionId: string, text: string) => Promise<void>;
  /** Kill a running session (hard kill / SIGKILL). */
  kill: (sessionId: string) => Promise<void>;
  /** Gracefully stop a running session (SIGTERM). */
  stopGraceful: (sessionId: string) => Promise<void>;
  /** Load stored events for a session from the server. */
  loadSessionEvents: (sessionId: string) => Promise<void>;
  /** Clear all in-memory events and reset the drop counter. */
  clearEvents: () => void;
  /** Load sessions associated with a task. */
  loadTaskSessions: (taskId: string) => Promise<void>;
  /**
   * Handle an incoming WebSocket message. Returns `true` if handled.
   * @deprecated Use handleSessionEvent for ConnectRPC streaming.
   */
  handleMessage: (msg: WsMessage) => boolean;
  /** Handle a session event from the ConnectRPC StreamEvents RPC. */
  handleSessionEvent: (event: SessionEvent) => void;
  /** Handle legacy WS messages injected by E2E tests. */
  handleLegacyMessage?: (msg: WsMessage) => boolean;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

/** Values returned by the workspaces domain hook. */
export interface UseWorkspacesResult {
  /** All known workspaces. */
  workspaces: Workspace[];
  /** Whether the workspace list is currently being loaded. */
  workspacesLoading: boolean;
  /** Whether a workspace creation is currently in progress. */
  workspaceCreating: boolean;
  /** Request the current workspace list from the server. */
  loadWorkspaces: () => Promise<void>;
  /** Create a new workspace. */
  createWorkspace: (
    name: string,
    description?: string,
    repoUrl?: string,
    environmentId?: string,
    defaultPersonaId?: string,
    useWorktrees?: boolean,
    workingDirectory?: string,
    onSuccess?: () => void,
    onError?: (message: string) => void,
  ) => Promise<void>;
  /** Archive a workspace by ID. */
  archiveWorkspace: (workspaceId: string) => Promise<void>;
  /** Update fields on an existing workspace. */
  updateWorkspace: (
    workspaceId: string,
    fields: {
      name?: string;
      description?: string;
      repoUrl?: string;
      workingDirectory?: string;
      useWorktrees?: boolean;
      defaultPersonaId?: string;
    },
  ) => Promise<void>;
  /** Link an additional environment to a workspace's pool. */
  linkEnvironment: (workspaceId: string, environmentId: string) => Promise<void>;
  /** Remove a linked environment from a workspace's pool. */
  unlinkEnvironment: (workspaceId: string, environmentId: string) => Promise<void>;
  /** The last link/unlink operation error message, or empty string if none. */
  linkOperationError: string;
  /** Clear the current link/unlink operation error. */
  clearLinkOperationError: () => void;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
  /** Reset transient state on disconnect. */
  onDisconnect: () => void;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

/** Values returned by the tasks domain hook. */
export interface UseTasksResult {
  /** All known tasks (may span multiple workspaces). */
  tasks: TaskData[];
  /** Whether the task list is currently being loaded. */
  tasksLoading: boolean;
  /** The ID of the task currently being started, or `undefined`. */
  taskStartingId: string | undefined;
  /** Load tasks for a given workspace. */
  loadTasks: (workspaceId: string) => Promise<void>;
  /** Load all tasks across all workspaces. */
  loadAllTasks: () => Promise<void>;
  /** Create a new task in a workspace. */
  createTask: (
    workspaceId: string,
    title: string,
    description?: string,
    dependsOn?: string[],
    parentTaskId?: string,
    defaultPersonaId?: string,
    canDecompose?: boolean,
    onSuccess?: () => void,
    onError?: (message: string) => void,
  ) => Promise<void>;
  /** Start a task, optionally specifying runtime parameters. */
  startTask: (
    taskId: string,
    personaId?: string,
    environmentId?: string,
    notes?: string,
  ) => Promise<void>;
  /** Stop a task: kill active sessions + mark complete. */
  stopTask: (taskId: string) => Promise<void>;
  /** Mark a task as completed. */
  completeTask: (taskId: string) => Promise<void>;
  /** Resume a paused/waiting task. */
  resumeTask: (taskId: string) => Promise<void>;
  /** Update a task's title, description, dependencies, and default persona. */
  updateTask: (
    taskId: string,
    title: string,
    description: string,
    dependsOn: string[],
    defaultPersonaId?: string,
  ) => Promise<void>;
  /** Delete a task by ID. */
  deleteTask: (taskId: string) => Promise<void>;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
  /** Reset transient state on disconnect. */
  onDisconnect: () => void;
  /** Handle legacy WS messages injected by E2E tests. */
  handleLegacyMessage?: (msg: WsMessage) => boolean;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

/** Values returned by the findings domain hook. */
export interface UseFindingsResult {
  /** All loaded findings. */
  findings: FindingData[];
  /** The currently selected finding (loaded by ID). */
  selectedFinding: FindingData | undefined;
  /** Whether a single finding is being loaded. */
  findingLoading: boolean;
  /** Whether a findings list fetch is in-flight. */
  findingsLoading: boolean;
  /** Load findings for a given workspace. */
  loadFindings: (workspaceId: string) => Promise<void>;
  /** Load findings across all workspaces. */
  loadAllFindings: () => Promise<void>;
  /** Load a single finding by ID. */
  loadFinding: (findingId: string) => Promise<void>;
  /** Post a new finding to a workspace. */
  postFinding: (
    workspaceId: string,
    title: string,
    content: string,
    category?: string,
    tags?: string[],
  ) => Promise<void>;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

/** Values returned by the tokens domain hook. */
export interface UseTokensResult {
  /** All known tokens. */
  tokens: TokenInfo[];
  /** Whether the token list is currently being loaded. */
  tokensLoading: boolean;
  /** Request the current token list from the server. */
  loadTokens: () => Promise<void>;
  /** Create or update a token on the server. */
  setToken: (
    name: string,
    value: string,
    tokenType: string,
    envVar: string,
    filePath: string,
  ) => Promise<void>;
  /** Delete a token by name. */
  deleteToken: (name: string) => Promise<void>;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

/** Values returned by the credentials domain hook. */
export interface UseCredentialsResult {
  /** Current credential provider configuration. */
  credentialProviders: CredentialProviderConfig;
  /** Whether the credential configuration is currently being loaded. */
  credentialsLoading: boolean;
  /** Request the current credential provider configuration from the server. */
  loadCredentials: () => Promise<void>;
  /** Update the credential provider configuration on the server. */
  updateCredentialProviders: (config: CredentialProviderConfig) => Promise<void>;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

/** Values returned by the codespaces domain hook. */
export interface UseCodespacesResult {
  /** All known codespaces. */
  codespaces: Codespace[];
  /** Error message from the most recent create attempt, or empty string. */
  codespaceError: string;
  /** Error message from the most recent list attempt, or empty string. */
  codespaceListError: string;
  /** Whether a codespace creation is currently in progress. */
  codespaceCreating: boolean;
  /** Request the current codespace list from the server. */
  listCodespaces: () => Promise<void>;
  /** Create a new codespace for the given repo. */
  createCodespace: (repo: string, machine?: string) => Promise<void>;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

/** Values returned by the personas domain hook. */
export interface UsePersonasResult {
  /** All known personas. */
  personas: PersonaData[];
  /** Whether the persona list is currently being loaded. */
  personasLoading: boolean;
  /** Request the current persona list from the server. */
  loadPersonas: () => Promise<void>;
  /** Create a new persona. */
  createPersona: (
    name: string,
    description: string,
    systemPrompt: string,
    runtime?: string,
    model?: string,
    maxTurns?: number,
    type?: string,
    script?: string,
    allowedMcpTools?: string[],
  ) => Promise<PersonaData>;
  /** Update an existing persona. */
  updatePersona: (
    personaId: string,
    name?: string,
    description?: string,
    systemPrompt?: string,
    runtime?: string,
    model?: string,
    maxTurns?: number,
    type?: string,
    script?: string,
    allowedMcpTools?: string[],
  ) => Promise<PersonaData>;
  /** Delete a persona by ID. */
  deletePersona: (personaId: string) => Promise<void>;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

/** A cron schedule entry. */
export interface ScheduleData {
  id: string;
  title: string;
  description: string;
  scheduleExpression: string;
  personaId: string;
  environmentId: string;
  workspaceId: string;
  parentTaskId: string;
  enabled: boolean;
  lastRunAt: string;
  nextRunAt: string;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Fields that can be updated on an existing schedule. */
export interface ScheduleUpdate {
  title?: string;
  description?: string;
  scheduleExpression?: string;
  personaId?: string;
  environmentId?: string;
  enabled?: boolean;
}

/** Values returned by the schedules domain hook. */
export interface UseSchedulesResult {
  /** All known schedules. */
  schedules: ScheduleData[];
  /** Whether the schedule list is currently being loaded. */
  schedulesLoading: boolean;
  /** Request the current schedule list from the server. */
  loadSchedules: () => Promise<void>;
  /** Create a new schedule. */
  createSchedule: (
    title: string,
    description: string,
    scheduleExpression: string,
    personaId: string,
    environmentId?: string,
    workspaceId?: string,
    parentTaskId?: string,
  ) => Promise<ScheduleData>;
  /** Update an existing schedule. */
  updateSchedule: (scheduleId: string, fields: ScheduleUpdate) => Promise<ScheduleData>;
  /** Delete a schedule by ID. */
  deleteSchedule: (scheduleId: string) => Promise<void>;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

// ─── Knowledge hook result ────────────────────────────────────────────────────

/** Result returned by useKnowledge. */
export interface UseKnowledgeResult {
  graphData: { nodes: GraphNode[]; links: GraphLink[] };
  selectedNode: NodeDetail | undefined;
  /** Currently selected node ID. */
  selectedId: string | undefined;
  loading: boolean;
  searchQuery: string;
  search(query: string): Promise<void>;
  clearSearch(): void;
  selectNode(id: string): Promise<void>;
  clearSelection(): void;
  expandNode(id: string): Promise<void>;
  loadRecent(workspaceId?: string): Promise<void>;
  /** Handle domain events from the event bus. Returns true if handled. */
  handleEvent(event: GrackleEvent): boolean;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

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
    VALID_TOGGLE_MODES.has(v.codex as string) &&
    VALID_TOGGLE_MODES.has(v.goose as string)
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
 * The PowerLine runtime emits "waiting_input" as event content, but the
 * server stores "idle". Terminal statuses ("completed", "killed", "failed",
 * "interrupted", "terminated") all map to "stopped". The frontend needs to
 * use the same strings as the server for consistency with list_sessions responses.
 */
export function mapSessionStatus(rawStatus: string): string {
  switch (rawStatus) {
    case "waiting_input": return "idle";
    case "completed": return "stopped";
    case "killed": return "stopped";
    case "failed": return "stopped";
    case "interrupted": return "stopped";
    case "terminated": return "stopped";
    default: return rawStatus;
  }
}

/**
 * Map a raw PowerLine event content string to an endReason value,
 * or undefined for non-terminal events.
 */
export function mapEndReason(rawContent: string): string | undefined {
  switch (rawContent) {
    case "completed": return "completed";
    case "killed": return "killed";
    case "failed": return "interrupted";
    case "interrupted": return "interrupted";
    case "terminated": return "terminated";
    default: return undefined;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

// ─── Knowledge graph types ───────────────────────────────────────────────────

/** A node in the force graph. */
export interface GraphNode {
  id: string;
  label: string;
  kind: string;
  category?: string;
  sourceType?: string;
  sourceId?: string;
  content?: string;
  tags?: string[];
  workspaceId?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Node size (edge count). */
  val: number;
}

/** A link in the force graph. */
export interface GraphLink {
  source: string;
  target: string;
  type: string;
}

/** Full detail for a selected node. */
export interface NodeDetail {
  node: GraphNode;
  edges: Array<{ fromId: string; toId: string; type: string; metadata?: Record<string, unknown> }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Delay in milliseconds before attempting a WebSocket reconnect. */
export const WS_RECONNECT_DELAY_MS: number = 3_000;

/** Maximum number of events kept in memory per hook instance. Older events are dropped. */
export const MAX_EVENTS: number = 5_000;

/** WebSocket close code indicating an unauthorized connection. */
export const WS_CLOSE_UNAUTHORIZED: number = 4001;
