/**
 * Mock data builders and helpers for Storybook stories.
 *
 * Provides factory functions that create realistic test data with
 * sensible defaults and optional overrides.
 */

import type {
  Environment,
  Session,
  SessionEvent,
  Workspace,
  TaskData,
  FindingData,
  TokenInfo,
  PersonaData,
  ScheduleData,
  CredentialProviderConfig,
  Codespace,
} from "../hooks/types.js";
import type { GraphNode, GraphLink } from "../hooks/types.js";

export {
  MOCK_ENVIRONMENTS,
  MOCK_SESSIONS,
  MOCK_WORKSPACES,
  MOCK_TASKS,
  MOCK_FINDINGS,
  MOCK_TOKENS,
  MOCK_PERSONAS,
} from "../mocks/mockData.js";

// ─── Factory functions ──────────────────────────────────────────────────────

let idCounter: number = 0;

/** Generate a unique ID for test entities. */
function nextId(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}

/** Create an Environment with sensible defaults. */
export function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: nextId("env"),
    displayName: "Test Env",
    adapterType: "local",
    adapterConfig: "{}",
    status: "connected",
    bootstrapped: true,
    ...overrides,
  };
}

/** Create a Session with sensible defaults. */
export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: nextId("sess"),
    environmentId: "env-1",
    runtime: "claude-code",
    status: "idle",
    prompt: "Test prompt",
    startedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Create a Workspace with sensible defaults. */
export function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: nextId("ws"),
    name: "Test Workspace",
    description: "",
    repoUrl: "",
    environmentId: "env-1",
    linkedEnvironmentIds: [],
    status: "active",
    workingDirectory: "",
    useWorktrees: false,
    defaultPersonaId: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Create a TaskData with sensible defaults. */
export function makeTask(overrides: Partial<TaskData> = {}): TaskData {
  return {
    id: nextId("task"),
    workspaceId: "ws-1",
    title: "Test Task",
    description: "",
    status: "not_started",
    branch: "main",
    latestSessionId: "",
    dependsOn: [],
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    parentTaskId: "",
    depth: 0,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
    ...overrides,
  };
}

/** Create a FindingData with sensible defaults. */
export function makeFinding(overrides: Partial<FindingData> = {}): FindingData {
  return {
    id: nextId("finding"),
    workspaceId: "ws-1",
    taskId: "task-1",
    sessionId: "sess-1",
    category: "general",
    title: "Test Finding",
    content: "Finding content",
    tags: [],
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Create a TokenInfo with sensible defaults. */
export function makeToken(overrides: Partial<TokenInfo> = {}): TokenInfo {
  return {
    name: "TEST_TOKEN",
    tokenType: "env_var",
    envVar: "TEST_TOKEN",
    filePath: "",
    expiresAt: "",
    ...overrides,
  };
}

/** Create a PersonaData with sensible defaults. */
export function makePersona(overrides: Partial<PersonaData> = {}): PersonaData {
  return {
    id: nextId("persona"),
    name: "Test Persona",
    description: "A test persona",
    systemPrompt: "You are a test agent.",
    toolConfig: "",
    runtime: "claude-code",
    model: "sonnet",
    maxTurns: 0,
    mcpServers: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    type: "agent",
    script: "",
    allowedMcpTools: [],
    ...overrides,
  };
}

/** Create a ScheduleData with sensible defaults. */
export function makeSchedule(overrides: Partial<ScheduleData> = {}): ScheduleData {
  return {
    id: nextId("schedule"),
    title: "Test Schedule",
    description: "A test schedule",
    scheduleExpression: "5m",
    personaId: "persona-1",
    environmentId: "",
    workspaceId: "",
    parentTaskId: "",
    enabled: true,
    lastRunAt: "",
    nextRunAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    runCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Create a SessionEvent with sensible defaults. */
export function makeEvent(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    sessionId: "sess-1",
    eventType: "text",
    timestamp: "2026-01-01T00:00:00Z",
    content: "Test event content",
    ...overrides,
  };
}

/** Create a Codespace with sensible defaults. */
export function makeCodespace(overrides: Partial<Codespace> = {}): Codespace {
  return {
    name: "test-codespace",
    repository: "owner/repo",
    state: "Available",
    gitStatus: "clean",
    ...overrides,
  };
}

/** Default credential provider config (all off). */
export function makeCredentialProviders(overrides: Partial<CredentialProviderConfig> = {}): CredentialProviderConfig {
  return {
    claude: "off",
    github: "off",
    copilot: "off",
    codex: "off",
    goose: "off",
    ...overrides,
  };
}

/** Create a GraphNode with sensible defaults. */
export function makeGraphNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: nextId("kn"),
    label: "Test Knowledge Node",
    kind: "knowledge",
    category: "concept",
    content: "Test node content.",
    tags: [],
    createdAt: "2026-01-15T10:00:00Z",
    updatedAt: "2026-02-20T14:30:00Z",
    val: 1,
    ...overrides,
  };
}

/** Create a GraphLink with sensible defaults. */
export function makeGraphLink(overrides: Partial<GraphLink> = {}): GraphLink {
  return {
    source: "kn-1",
    target: "kn-2",
    type: "relates_to",
    ...overrides,
  };
}

/** No-op callback for story args. */
export const noop = (): void => {};

// ─── Storybook decorators ───────────────────────────────────────────────────

export { withMockGrackle, withMockGrackleRoute } from "./storybook-decorators.js";

// ─── Aliases (some stories use "build" prefix) ──────────────────────────────

export const buildEnvironment: typeof makeEnvironment = makeEnvironment;
export const buildSession: typeof makeSession = makeSession;
export const buildWorkspace: typeof makeWorkspace = makeWorkspace;
export const buildTask: typeof makeTask = makeTask;
export const buildFinding: typeof makeFinding = makeFinding;
export const buildToken: typeof makeToken = makeToken;
export const buildPersona: typeof makePersona = makePersona;
export const buildEvent: typeof makeEvent = makeEvent;
export const buildCodespace: typeof makeCodespace = makeCodespace;
export const buildCredentialProviderConfig: typeof makeCredentialProviders = makeCredentialProviders;
export const buildGraphNode: typeof makeGraphNode = makeGraphNode;
export const buildGraphLink: typeof makeGraphLink = makeGraphLink;
