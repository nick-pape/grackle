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
  CredentialProviderConfig,
  Codespace,
} from "../hooks/types.js";

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

let idCounter = 0;

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
    status: "active",
    worktreeBasePath: "",
    useWorktrees: false,
    defaultPersonaId: "",
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

/** No-op callback for story args. */
// eslint-disable-next-line @typescript-eslint/no-empty-function
export const noop = (): void => {};

// ─── Storybook decorators ───────────────────────────────────────────────────

export { withMockGrackle } from "./storybook-decorators.js";

// ─── Aliases (some stories use "build" prefix) ──────────────────────────────

export const buildEnvironment = makeEnvironment;
export const buildSession = makeSession;
export const buildWorkspace = makeWorkspace;
export const buildTask = makeTask;
export const buildFinding = makeFinding;
export const buildToken = makeToken;
export const buildPersona = makePersona;
export const buildEvent = makeEvent;
export const buildCodespace = makeCodespace;
export const buildCredentialProviderConfig = makeCredentialProviders;
