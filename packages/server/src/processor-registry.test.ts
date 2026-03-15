import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as registry from "./processor-registry.js";
import type { ProcessorContext } from "./processor-registry.js";

function makeContext(overrides?: Partial<ProcessorContext>): ProcessorContext {
  return {
    sessionId: "sess1",
    logPath: "/tmp/log",
    projectId: "",
    taskId: "",
    ...overrides,
  };
}

describe("processor-registry", () => {
  beforeEach(() => {
    // Clean up any registered contexts from previous tests
    registry.unregister("sess1");
    registry.unregister("sess2");
  });

  it("registers and retrieves a context", () => {
    const ctx = makeContext();
    registry.register(ctx);
    expect(registry.get("sess1")).toBe(ctx);
  });

  it("returns undefined for unregistered session", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("unregisters a context", () => {
    const ctx = makeContext();
    registry.register(ctx);
    registry.unregister("sess1");
    expect(registry.get("sess1")).toBeUndefined();
  });

  it("lateBind updates context fields", () => {
    const ctx = makeContext();
    registry.register(ctx);

    registry.lateBind("sess1", "task1", "proj1");

    expect(ctx.taskId).toBe("task1");
    expect(ctx.projectId).toBe("proj1");
  });

  it("lateBind is idempotent for same task", () => {
    const ctx = makeContext();
    registry.register(ctx);

    registry.lateBind("sess1", "task1", "proj1");
    // Should not throw
    registry.lateBind("sess1", "task1", "proj1");
    expect(ctx.taskId).toBe("task1");
  });

  it("lateBind rejects binding to a different task", () => {
    const ctx = makeContext();
    registry.register(ctx);

    registry.lateBind("sess1", "task1", "proj1");
    expect(() => registry.lateBind("sess1", "task2", "proj1")).toThrow(
      "Session sess1 is already bound to task task1, cannot rebind to task2",
    );
  });

  it("lateBind throws for unregistered session", () => {
    expect(() => registry.lateBind("nonexistent", "task1", "proj1")).toThrow(
      "No active event processor for session nonexistent",
    );
  });

  it("lateBind fires bind listeners", () => {
    const ctx = makeContext();
    registry.register(ctx);

    const listener = vi.fn();
    registry.onBind("sess1", listener);

    registry.lateBind("sess1", "task1", "proj1");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("lateBind fires multiple bind listeners", () => {
    const ctx = makeContext();
    registry.register(ctx);

    const listener1 = vi.fn();
    const listener2 = vi.fn();
    registry.onBind("sess1", listener1);
    registry.onBind("sess1", listener2);

    registry.lateBind("sess1", "task1", "proj1");
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it("idempotent lateBind does not fire listeners", () => {
    const ctx = makeContext();
    registry.register(ctx);

    registry.lateBind("sess1", "task1", "proj1");

    const listener = vi.fn();
    registry.onBind("sess1", listener);

    // Second bind to same task should be no-op
    registry.lateBind("sess1", "task1", "proj1");
    expect(listener).not.toHaveBeenCalled();
  });

  it("unregister cleans up bind listeners", () => {
    const ctx = makeContext();
    registry.register(ctx);

    const listener = vi.fn();
    registry.onBind("sess1", listener);

    registry.unregister("sess1");

    // Re-register and lateBind — old listener should not fire
    const ctx2 = makeContext();
    registry.register(ctx2);
    registry.lateBind("sess1", "task1", "proj1");
    expect(listener).not.toHaveBeenCalled();
  });
});
