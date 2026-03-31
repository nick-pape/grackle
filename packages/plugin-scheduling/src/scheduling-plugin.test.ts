import { describe, it, expect, vi } from "vitest";
import type { PluginContext } from "@grackle-ai/plugin-sdk";
import type { Logger } from "pino";

// Mock database stores (scheduling plugin reads from them directly)
vi.mock("@grackle-ai/database", () => ({
  scheduleStore: {
    getDueSchedules: vi.fn(),
    advanceSchedule: vi.fn(),
    setScheduleEnabled: vi.fn(),
  },
  taskStore: {
    createTask: vi.fn(),
    setTaskScheduleId: vi.fn(),
  },
  personaStore: {
    getPersona: vi.fn(),
  },
  dispatchQueueStore: {
    enqueue: vi.fn(),
  },
}));

vi.mock("@grackle-ai/common", () => ({
  grackle: { GrackleScheduling: { typeName: "grackle.GrackleScheduling" } },
}));

import { createSchedulingPlugin } from "./scheduling-plugin.js";

/** Create a minimal mock PluginContext for testing. */
function createMockContext(): PluginContext {
  return {
    subscribe: vi.fn(() => vi.fn()),
    emit: vi.fn() as PluginContext["emit"],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger,
    config: {
      grpcPort: 7434,
      webPort: 3000,
      mcpPort: 7435,
      powerlinePort: 7433,
      host: "127.0.0.1",
      grackleHome: "/tmp/grackle",
      apiKey: "test-key",
      skipRootAutostart: true,
    },
  };
}

describe("createSchedulingPlugin", () => {
  it("returns name 'scheduling'", () => {
    const plugin = createSchedulingPlugin();
    expect(plugin.name).toBe("scheduling");
  });

  it("declares dependency on 'core'", () => {
    const plugin = createSchedulingPlugin();
    expect(plugin.dependencies).toEqual(["core"]);
  });

  it("grpcHandlers returns 1 ServiceRegistration on grackle.GrackleScheduling", () => {
    const plugin = createSchedulingPlugin();
    const ctx = createMockContext();
    const registrations = plugin.grpcHandlers!(ctx);

    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.service).toHaveProperty("typeName", "grackle.GrackleScheduling");
  });

  it("grpcHandlers registration includes all 5 schedule methods", () => {
    const plugin = createSchedulingPlugin();
    const ctx = createMockContext();
    const registrations = plugin.grpcHandlers!(ctx);
    const handlers = registrations[0]!.handlers;

    expect(handlers).toHaveProperty("createSchedule");
    expect(handlers).toHaveProperty("listSchedules");
    expect(handlers).toHaveProperty("getSchedule");
    expect(handlers).toHaveProperty("updateSchedule");
    expect(handlers).toHaveProperty("deleteSchedule");
  });

  it("reconciliationPhases returns exactly 1 phase", () => {
    const plugin = createSchedulingPlugin();
    const ctx = createMockContext();
    const phases = plugin.reconciliationPhases!(ctx);
    expect(phases).toHaveLength(1);
  });

  it("reconciliationPhases includes 'cron' phase", () => {
    const plugin = createSchedulingPlugin();
    const ctx = createMockContext();
    const phases = plugin.reconciliationPhases!(ctx);
    expect(phases[0]!.name).toBe("cron");
  });

  it("has no eventSubscribers", () => {
    const plugin = createSchedulingPlugin();
    expect(plugin.eventSubscribers).toBeUndefined();
  });

  it("has no mcpTools", () => {
    const plugin = createSchedulingPlugin();
    expect(plugin.mcpTools).toBeUndefined();
  });
});
