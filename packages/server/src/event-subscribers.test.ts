import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies before importing ──────────────

const mockDisposable = { dispose: vi.fn() };

vi.mock("@grackle-ai/core", () => ({
  subscribe: vi.fn(() => vi.fn()),
  emit: vi.fn(),
  computeTaskStatus: vi.fn(),
  findFirstConnectedEnvironment: vi.fn(),
  startTaskSession: vi.fn(),
  reanimateAgent: vi.fn(),
}));

vi.mock("@grackle-ai/plugin-core", () => ({
  createLifecycleSubscriber: vi.fn(() => ({ dispose: vi.fn() })),
  createRootTaskBootSubscriber: vi.fn(() => mockDisposable),
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

import { wireEventSubscribers } from "./event-subscribers.js";
import { createLifecycleSubscriber } from "@grackle-ai/plugin-core";

beforeEach(() => {
  vi.clearAllMocks();
  mockDisposable.dispose.mockClear();
});

describe("wireEventSubscribers (core-only)", () => {
  it("calls createLifecycleSubscriber with PluginContext", () => {
    wireEventSubscribers({ skipRootAutostart: true });
    expect(createLifecycleSubscriber).toHaveBeenCalledOnce();
    expect(createLifecycleSubscriber).toHaveBeenCalledWith(
      expect.objectContaining({ subscribe: expect.any(Function), emit: expect.any(Function) }),
    );
  });

  it("returns lifecycle + agent-root subscribers when skipRootAutostart is true", () => {
    // #1418: the agent-root-task subscriber runs regardless of the system
    // root-task autostart flag (those are independent concerns), so we get
    // 2 disposables here: lifecycle + agent-root.
    const disposables = wireEventSubscribers({ skipRootAutostart: true });
    expect(disposables).toHaveLength(2);
    expect(disposables[0]).toHaveProperty("dispose");
  });

  it("includes root task boot when skipRootAutostart is false", () => {
    // 3 disposables: lifecycle + system-root-boot + agent-root.
    const disposables = wireEventSubscribers({ skipRootAutostart: false });
    expect(disposables).toHaveLength(3);
  });
});
