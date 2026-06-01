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

/** Connection state of the event stream. */
export type ConnectionStatus = "connected" | "connecting" | "disconnected";

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
  /** ID of the GitHub account to use for gh CLI operations, or empty string for default. */
  githubAccountId: string;
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
  /** ID of the task this session belongs to, if any (root/orchestrated work). */
  taskId?: string;
  /**
   * ID of the parent session that spawned this one, if any. Set for IPC/spawned
   * child sessions and for materialized subagent children (#1075). Empty/absent
   * for top-level sessions. Enables parent/child navigation.
   */
  parentSessionId?: string;
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
  /**
   * Stable tool-call id pairing `tool_use` with its `tool_result` (AHP HR3).
   * Preferred over the legacy per-runtime `raw` id parsing. Absent on
   * non-tool events and on events logged before HR3.
   */
  toolCallId?: string;
  /**
   * Turn this event belongs to (AHP HR2). Available for future turn-grouped
   * rendering; absent on out-of-band/liveness events and pre-HR2 logs.
   */
  turnId?: string;
  /**
   * Server-assigned ULID (`recordSessionAction()` return value, AHP HR8d).
   * Used as the canonical dedup + sort key by the UI — independent of
   * `timestamp`, which the AHP wire doesn't preserve and which the consumer
   * synthesizes at receive time. Absent on legacy WS pushes / log replays
   * predating HR8d; consumers should fall back to `${timestamp}|${eventType}`.
   */
  serverSeq?: string;
  /**
   * `true` when a `tool_result` reported a tool failure (#1362). First-class
   * outcome flag, preferred over parsing `is_ok` out of `content` or
   * `is_error` out of the legacy `raw` payload. Absent/false on success and
   * on non-tool events.
   */
  toolError?: boolean;
}

/** A workspace that groups tasks. */
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
  /** Inject knowledge-graph context ("Related prior work" + search guidance) at spawn (#1259). */
  injectKnowledge: boolean;
  defaultPersonaId: string;
  workpad: string;
  /** Total token cap (input + output); 0 = unlimited. */
  tokenBudget: number;
  /** Cost cap in millicents ($0.00001 units); 0 = unlimited. */
  costBudgetMillicents: number;
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

/** A running Docker container an environment can attach to (`docker ps`). */
export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
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

/**
 * A standing agent as the web UI consumes it (#1417, #1418). Phase 0
 * shipped identity + a primary persona; #1418 adds the home environment
 * (required) so the Agent can spawn sessions when wake-up surfaces fire.
 */
export interface AgentData {
  id: string;
  name: string;
  /** Emoji, image URL, or base64 data URI. Empty string renders a monogram. */
  avatar: string;
  primaryPersonaId: string;
  /** The Agent's home environment id (#1418). Required at creation time. */
  environmentId: string;
}

/** Fields accepted when updating an agent. Omitted fields are left unchanged. */
export interface UpdateAgentFields {
  name?: string;
  avatar?: string;
  primaryPersonaId?: string;
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
    githubAccountId?: string,
  ) => Promise<void>;
  /** Update an existing environment's mutable fields. */
  updateEnvironment: (
    environmentId: string,
    fields: {
      displayName?: string;
      adapterConfig?: Record<string, unknown>;
      githubAccountId?: string;
    },
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
    workspaceId?: string,
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
    onSuccess?: (workspace: Workspace) => void,
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
    injectKnowledge?: boolean,
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
  /** Request the current codespace list from the server, optionally filtered to a GitHub account. */
  listCodespaces: (githubAccountId?: string) => Promise<void>;
  /** Create a new codespace for the given repo. */
  createCodespace: (repo: string, machine?: string) => Promise<void>;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

/** Values returned by the docker-containers domain hook. */
export interface UseDockerContainersResult {
  /** Running Docker containers available to attach to. */
  dockerContainers: DockerContainer[];
  /** Error message from the most recent list attempt, or empty string. */
  dockerContainersError: string;
  /** Request the current running-container list from the server. */
  listDockerContainers: () => Promise<void>;
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

/** Values returned by the agents domain hook (#1417). */
export interface UseAgentsResult {
  /** All known agents. */
  agents: AgentData[];
  /** Whether the agent list is currently being loaded. */
  agentsLoading: boolean;
  /** Request the current agent list from the server. */
  loadAgents: () => Promise<void>;
  /** Create a new agent. Requires `environmentId` (the agent's home environment, #1418). */
  createAgent: (
    name: string,
    avatar: string,
    primaryPersonaId: string,
    environmentId: string,
  ) => Promise<AgentData>;
  /** Update an existing agent; omitted fields are preserved. */
  updateAgent: (id: string, updates: UpdateAgentFields) => Promise<AgentData>;
  /** Delete an agent by ID. */
  deleteAgent: (id: string) => Promise<void>;
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

// ─── Streams hook result ─────────────────────────────────────────────────────

/** A subscriber on an IPC stream. */
export interface StreamSubscriberData {
  /** Unique subscription identifier. */
  subscriptionId: string;
  /** ID of the session holding this subscription. */
  sessionId: string;
  /** File descriptor number assigned to the subscriber. */
  fd: number;
  /** Access permission: "r", "w", or "rw". */
  permission: string;
  /** Delivery mode: "sync", "async", or "detach". */
  deliveryMode: string;
  /** True if this subscription was created via spawn (not attachStream). */
  createdBySpawn: boolean;
}

/** An IPC stream with subscriber details. */
export interface StreamData {
  /** Opaque stream identifier. */
  id: string;
  /** Human-readable stream name. */
  name: string;
  /** Number of active subscribers. */
  subscriberCount: number;
  /** Number of messages currently buffered. */
  messageBufferDepth: number;
  /** Full subscriber details. */
  subscribers: StreamSubscriberData[];
  /** Whether publishers receive their own messages echoed back (marks a chatroom). */
  selfEcho: boolean;
}

/** A single message in an IPC stream room transcript (RFC #1264 Phase 2). */
export interface StreamMessageData {
  /** The stream (room) this message belongs to. */
  streamId: string;
  /** ULID transcript sequence key (monotonic per stream, ascending = chronological). */
  seq: string;
  /** Session id of the sender. */
  senderId: string;
  /** Message content. */
  content: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

/** Values returned by the streams domain hook. */
export interface UseStreamsResult {
  /** All known IPC streams. */
  streams: StreamData[];
  /** Whether the stream list is currently being loaded. */
  streamsLoading: boolean;
  /** True after at least one loadStreams attempt has completed (success or error). */
  streamsLoadedOnce: boolean;
  /** True if the most recent loadStreams call failed (e.g. RPC/network error). */
  streamsLoadError: boolean;
  /**
   * Request the current stream list from the server. Pass `includeInternal`
   * to surface internal IPC plumbing (lifecycle/pipe/stdin); defaults to false.
   */
  loadStreams: (includeInternal?: boolean) => Promise<void>;
  /** Transcript buffer keyed by stream id (scrollback + live, deduped by seq, ascending). */
  liveMessages: Record<string, StreamMessageData[]>;
  /** Fetch a stream's durable transcript (scrollback) and merge it into the buffer. */
  loadTranscript: (streamId: string, beforeSeq?: string) => Promise<void>;
  /** Append a live stream message to the per-stream buffer. */
  handleStreamMessage: (message: StreamMessageData) => void;
  /** Handle a domain event from the event bus. Returns `true` if handled. */
  handleEvent: (event: GrackleEvent) => boolean;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

// ─── Knowledge hook result ────────────────────────────────────────────────────

/**
 * Reason the knowledge graph failed to load.
 *
 * - `"unavailable"` — the knowledge server (Neo4j) is not running or is
 *   unreachable (the RPC returned gRPC `Unavailable`). Surfaced to the user as
 *   a "knowledge server can't be reached" state.
 * - `"error"` — any other failure (malformed response, unexpected status).
 */
export type KnowledgeLoadError = "unavailable" | "error";

/** Result returned by useKnowledge. */
export interface UseKnowledgeResult {
  graphData: { nodes: GraphNode[]; links: GraphLink[] };
  selectedNode: NodeDetail | undefined;
  /** Currently selected node ID. */
  selectedId: string | undefined;
  loading: boolean;
  /** Set when the most recent graph load failed; `undefined` when it succeeded. */
  loadError: KnowledgeLoadError | undefined;
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
    (v.raw === undefined || typeof v.raw === "string") &&
    (v.toolCallId === undefined || typeof v.toolCallId === "string") &&
    (v.turnId === undefined || typeof v.turnId === "string") &&
    (v.serverSeq === undefined || typeof v.serverSeq === "string")
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
    console.warn("[ws] Received WebSocket message without a string 'type' field:", parsed);
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
    case "waiting_input":
      return "idle";
    case "completed":
      return "stopped";
    case "killed":
      return "stopped";
    case "failed":
      return "stopped";
    case "interrupted":
      return "stopped";
    case "terminated":
      return "stopped";
    default:
      return rawStatus;
  }
}

/**
 * Map a raw PowerLine event content string to an endReason value,
 * or undefined for non-terminal events.
 */
export function mapEndReason(rawContent: string): string | undefined {
  switch (rawContent) {
    case "completed":
      return "completed";
    case "killed":
      return "killed";
    case "failed":
      return "interrupted";
    case "interrupted":
      return "interrupted";
    case "terminated":
      return "terminated";
    default:
      return undefined;
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

// ─── Plugins ─────────────────────────────────────────────────────────────────

/** Metadata for a Grackle plugin. */
export interface PluginData {
  /** Plugin identifier (e.g. "core", "orchestration"). */
  name: string;
  /** Human-readable description. */
  description: string;
  /** DB-persisted desired enabled state. */
  enabled: boolean;
  /** True for the core plugin — cannot be disabled. */
  required: boolean;
  /** Whether the plugin is currently running in this server instance. */
  loaded: boolean;
}

/** Values returned by the plugins domain hook. */
export interface UsePluginsResult {
  /** All known plugins. */
  plugins: PluginData[];
  /** Whether the plugin list is currently loading. */
  pluginsLoading: boolean;
  /** Request the current plugin list from the server. */
  loadPlugins: () => Promise<void>;
  /** Enable or disable a plugin by name. */
  setPluginEnabled: (name: string, enabled: boolean) => Promise<void>;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

/** A registered GitHub account (token is never returned by the server). */
export interface GitHubAccountData {
  id: string;
  label: string;
  username: string;
  isDefault: boolean;
  createdAt: string;
}

/** Values returned by the GitHub accounts domain hook. */
export interface UseGitHubAccountsResult {
  /** All registered GitHub accounts. */
  githubAccounts: GitHubAccountData[];
  /** Whether the account list is currently loading. */
  githubAccountsLoading: boolean;
  /** Refresh the account list from the server. */
  loadGitHubAccounts: () => Promise<void>;
  /** Register a new GitHub account. */
  addGitHubAccount: (
    label: string,
    token: string,
    username: string,
    isDefault: boolean,
  ) => Promise<void>;
  /** Update an existing GitHub account. */
  updateGitHubAccount: (
    id: string,
    fields: { label?: string; token?: string; isDefault?: boolean },
  ) => Promise<void>;
  /** Remove a GitHub account by ID. */
  removeGitHubAccount: (id: string) => Promise<void>;
  /** Import accounts from the local gh CLI authentication state. */
  importGitHubAccounts: () => Promise<{ imported: number; usernames: string[] }>;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

// ─── Resources hook result (AHP resource bridge, #1395) ──────────────────────

/** A file's content read from an environment's worktree over the AHP bridge. */
export interface ResourceContentState {
  /** Content, encoded per {@link ResourceContentState.encoding}. */
  data: string;
  /** Encoding of {@link ResourceContentState.data} ("utf-8" or "base64"). */
  encoding: string;
  /** MIME type (e.g. "text/markdown"), or "" if unknown. */
  contentType: string;
}

/**
 * Values returned by the resources domain hook (#1395). Reads file content from
 * an environment's PowerLine-owned worktree and live-tracks changes via the
 * resource-watch wire. Consumed by the v0 live-document viewer (#1396).
 */
export interface UseResourcesResult {
  /**
   * Read a file's content by `file://` URI from an environment, updating the
   * content cache and returning the result.
   */
  readResource: (environmentId: string, uri: string) => Promise<ResourceContentState>;
  /** Cached content for an environment+URI, or `undefined` until first read. */
  getResourceContent: (environmentId: string, uri: string) => ResourceContentState | undefined;
  /**
   * Start watching a `file://` URI. While watched, the content cache
   * auto-refreshes when the file changes. Returns the watch id for
   * {@link UseResourcesResult.unwatchResource}.
   */
  watchResource: (environmentId: string, uri: string, recursive?: boolean) => Promise<string>;
  /** Stop a watch by its id (idempotent). */
  unwatchResource: (watchId: string) => Promise<void>;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

// ─── Documents hook result (live docs v0 viewer, #1396) ──────────────────────

/** An open document tab in the live-docs pane — one resource subscription per tab. */
export interface DocumentTab {
  /** Stable tab id (`${environmentId} ${uri}`). */
  id: string;
  /** Environment whose worktree owns the file. */
  environmentId: string;
  /** The `file://` resource URI this tab renders. */
  uri: string;
  /** Display label (the file's basename). */
  title: string;
}

/**
 * Values returned by the documents domain hook (#1396). Manages the read-only
 * live-document pane: open tabs (each a resource subscription via the bridge,
 * #1395), the active tab, and pane visibility. The `document.show` domain event
 * (from the agent's `show_file` tool) and human filepath clicks both funnel
 * through {@link UseDocumentsResult.openDocument}.
 */
export interface UseDocumentsResult {
  /** Currently open document tabs (insertion order). */
  tabs: DocumentTab[];
  /** Id of the active tab, or `undefined` when the pane is empty. */
  activeTabId: string | undefined;
  /** Whether the document pane is shown (true while any tab is open). */
  paneOpen: boolean;
  /** Ids of tabs whose content changed while they were not the active tab (badge). */
  unseenTabIds: string[];
  /**
   * Open (or re-activate) a document tab bound to an environment + `file://`
   * URI. Dedupes by `(environmentId, uri)`. Starts a resource watch and an
   * initial read. `focus` defaults to `false` (add tab + badge, do not steal
   * focus); the `document.show` event always opens unfocused.
   */
  openDocument: (
    args: { environmentId: string; uri: string },
    options?: { focus?: boolean },
  ) => void;
  /** Close a tab by id (stops its watch). */
  closeTab: (tabId: string) => void;
  /** Make a tab active (clears its unseen badge). */
  setActiveTab: (tabId: string) => void;
  /** Lifecycle hook for connect/disconnect/event routing. */
  domainHook: DomainHook;
}

/** Delay in milliseconds before attempting a WebSocket reconnect. */
export const WS_RECONNECT_DELAY_MS: number = 3_000;

/** Maximum number of events kept in memory per hook instance. Older events are dropped. */
export const MAX_EVENTS: number = 5_000;

/** WebSocket close code indicating an unauthorized connection. */
export const WS_CLOSE_UNAUTHORIZED: number = 4001;
