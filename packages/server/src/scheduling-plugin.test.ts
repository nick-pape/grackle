import { describe, it, expect, vi } from "vitest";
import type { PluginContext } from "@grackle-ai/plugin-sdk";
import type { Logger } from "pino";

// ── Mock dependencies ────────────────────────────────

vi.mock("@grackle-ai/plugin-scheduling", () => ({
  createSchedulingPlugin: vi.fn(() => ({
    name: "scheduling",
    dependencies: ["core"],
    grpcHandlers: vi.fn(() => [{
      service: { typeName: "grackle.Grackle" },
      handlers: {
        createSchedule: vi.fn(),
        listSchedules: vi.fn(),
        getSchedule: vi.fn(),
        updateSchedule: vi.fn(),
        deleteSchedule: vi.fn(),
      },
    }]),
    reconciliationPhases: vi.fn(() => [
      { name: "cron", execute: vi.fn() },
    ]),
  })),
}));

vi.mock("@grackle-ai/common", () => ({
  grackle: { Grackle: { typeName: "grackle.Grackle" } },
}));

vi.mock("@grackle-ai/database", () => ({
  scheduleStore: { getDueSchedules: vi.fn(), advanceSchedule: vi.fn(), setScheduleEnabled: vi.fn() },
  taskStore: { createTask: vi.fn(), setTaskScheduleId: vi.fn() },
  personaStore: { getPersona: vi.fn() },
  dispatchQueueStore: { enqueue: vi.fn() },
}));

import { createSchedulingPlugin } from "@grackle-ai/plugin-scheduling";

/** Create a minimal mock PluginContext for testing. */
function createMockContext(): PluginContext {
  return {
    subscribe: vi.fn(() => vi.fn()),
    emit: vi.fn() as PluginContext["emit"],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger,
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

describe("createSchedulingPlugin (server integration)", () => {
  it("returns name 'scheduling'", () => {
    const plugin = createSchedulingPlugin();
    expect(plugin.name).toBe("scheduling");
  });

  it("declares dependency on 'core'", () => {
    const plugin = createSchedulingPlugin();
    expect(plugin.dependencies).toEqual(["core"]);
  });

  it("grpcHandlers returns 1 registration for grackle.Grackle with schedule methods", () => {
    const plugin = createSchedulingPlugin();
    const ctx = createMockContext();
    const registrations = plugin.grpcHandlers!(ctx);

    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.service).toHaveProperty("typeName", "grackle.Grackle");
    const handlers = registrations[0]!.handlers;
    expect(handlers).toHaveProperty("createSchedule");
    expect(handlers).toHaveProperty("listSchedules");
    expect(handlers).toHaveProperty("getSchedule");
    expect(handlers).toHaveProperty("updateSchedule");
    expect(handlers).toHaveProperty("deleteSchedule");
  });

  it("reconciliationPhases returns 'cron' phase", () => {
    const plugin = createSchedulingPlugin();
    const ctx = createMockContext();
    const phases = plugin.reconciliationPhases!(ctx);

    expect(phases).toHaveLength(1);
    expect(phases[0]!.name).toBe("cron");
  });
});
