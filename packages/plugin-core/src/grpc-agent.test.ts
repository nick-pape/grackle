/**
 * Integration tests for the agent task-ownership pipeline (#1418):
 *
 *   createAgent  →  agent.created event  →  auto-create root task
 *   deleteAgent  →  walk task subtree   →  kill non-terminal sessions
 *                                       →  delete tasks (incl. children)
 *                                       →  delete agent row
 *
 * Uses a real in-memory SQLite database (no store mocks) and wires the
 * agent-root-task subscriber against the real event bus so the
 * `createAgent → root-task` path runs end-to-end. Mocks the side-effect
 * modules (stream-hub, lifecycle, etc.) the same way `grpc-environment.test.ts`
 * does so `killSessionAndCleanup` can run without a live runtime.
 *
 * The high-value scenario this catches that `agent-handlers.test.ts`
 * doesn't: cascade-delete against a real `tasks` table with a child
 * task and a real `sessions` row referencing it via the sessions.task_id
 * FK. The mocked agent-handlers test just calls `taskStore.deleteTask`
 * as a spy; only this file exercises the actual SQLite FK behavior.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// ── Mock side-effect modules (resolved via __mocks__/) ──
vi.mock("./logger.js");
vi.mock("./log-writer.js");
vi.mock("./stream-hub.js");
vi.mock("./token-push.js");
vi.mock("./adapter-manager.js");
vi.mock("./event-processor.js");
vi.mock("./processor-registry.js");
vi.mock("./session-recovery.js");
vi.mock("./auto-reconnect.js");
vi.mock("./lifecycle.js");
vi.mock("./knowledge-init.js");
vi.mock("./reanimate-agent.js");
vi.mock("./github-import.js");
vi.mock("./stream-registry.js");
vi.mock("./pipe-delivery.js");
vi.mock("./utils/exec.js");
vi.mock("./utils/network.js");
vi.mock("./utils/format-gh-error.js");

// NOTE: event-bus is deliberately NOT mocked here — we want emit() →
// subscribers to fire so the agent-root-task-boot subscriber actually
// inserts the root task when createAgent fires `agent.created`.

vi.mock("@grackle-ai/adapter-sdk", () => ({
  reconnectOrProvision: vi.fn(async function* () {
    /* empty */
  }),
}));
vi.mock("@grackle-ai/prompt", () => ({
  resolvePersona: vi.fn(),
  buildOrchestratorContext: vi.fn(() => ""),
  SystemPromptBuilder: vi.fn(function () {
    return { build: () => "" };
  }),
  buildTaskPrompt: vi.fn((t: string) => t),
}));
vi.mock("@grackle-ai/auth", () => ({
  createScopedToken: vi.fn(() => "mock-token"),
  loadOrCreateApiKey: vi.fn(() => "mock-api-key"),
  generatePairingCode: vi.fn(() => ({ code: "mock-code", token: "mock-token" })),
}));
vi.mock("@grackle-ai/knowledge", () => ({
  knowledgeSearch: vi.fn(),
  getNode: vi.fn(),
  expandNode: vi.fn(),
  createNativeNode: vi.fn(),
  ingest: vi.fn(),
  createPassThroughChunker: vi.fn(),
  listRecentNodes: vi.fn(),
}));

import { agentStore, taskStore, sessionStore } from "@grackle-ai/database";
import { subscribe } from "@grackle-ai/core";
import { initTestDatabase, getHandlers } from "./test-utils/integration-setup.js";
import { createAgentRootTaskSubscriber } from "./agent-root-task-boot.js";
import { randomUUID } from "node:crypto";

interface EnvironmentInfo {
  id: string;
  displayName: string;
}

interface AgentInfo {
  id: string;
  name: string;
  environmentId: string;
}

let handlers: ReturnType<typeof getHandlers>;
let unsubAgentRoot: (() => void) | undefined;

beforeAll(() => {
  initTestDatabase();
  handlers = getHandlers();

  // Wire the agent-root-task subscriber against the real event bus.
  // In production this is wired in server/src/event-subscribers.ts; the
  // plugin-core integration harness doesn't include that wiring, so we
  // do it here to exercise the full createAgent → root-task path.
  const disposable = createAgentRootTaskSubscriber(
    { subscribe, emit: () => {} },
    {
      getAgent: agentStore.getAgent,
      getRootTaskForAgent: taskStore.getRootTaskForAgent,
      insertTask: taskStore.insertTask,
      newId: () => randomUUID(),
    },
  );
  unsubAgentRoot = (): void => disposable.dispose();
});

beforeEach(() => {
  // No global reset — agent rows are uniquely named per test to avoid collisions.
});

afterAll(() => {
  unsubAgentRoot?.();
});

async function createEnv(displayName: string): Promise<string> {
  const response = (await handlers.addEnvironment({
    displayName,
    adapterType: "local",
    adapterConfig: "{}",
  })) as EnvironmentInfo;
  return response.id;
}

async function createAgent(name: string, environmentId: string): Promise<AgentInfo> {
  return (await handlers.createAgent({
    name,
    avatar: "",
    primaryPersonaId: "",
    environmentId,
  })) as AgentInfo;
}

describe("Agent task ownership (#1418) — real-DB integration", () => {
  it("createAgent auto-creates a kind=root task via the subscriber", async () => {
    const envId = await createEnv("auto-root-env");
    const agent = await createAgent("AutoRootBot", envId);

    // Wait a microtask cycle for the queued-microtask subscriber dispatch.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const root = taskStore.getRootTaskForAgent(agent.id);
    expect(root).toBeDefined();
    expect(root!.kind).toBe("root");
    expect(root!.agentId).toBe(agent.id);
    expect(root!.parentTaskId).toBe("");
    expect(root!.depth).toBe(0);
    expect(root!.canDecompose).toBe(true);
    expect(root!.title).toBe("AutoRootBot");
  });

  it("deleteAgent cascades through a non-empty subtree with real FK constraints", async () => {
    const envId = await createEnv("cascade-env");
    const agent = await createAgent("CascadeBot", envId);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const root = taskStore.getRootTaskForAgent(agent.id)!;

    // Manually add a child task under the agent root (#1438/#1439 will do
    // this via wake-up surfaces; for now we're just proving the cascade
    // shape works against real SQLite).
    const childId = randomUUID();
    taskStore.insertTask({
      id: childId,
      workspaceId: undefined,
      title: "child of cascade",
      description: "",
      branch: "",
      dependsOn: [],
      parentTaskId: root.id,
      depth: 1,
      canDecompose: false,
      injectKnowledge: false,
      defaultPersonaId: "",
      tokenBudget: 0,
      costBudgetMillicents: 0,
      agentId: agent.id,
      kind: "schedule_fire",
    });

    // Real session row referencing the child task — this is what gets the
    // sessions.task_id FK involved. If the cascade doesn't handle this
    // correctly the deleteTask call below will throw a FK error.
    const sessionId = `cascade-sess-${randomUUID().slice(0, 8)}`;
    sessionStore.createSession(
      sessionId,
      envId,
      "claude-code",
      "test prompt",
      "sonnet",
      "/tmp/log",
      childId,
      "",
      "",
    );

    // Sanity: the rows exist before delete.
    expect(taskStore.getTask(root.id)).toBeDefined();
    expect(taskStore.getTask(childId)).toBeDefined();
    expect(sessionStore.getSession(sessionId)).toBeDefined();
    expect(agentStore.getAgent(agent.id)).toBeDefined();

    // The real test: deleteAgent shouldn't throw FK errors and should
    // leave the DB consistent.
    await handlers.deleteAgent({ id: agent.id });

    // Agent gone.
    expect(agentStore.getAgent(agent.id)).toBeUndefined();
    // Root + child tasks gone.
    expect(taskStore.getTask(root.id)).toBeUndefined();
    expect(taskStore.getTask(childId)).toBeUndefined();
    // No tasks left attributed to this agent.
    expect(taskStore.getTasksForAgent(agent.id)).toEqual([]);
    // Session was force-stopped by killSessionAndCleanup (status =
    // SESSION_STATUS.STOPPED). Note: sessionStore.deleteByEnvironment isn't
    // called by deleteAgent — we only force-stop the session, not delete
    // its row, so the session row may still exist with a terminal status.
    // (Stopping is enough — the runtime is no longer ticking.)
    const sessionAfter = sessionStore.getSession(sessionId);
    if (sessionAfter) {
      expect(sessionAfter.status).toBe("stopped");
    }
  });

  it("deleteAgent on agent with only a root task (no child work) is a clean cascade", async () => {
    const envId = await createEnv("lonely-env");
    const agent = await createAgent("LonelyBot", envId);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const root = taskStore.getRootTaskForAgent(agent.id)!;
    expect(taskStore.getTasksForAgent(agent.id)).toHaveLength(1);

    await handlers.deleteAgent({ id: agent.id });

    expect(agentStore.getAgent(agent.id)).toBeUndefined();
    expect(taskStore.getTask(root.id)).toBeUndefined();
  });

  it("multiple agents on the same env are independent — deleting one leaves the other intact", async () => {
    const envId = await createEnv("multi-env");
    const a1 = await createAgent("MultiBot1", envId);
    const a2 = await createAgent("MultiBot2", envId);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const root1 = taskStore.getRootTaskForAgent(a1.id)!;
    const root2 = taskStore.getRootTaskForAgent(a2.id)!;

    await handlers.deleteAgent({ id: a1.id });

    expect(agentStore.getAgent(a1.id)).toBeUndefined();
    expect(taskStore.getTask(root1.id)).toBeUndefined();

    expect(agentStore.getAgent(a2.id)).toBeDefined();
    expect(taskStore.getTask(root2.id)).toBeDefined();
    expect(taskStore.getRootTaskForAgent(a2.id)).toBeDefined();
  });
});
