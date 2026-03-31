// @vitest-environment jsdom
/**
 * Tests for the DomainHook self-registration pattern.
 *
 * These tests enforce that every domain hook exposes a `domainHook` property
 * and that the central registry of hooks includes them all with the expected size.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { DomainHook } from "./domainHook.js";
import type { GrackleEvent } from "@grackle-ai/web-components";
import { useEnvironments } from "./useEnvironments.js";
import { useSessions } from "./useSessions.js";
import { useWorkspaces } from "./useWorkspaces.js";
import { useTasks } from "./useTasks.js";
import { useFindings } from "./useFindings.js";
import { useTokens } from "./useTokens.js";
import { useCredentials } from "./useCredentials.js";
import { useCodespaces } from "./useCodespaces.js";
import { usePersonas } from "./usePersonas.js";
import { useSchedules } from "./useSchedules.js";
import { useKnowledge } from "./useKnowledge.js";
import { useNotifications } from "./useNotifications.js";
import { usePlugins } from "./usePlugins.js";

// ---------------------------------------------------------------------------
// Mock grackleClient (all hooks import it)
// ---------------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  listEnvironments: vi.fn().mockResolvedValue({ environments: [] }),
  listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [] }),
  listTasks: vi.fn().mockResolvedValue({ tasks: [] }),
  queryFindings: vi.fn().mockResolvedValue({ findings: [] }),
  listTokens: vi.fn().mockResolvedValue({ tokens: [] }),
  getCredentials: vi.fn().mockResolvedValue({ providers: [] }),
  listPersonas: vi.fn().mockResolvedValue({ personas: [] }),
  listSchedules: vi.fn().mockResolvedValue({ schedules: [] }),
  listCodespaces: vi.fn().mockResolvedValue({ codespaces: [], error: "" }),
  listKnowledgeNodes: vi.fn().mockResolvedValue({ nodes: [], links: [] }),
  addEnvironment: vi.fn(),
  updateEnvironment: vi.fn(),
  provisionEnvironment: vi.fn(),
  stopEnvironment: vi.fn(),
  removeEnvironment: vi.fn(),
  spawnAgent: vi.fn(),
  sendInput: vi.fn(),
  killAgent: vi.fn(),
  getSessionEvents: vi.fn(),
  getTaskSessions: vi.fn(),
  createWorkspace: vi.fn(),
  archiveWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  createTask: vi.fn(),
  startTask: vi.fn(),
  stopTask: vi.fn(),
  completeTask: vi.fn(),
  resumeTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  postFinding: vi.fn(),
  getFinding: vi.fn(),
  setToken: vi.fn(),
  deleteToken: vi.fn(),
  updateCredentials: vi.fn(),
  createPersona: vi.fn(),
  updatePersona: vi.fn(),
  deletePersona: vi.fn(),
  createCodespace: vi.fn(),
  getKnowledgeNode: vi.fn(),
  searchKnowledge: vi.fn(),
  clearKnowledge: vi.fn(),
  getSetting: vi.fn().mockResolvedValue({ value: "" }),
  setSetting: vi.fn(),
  getUsage: vi.fn(),
  streamEvents: vi.fn(),
  listPlugins: vi.fn().mockResolvedValue({ plugins: [] }),
  setPluginEnabled: vi.fn(),
}));

vi.mock("./useGrackleClient.js", () => ({
  coreClient: mockClient,
  orchestrationClient: mockClient,
  schedulingClient: mockClient,
  knowledgeClient: mockClient,
}));

vi.mock("./proto-converters.js", () => ({
  protoToEnvironment: (x: unknown) => x,
  protoToSession: (x: unknown) => x,
  protoToSessionEvent: (x: unknown) => x,
  protoToWorkspace: (x: unknown) => x,
  protoToTask: (x: unknown) => x,
  protoToFinding: (x: unknown) => x,
  protoToToken: (x: unknown) => x,
  protoToCredentialConfig: (x: unknown) => x,
  protoToPersona: (x: unknown) => x,
  protoToSchedule: (x: unknown) => x,
  protoToCodespace: (x: unknown) => x,
  protoToGraphNode: (x: unknown) => x,
  protoToGraphLink: (x: unknown) => x,
  protoToUsageStats: (x: unknown) => x,
}));

vi.mock("@grackle-ai/web-components", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return { ...orig, warnBadPayload: vi.fn() };
});

// ---------------------------------------------------------------------------
// Compile-time interface conformance
//
// These type assertions verify at build time that every hook's result type
// includes a `domainHook: DomainHook` property. If a hook is missing this
// property, the file will not compile.
// ---------------------------------------------------------------------------

type AssertHasDomainHook<T extends { domainHook: DomainHook }> = T;
type _Env = AssertHasDomainHook<ReturnType<typeof useEnvironments>>;
type _Ses = AssertHasDomainHook<ReturnType<typeof useSessions>>;
type _Ws = AssertHasDomainHook<ReturnType<typeof useWorkspaces>>;
type _Tsk = AssertHasDomainHook<ReturnType<typeof useTasks>>;
type _Fnd = AssertHasDomainHook<ReturnType<typeof useFindings>>;
type _Tok = AssertHasDomainHook<ReturnType<typeof useTokens>>;
type _Crd = AssertHasDomainHook<ReturnType<typeof useCredentials>>;
type _Cs = AssertHasDomainHook<ReturnType<typeof useCodespaces>>;
type _Per = AssertHasDomainHook<ReturnType<typeof usePersonas>>;
type _Sch = AssertHasDomainHook<ReturnType<typeof useSchedules>>;
type _Kn = AssertHasDomainHook<ReturnType<typeof useKnowledge>>;
type _Not = AssertHasDomainHook<ReturnType<typeof useNotifications>>;

type _Plg = AssertHasDomainHook<ReturnType<typeof usePlugins>>;

// Suppress unused-variable warnings — these exist solely for the type check
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _All = _Env | _Ses | _Ws | _Tsk | _Fnd | _Tok | _Crd | _Cs | _Per | _Sch | _Kn | _Not | _Plg;

// ---------------------------------------------------------------------------
// Runtime tests
// ---------------------------------------------------------------------------

/** A domain event that no hook should claim. */
const unknownEvent: GrackleEvent = {
  id: "evt-unknown",
  type: "unknown.noop",
  timestamp: "2026-01-01T00:00:00Z",
  payload: {},
};

/**
 * All domain hooks and their names. When adding a new domain hook,
 * add it here — the count assertion below will fail otherwise.
 */
const ALL_HOOKS = [
  { name: "useEnvironments", hook: useEnvironments },
  { name: "useSessions", hook: useSessions },
  { name: "useWorkspaces", hook: useWorkspaces },
  { name: "useTasks", hook: useTasks },
  { name: "useFindings", hook: useFindings },
  { name: "useTokens", hook: useTokens },
  { name: "useCredentials", hook: useCredentials },
  { name: "useCodespaces", hook: useCodespaces },
  { name: "usePersonas", hook: usePersonas },
  { name: "useSchedules", hook: useSchedules },
  { name: "useKnowledge", hook: useKnowledge },
  { name: "useNotifications", hook: useNotifications },
  { name: "usePlugins", hook: usePlugins },
] as const;

/** Expected number of domain hooks. Bump this when adding a new hook. */
const EXPECTED_HOOK_COUNT = 13;

describe("DomainHook registry", () => {
  it(`has exactly ${EXPECTED_HOOK_COUNT} registered hooks`, () => {
    expect(ALL_HOOKS).toHaveLength(EXPECTED_HOOK_COUNT);
  });
});

describe.each(ALL_HOOKS)("$name domainHook contract", ({ name, hook }) => {
  it("exposes a domainHook property", () => {
    const { result } = renderHook(() => hook());
    expect(result.current).toHaveProperty("domainHook");
    expect(result.current.domainHook).toBeDefined();
  });

  it("domainHook.onConnect returns a Promise", () => {
    const { result } = renderHook(() => hook());
    const ret = result.current.domainHook.onConnect();
    expect(ret).toBeInstanceOf(Promise);
    // Swallow the promise to avoid unhandled rejection
    ret.catch(() => {});
  });

  it("domainHook.onDisconnect does not throw", () => {
    const { result } = renderHook(() => hook());
    expect(() => result.current.domainHook.onDisconnect()).not.toThrow();
  });

  it("domainHook.handleEvent returns false for unknown events", () => {
    const { result } = renderHook(() => hook());
    expect(result.current.domainHook.handleEvent(unknownEvent)).toBe(false);
  });
});
