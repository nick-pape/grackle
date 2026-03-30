import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies before importing ──────────────

const mockBootFn = vi.fn(async () => {});

vi.mock("@grackle-ai/core", () => ({
  initSigchldSubscriber: vi.fn(),
  initEscalationAutoSubscriber: vi.fn(),
  initOrphanReparentSubscriber: vi.fn(),
  initLifecycleManager: vi.fn(),
  createRootTaskBoot: vi.fn(() => mockBootFn),
  subscribe: vi.fn(),
  computeTaskStatus: vi.fn(),
  findFirstConnectedEnvironment: vi.fn(),
  startTaskSession: vi.fn(),
  reanimateAgent: vi.fn(),
}));

vi.mock("@grackle-ai/database", () => ({
  taskStore: { getTask: vi.fn() },
  sessionStore: { listSessionsForTask: vi.fn(), getLatestSessionForTask: vi.fn() },
  settingsStore: { getSetting: vi.fn() },
}));

import { wireEventSubscribers } from "./event-subscribers.js";
import {
  initSigchldSubscriber, initEscalationAutoSubscriber,
  initOrphanReparentSubscriber, initLifecycleManager,
  createRootTaskBoot, subscribe,
} from "@grackle-ai/core";

beforeEach(() => {
  vi.clearAllMocks();
  mockBootFn.mockClear();
});

describe("wireEventSubscribers", () => {
  it("calls initSigchldSubscriber", () => {
    wireEventSubscribers({ skipRootAutostart: true });
    expect(initSigchldSubscriber).toHaveBeenCalledOnce();
  });

  it("calls initEscalationAutoSubscriber", () => {
    wireEventSubscribers({ skipRootAutostart: true });
    expect(initEscalationAutoSubscriber).toHaveBeenCalledOnce();
  });

  it("calls initOrphanReparentSubscriber", () => {
    wireEventSubscribers({ skipRootAutostart: true });
    expect(initOrphanReparentSubscriber).toHaveBeenCalledOnce();
  });

  it("calls initLifecycleManager", () => {
    wireEventSubscribers({ skipRootAutostart: true });
    expect(initLifecycleManager).toHaveBeenCalledOnce();
  });

  it("does not create root task boot when skipRootAutostart is true", () => {
    wireEventSubscribers({ skipRootAutostart: true });
    expect(createRootTaskBoot).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("wires root task boot to environment.changed when skipRootAutostart is false", () => {
    wireEventSubscribers({ skipRootAutostart: false });
    expect(createRootTaskBoot).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();

    // Get the subscriber callback and trigger environment.changed
    const subscriberFn = (subscribe as ReturnType<typeof vi.fn>).mock.calls[0][0] as
      (event: { type: string; payload?: unknown }) => void;
    subscriberFn({ type: "environment.changed" });
    expect(mockBootFn).toHaveBeenCalledOnce();
  });

  it("wires root task boot to setting.changed (onboarding_completed)", () => {
    wireEventSubscribers({ skipRootAutostart: false });

    const subscriberFn = (subscribe as ReturnType<typeof vi.fn>).mock.calls[0][0] as
      (event: { type: string; payload?: unknown }) => void;
    subscriberFn({
      type: "setting.changed",
      payload: { key: "onboarding_completed", value: "true" },
    });
    expect(mockBootFn).toHaveBeenCalledOnce();
  });

  it("does not trigger boot on irrelevant setting.changed events", () => {
    wireEventSubscribers({ skipRootAutostart: false });

    const subscriberFn = (subscribe as ReturnType<typeof vi.fn>).mock.calls[0][0] as
      (event: { type: string; payload?: unknown }) => void;

    subscriberFn({
      type: "setting.changed",
      payload: { key: "theme", value: "dark" },
    });
    expect(mockBootFn).not.toHaveBeenCalled();
  });

  it("does not trigger boot on unrelated event types", () => {
    wireEventSubscribers({ skipRootAutostart: false });

    const subscriberFn = (subscribe as ReturnType<typeof vi.fn>).mock.calls[0][0] as
      (event: { type: string; payload?: unknown }) => void;

    subscriberFn({ type: "task.updated" });
    expect(mockBootFn).not.toHaveBeenCalled();
  });
});
