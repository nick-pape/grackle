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
  createSigchldSubscriber: vi.fn(() => ({ dispose: vi.fn() })),
  createEscalationAutoSubscriber: vi.fn(() => ({ dispose: vi.fn() })),
  createOrphanReparentSubscriber: vi.fn(() => ({ dispose: vi.fn() })),
  createLifecycleSubscriber: vi.fn(() => ({ dispose: vi.fn() })),
  createRootTaskBootSubscriber: vi.fn(() => mockDisposable),
}));

vi.mock("@grackle-ai/database", () => ({
  taskStore: { getTask: vi.fn() },
  sessionStore: { listSessionsForTask: vi.fn(), getLatestSessionForTask: vi.fn() },
  settingsStore: { getSetting: vi.fn() },
}));

import { wireEventSubscribers } from "./event-subscribers.js";
import {
  createSigchldSubscriber, createEscalationAutoSubscriber,
  createOrphanReparentSubscriber, createLifecycleSubscriber,
} from "@grackle-ai/plugin-core";

beforeEach(() => {
  vi.clearAllMocks();
  mockDisposable.dispose.mockClear();
});

describe("wireEventSubscribers", () => {
  it("calls createSigchldSubscriber with PluginContext", () => {
    wireEventSubscribers({ skipRootAutostart: true });
    expect(createSigchldSubscriber).toHaveBeenCalledOnce();
    expect(createSigchldSubscriber).toHaveBeenCalledWith(
      expect.objectContaining({ subscribe: expect.any(Function), emit: expect.any(Function) }),
    );
  });

  it("calls createEscalationAutoSubscriber with PluginContext", () => {
    wireEventSubscribers({ skipRootAutostart: true });
    expect(createEscalationAutoSubscriber).toHaveBeenCalledOnce();
  });

  it("calls createOrphanReparentSubscriber with PluginContext", () => {
    wireEventSubscribers({ skipRootAutostart: true });
    expect(createOrphanReparentSubscriber).toHaveBeenCalledOnce();
  });

  it("calls createLifecycleSubscriber with PluginContext", () => {
    wireEventSubscribers({ skipRootAutostart: true });
    expect(createLifecycleSubscriber).toHaveBeenCalledOnce();
  });

  it("returns Disposable array", () => {
    const disposables = wireEventSubscribers({ skipRootAutostart: true });
    expect(disposables).toHaveLength(4);
    for (const d of disposables) {
      expect(d).toHaveProperty("dispose");
    }
  });

  it("does not include root task boot when skipRootAutostart is true", () => {
    const disposables = wireEventSubscribers({ skipRootAutostart: true });
    expect(disposables).toHaveLength(4);
  });

  it("includes root task boot when skipRootAutostart is false", () => {
    const disposables = wireEventSubscribers({ skipRootAutostart: false });
    expect(disposables).toHaveLength(5);
  });
});
