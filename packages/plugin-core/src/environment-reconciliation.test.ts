import { describe, it, expect, vi } from "vitest";
import {
  createEnvironmentReconciliationPhase,
  type EnvironmentReconciliationDeps,
} from "./environment-reconciliation.js";

vi.mock("@grackle-ai/core", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

function makeDeps(overrides?: Partial<EnvironmentReconciliationDeps>): EnvironmentReconciliationDeps {
  return {
    listEnvironments: vi.fn(() => []),
    listConnectionIds: vi.fn(() => new Set<string>()),
    updateEnvironmentStatus: vi.fn(),
    removeConnection: vi.fn(),
    emit: vi.fn(),
    ...overrides,
  };
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    id: "env-1",
    displayName: "Test Env",
    adapterType: "local",
    adapterConfig: "{}",
    defaultRuntime: "claude-code",
    bootstrapped: true,
    status: "disconnected",
    lastSeen: null,
    envInfo: null,
    createdAt: "2026-03-25T09:00:00Z",
    powerlineToken: "abc",
    maxConcurrentSessions: 0,
    ...overrides,
  };
}

describe("environment status reconciliation phase", () => {
  it("no-op when in sync (connected + has connection)", async () => {
    const deps = makeDeps({
      listEnvironments: vi.fn(() => [makeEnv({ id: "env-1", status: "connected" })] as never),
      listConnectionIds: vi.fn(() => new Set(["env-1"])),
    });

    const phase = createEnvironmentReconciliationPhase(deps);
    await phase.execute();

    expect(deps.updateEnvironmentStatus).not.toHaveBeenCalled();
    expect(deps.removeConnection).not.toHaveBeenCalled();
    expect(deps.emit).not.toHaveBeenCalled();
  });

  it("no-op when all disconnected and no connections", async () => {
    const deps = makeDeps({
      listEnvironments: vi.fn(() => [makeEnv({ id: "env-1", status: "disconnected" })] as never),
      listConnectionIds: vi.fn(() => new Set()),
    });

    const phase = createEnvironmentReconciliationPhase(deps);
    await phase.execute();

    expect(deps.updateEnvironmentStatus).not.toHaveBeenCalled();
    expect(deps.removeConnection).not.toHaveBeenCalled();
    expect(deps.emit).not.toHaveBeenCalled();
  });

  it("forward drift: DB says connected but no connection in memory", async () => {
    const deps = makeDeps({
      listEnvironments: vi.fn(() => [makeEnv({ id: "env-1", status: "connected" })] as never),
      listConnectionIds: vi.fn(() => new Set()),
    });

    const phase = createEnvironmentReconciliationPhase(deps);
    await phase.execute();

    expect(deps.updateEnvironmentStatus).toHaveBeenCalledWith("env-1", "disconnected");
    expect(deps.emit).toHaveBeenCalledWith("environment.changed", {});
  });

  it("does not touch connecting status (in-progress provisioning)", async () => {
    const deps = makeDeps({
      listEnvironments: vi.fn(() => [makeEnv({ id: "env-1", status: "connecting" })] as never),
      listConnectionIds: vi.fn(() => new Set()),
    });

    const phase = createEnvironmentReconciliationPhase(deps);
    await phase.execute();

    expect(deps.updateEnvironmentStatus).not.toHaveBeenCalled();
    expect(deps.removeConnection).not.toHaveBeenCalled();
    expect(deps.emit).not.toHaveBeenCalled();
  });

  it("reverse drift: connection exists but DB says disconnected", async () => {
    const deps = makeDeps({
      listEnvironments: vi.fn(() => [makeEnv({ id: "env-1", status: "disconnected" })] as never),
      listConnectionIds: vi.fn(() => new Set(["env-1"])),
    });

    const phase = createEnvironmentReconciliationPhase(deps);
    await phase.execute();

    expect(deps.removeConnection).toHaveBeenCalledWith("env-1");
  });

  it("reverse drift: connection exists but DB says sleeping", async () => {
    const deps = makeDeps({
      listEnvironments: vi.fn(() => [makeEnv({ id: "env-1", status: "sleeping" })] as never),
      listConnectionIds: vi.fn(() => new Set(["env-1"])),
    });

    const phase = createEnvironmentReconciliationPhase(deps);
    await phase.execute();

    expect(deps.removeConnection).toHaveBeenCalledWith("env-1");
  });

  it("does not touch error status environments without connection", async () => {
    const deps = makeDeps({
      listEnvironments: vi.fn(() => [makeEnv({ id: "env-1", status: "error" })] as never),
      listConnectionIds: vi.fn(() => new Set()),
    });

    const phase = createEnvironmentReconciliationPhase(deps);
    await phase.execute();

    expect(deps.updateEnvironmentStatus).not.toHaveBeenCalled();
    expect(deps.removeConnection).not.toHaveBeenCalled();
    expect(deps.emit).not.toHaveBeenCalled();
  });

  it("does not touch error status environments with connection", async () => {
    const deps = makeDeps({
      listEnvironments: vi.fn(() => [makeEnv({ id: "env-1", status: "error" })] as never),
      listConnectionIds: vi.fn(() => new Set(["env-1"])),
    });

    const phase = createEnvironmentReconciliationPhase(deps);
    await phase.execute();

    expect(deps.updateEnvironmentStatus).not.toHaveBeenCalled();
    expect(deps.removeConnection).not.toHaveBeenCalled();
    expect(deps.emit).not.toHaveBeenCalled();
  });

  it("handles mixed drift across multiple environments", async () => {
    const deps = makeDeps({
      listEnvironments: vi.fn(() => [
        makeEnv({ id: "env-1", status: "connected" }),  // forward drift: no connection
        makeEnv({ id: "env-2", status: "disconnected" }), // reverse drift: has connection
        makeEnv({ id: "env-3", status: "connected" }),  // in sync: has connection
      ] as never),
      listConnectionIds: vi.fn(() => new Set(["env-2", "env-3"])),
    });

    const phase = createEnvironmentReconciliationPhase(deps);
    await phase.execute();

    // Forward drift fix for env-1
    expect(deps.updateEnvironmentStatus).toHaveBeenCalledWith("env-1", "disconnected");
    expect(deps.emit).toHaveBeenCalledWith("environment.changed", {});
    // Reverse drift fix for env-2
    expect(deps.removeConnection).toHaveBeenCalledWith("env-2");
    // env-3 untouched
    expect(deps.updateEnvironmentStatus).toHaveBeenCalledTimes(1);
    expect(deps.removeConnection).toHaveBeenCalledTimes(1);
  });

  it("handles empty environment list without error", async () => {
    const deps = makeDeps();
    const phase = createEnvironmentReconciliationPhase(deps);
    await phase.execute();

    expect(deps.updateEnvironmentStatus).not.toHaveBeenCalled();
    expect(deps.removeConnection).not.toHaveBeenCalled();
  });

  it("continues after individual forward drift failure", async () => {
    const deps = makeDeps({
      listEnvironments: vi.fn(() => [
        makeEnv({ id: "env-1", status: "connected" }),
        makeEnv({ id: "env-2", status: "connected" }),
      ] as never),
      listConnectionIds: vi.fn(() => new Set()),
      updateEnvironmentStatus: vi.fn()
        .mockImplementationOnce(() => { throw new Error("DB locked"); })
        .mockImplementationOnce(() => {}),
    });

    const phase = createEnvironmentReconciliationPhase(deps);
    await phase.execute();

    expect(deps.updateEnvironmentStatus).toHaveBeenCalledTimes(2);
  });

  it("continues after individual reverse drift failure", async () => {
    const deps = makeDeps({
      listEnvironments: vi.fn(() => [
        makeEnv({ id: "env-1", status: "disconnected" }),
        makeEnv({ id: "env-2", status: "disconnected" }),
      ] as never),
      listConnectionIds: vi.fn(() => new Set(["env-1", "env-2"])),
      removeConnection: vi.fn()
        .mockImplementationOnce(() => { throw new Error("unexpected"); })
        .mockImplementationOnce(() => {}),
    });

    const phase = createEnvironmentReconciliationPhase(deps);
    await phase.execute();

    expect(deps.removeConnection).toHaveBeenCalledTimes(2);
  });

  it("logs warning with count when drift is fixed", async () => {
    const { logger } = await import("@grackle-ai/core");
    const deps = makeDeps({
      listEnvironments: vi.fn(() => [makeEnv({ id: "env-1", status: "connected" })] as never),
      listConnectionIds: vi.fn(() => new Set()),
    });

    const phase = createEnvironmentReconciliationPhase(deps);
    await phase.execute();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ fixedCount: 1 }),
      expect.stringContaining("fixed"),
      1,
    );
  });

  it("does not log warning when no drift detected", async () => {
    const { logger } = await import("@grackle-ai/core");
    vi.mocked(logger.warn).mockClear();

    const deps = makeDeps({
      listEnvironments: vi.fn(() => [makeEnv({ id: "env-1", status: "connected" })] as never),
      listConnectionIds: vi.fn(() => new Set(["env-1"])),
    });

    const phase = createEnvironmentReconciliationPhase(deps);
    await phase.execute();

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
