import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PluginContext } from "@grackle-ai/plugin-sdk";

// ── Mock dependencies before importing ──────────────

vi.mock("@grackle-ai/core", () => ({
  computeTaskStatus: vi.fn(),
  findFirstConnectedEnvironment: vi.fn(),
  startTaskSession: vi.fn(),
  reanimateAgent: vi.fn(),
}));

vi.mock("@grackle-ai/plugin-core", () => ({
  createLifecycleSubscriber: vi.fn(() => ({ dispose: vi.fn() })),
  createRootTaskBootSubscriber: vi.fn(() => ({ dispose: vi.fn() })),
  createAgentRootTaskSubscriber: vi.fn(() => ({ dispose: vi.fn() })),
}));

vi.mock("@grackle-ai/database", () => ({
  agentStore: { getAgent: vi.fn() },
  taskStore: {
    getTask: vi.fn(),
    getRootTaskForAgent: vi.fn(),
    insertTask: vi.fn(),
  },
  sessionStore: { listSessionsForTask: vi.fn(), getLatestSessionForTask: vi.fn() },
  settingsStore: { getSetting: vi.fn() },
}));

import { createEventSubscribers } from "./event-subscribers.js";
import { createLifecycleSubscriber } from "@grackle-ai/plugin-core";

/** Create a mock PluginContext for testing. */
function createMockContext(overrides?: Partial<PluginContext["config"]>): PluginContext {
  return {
    subscribe: vi.fn(() => vi.fn()),
    emit: vi.fn() as PluginContext["emit"],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as PluginContext["logger"],
    config: {
      grpcPort: 0,
      webPort: 0,
      mcpPort: 0,
      powerlinePort: 0,
      host: "127.0.0.1",
      grackleHome: "/tmp/test",
      apiKey: "test-key",
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createEventSubscribers", () => {
  it("calls createLifecycleSubscriber with PluginContext", () => {
    createEventSubscribers(createMockContext({ skipRootAutostart: true }));
    expect(createLifecycleSubscriber).toHaveBeenCalledOnce();
    expect(createLifecycleSubscriber).toHaveBeenCalledWith(
      expect.objectContaining({ subscribe: expect.any(Function), emit: expect.any(Function) }),
    );
  });

  it("returns lifecycle + agent-root subscribers when skipRootAutostart is true", () => {
    const disposables = createEventSubscribers(createMockContext({ skipRootAutostart: true }));
    expect(disposables).toHaveLength(2);
    expect(disposables[0]).toHaveProperty("dispose");
  });

  it("includes root task boot when skipRootAutostart is false", () => {
    const disposables = createEventSubscribers(createMockContext({ skipRootAutostart: false }));
    expect(disposables).toHaveLength(3);
  });
});
