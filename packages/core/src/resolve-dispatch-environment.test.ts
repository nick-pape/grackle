import { describe, it, expect, vi } from "vitest";

import { resolveDispatchEnvironment, type ResolveEnvironmentDeps } from "./resolve-dispatch-environment.js";

function createMockDeps(overrides: Partial<ResolveEnvironmentDeps> = {}): ResolveEnvironmentDeps {
  return {
    resolveAncestorEnvironmentId: vi.fn().mockReturnValue(""),
    getWorkspace: vi.fn().mockReturnValue(undefined),
    getLinkedEnvironmentIds: vi.fn().mockReturnValue([]),
    isEnvironmentConnected: vi.fn().mockReturnValue(false),
    countActiveForEnvironment: vi.fn().mockReturnValue(0),
    findFirstConnectedEnvironment: vi.fn().mockReturnValue(undefined),
    ...overrides,
  };
}

const task = { workspaceId: "ws-1", parentTaskId: "parent-1" };

describe("resolveDispatchEnvironment", () => {
  it("returns ancestor env when parent chain has a session", () => {
    const deps = createMockDeps({
      resolveAncestorEnvironmentId: vi.fn().mockReturnValue("ancestor-env"),
      isEnvironmentConnected: vi.fn().mockReturnValue(true),
    });

    expect(resolveDispatchEnvironment(task, deps)).toBe("ancestor-env");
    // Should not check workspace or global fallback
    expect(deps.getWorkspace).not.toHaveBeenCalled();
    expect(deps.findFirstConnectedEnvironment).not.toHaveBeenCalled();
  });

  it("skips disconnected ancestor env", () => {
    const deps = createMockDeps({
      resolveAncestorEnvironmentId: vi.fn().mockReturnValue("ancestor-env"),
      isEnvironmentConnected: vi.fn((id) => id !== "ancestor-env"),
      getWorkspace: vi.fn().mockReturnValue({ environmentId: "ws-env" }),
    });

    // ancestor-env is disconnected, should fall through to workspace
    const result = resolveDispatchEnvironment(task, deps);
    expect(result).toBe("ws-env");
  });

  it("returns workspace legacy env when connected", () => {
    const deps = createMockDeps({
      getWorkspace: vi.fn().mockReturnValue({ environmentId: "ws-env" }),
      isEnvironmentConnected: vi.fn().mockReturnValue(true),
    });

    expect(resolveDispatchEnvironment(task, deps)).toBe("ws-env");
  });

  it("skips disconnected workspace legacy env", () => {
    const deps = createMockDeps({
      getWorkspace: vi.fn().mockReturnValue({ environmentId: "ws-env" }),
      isEnvironmentConnected: vi.fn((id) => id !== "ws-env"),
      getLinkedEnvironmentIds: vi.fn().mockReturnValue(["linked-1"]),
    });

    // ws-env disconnected, linked-1 should be checked
    // but linked-1 is also disconnected by default mock
    expect(resolveDispatchEnvironment(task, deps)).toBeUndefined();
  });

  it("returns linked env with fewest active sessions (load balancing)", () => {
    const deps = createMockDeps({
      getWorkspace: vi.fn().mockReturnValue({ environmentId: "" }),
      getLinkedEnvironmentIds: vi.fn().mockReturnValue(["env-a", "env-b", "env-c"]),
      isEnvironmentConnected: vi.fn().mockReturnValue(true),
      countActiveForEnvironment: vi.fn((id: string) => {
        if (id === "env-a") { return 3; }
        if (id === "env-b") { return 0; }
        if (id === "env-c") { return 1; }
        return 0;
      }),
    });

    expect(resolveDispatchEnvironment(task, deps)).toBe("env-b");
  });

  it("skips disconnected linked envs", () => {
    const deps = createMockDeps({
      getWorkspace: vi.fn().mockReturnValue({ environmentId: "" }),
      getLinkedEnvironmentIds: vi.fn().mockReturnValue(["env-a", "env-b"]),
      isEnvironmentConnected: vi.fn((id: string) => id === "env-b"),
      countActiveForEnvironment: vi.fn().mockReturnValue(0),
    });

    expect(resolveDispatchEnvironment(task, deps)).toBe("env-b");
  });

  it("falls through to global findFirstConnectedEnvironment", () => {
    const deps = createMockDeps({
      findFirstConnectedEnvironment: vi.fn().mockReturnValue({ id: "global-env" }),
    });

    expect(resolveDispatchEnvironment(task, deps)).toBe("global-env");
  });

  it("returns undefined when no env available anywhere", () => {
    const deps = createMockDeps();

    expect(resolveDispatchEnvironment(task, deps)).toBeUndefined();
  });

  it("handles task with no workspaceId — skips workspace steps", () => {
    const noWsTask = { workspaceId: null, parentTaskId: "" };
    const deps = createMockDeps({
      findFirstConnectedEnvironment: vi.fn().mockReturnValue({ id: "global-env" }),
    });

    const result = resolveDispatchEnvironment(noWsTask, deps);
    expect(result).toBe("global-env");
    // Should not look up workspace or linked envs
    expect(deps.getWorkspace).not.toHaveBeenCalled();
    expect(deps.getLinkedEnvironmentIds).not.toHaveBeenCalled();
  });

  it("handles workspace with no legacy env and no linked envs", () => {
    const deps = createMockDeps({
      getWorkspace: vi.fn().mockReturnValue({ environmentId: "" }),
      getLinkedEnvironmentIds: vi.fn().mockReturnValue([]),
      findFirstConnectedEnvironment: vi.fn().mockReturnValue({ id: "fallback" }),
    });

    expect(resolveDispatchEnvironment(task, deps)).toBe("fallback");
  });

  it("does not call ancestor resolution when parentTaskId is empty", () => {
    const noParentTask = { workspaceId: "ws-1", parentTaskId: "" };
    const deps = createMockDeps({
      findFirstConnectedEnvironment: vi.fn().mockReturnValue({ id: "global-env" }),
    });

    const result = resolveDispatchEnvironment(noParentTask, deps);
    expect(result).toBe("global-env");
    expect(deps.resolveAncestorEnvironmentId).not.toHaveBeenCalled();
  });
});
