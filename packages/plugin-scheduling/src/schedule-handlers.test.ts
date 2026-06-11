import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import { grackle } from "@grackle-ai/common";

// Mock database stores
vi.mock("@grackle-ai/database", () => ({
  personaStore: {
    getPersona: vi.fn(),
  },
  scheduleStore: {
    createSchedule: vi.fn(),
    getSchedule: vi.fn(),
    listSchedules: vi.fn(),
    updateSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
  },
  agentStore: {
    getAgent: vi.fn(),
  },
}));

import { personaStore, scheduleStore, agentStore } from "@grackle-ai/database";
import { createScheduleHandlers } from "./schedule-handlers.js";

/** A minimal valid schedule row returned from the store. */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sched-1",
    title: "My Schedule",
    description: "desc",
    scheduleExpression: "30s",
    personaId: "p-1",
    environmentId: "",
    workspaceId: "",
    parentTaskId: "",
    enabled: true,
    lastRunAt: null,
    nextRunAt: "2026-04-01T00:00:30Z",
    runCount: 0,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

describe("createScheduleHandlers", () => {
  let emit: ReturnType<typeof vi.fn>;
  let handlers: ReturnType<typeof createScheduleHandlers>;

  beforeEach(() => {
    vi.clearAllMocks();
    emit = vi.fn();
    handlers = createScheduleHandlers(emit as Parameters<typeof createScheduleHandlers>[0]);

    // Default mocks
    vi.mocked(personaStore.getPersona).mockReturnValue({
      id: "p-1",
      name: "Alice",
      description: "test",
      systemPrompt: "",
      mcpServers: "[]",
      runtime: "stub",
      model: "sonnet",
      maxConcurrentSessions: 1,
      tools: "[]",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
    vi.mocked(scheduleStore.getSchedule).mockReturnValue(
      makeRow() as ReturnType<typeof scheduleStore.getSchedule>,
    );
    vi.mocked(scheduleStore.listSchedules).mockReturnValue([makeRow()] as ReturnType<
      typeof scheduleStore.listSchedules
    >);
    vi.mocked(agentStore.getAgent).mockReturnValue({
      id: "agent-1",
      name: "Test Agent",
      primaryPersonaId: "p-1",
      environmentId: "env-1",
      avatar: "",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    } as ReturnType<typeof agentStore.getAgent>);
  });

  // ── createSchedule ──────────────────────────────────────

  describe("createSchedule", () => {
    it("throws InvalidArgument when title is empty", async () => {
      const req = {
        title: "",
        scheduleExpression: "30s",
        personaId: "p-1",
        description: "",
        environmentId: "",
        workspaceId: "",
        parentTaskId: "",
      } as grackle.CreateScheduleRequest;
      await expect(handlers.createSchedule(req)).rejects.toThrow(
        expect.objectContaining({ code: Code.InvalidArgument }),
      );
    });

    it("throws InvalidArgument when scheduleExpression is empty", async () => {
      const req = {
        title: "Test",
        scheduleExpression: "",
        personaId: "p-1",
        description: "",
        environmentId: "",
        workspaceId: "",
        parentTaskId: "",
      } as grackle.CreateScheduleRequest;
      await expect(handlers.createSchedule(req)).rejects.toThrow(
        expect.objectContaining({ code: Code.InvalidArgument }),
      );
    });

    it("throws InvalidArgument when personaId is empty", async () => {
      const req = {
        title: "Test",
        scheduleExpression: "30s",
        personaId: "",
        description: "",
        environmentId: "",
        workspaceId: "",
        parentTaskId: "",
      } as grackle.CreateScheduleRequest;
      await expect(handlers.createSchedule(req)).rejects.toThrow(
        expect.objectContaining({ code: Code.InvalidArgument }),
      );
    });

    it("throws NotFound when persona does not exist", async () => {
      vi.mocked(personaStore.getPersona).mockReturnValue(undefined);
      const req = {
        title: "Test",
        scheduleExpression: "30s",
        personaId: "missing",
        description: "",
        environmentId: "",
        workspaceId: "",
        parentTaskId: "",
      } as grackle.CreateScheduleRequest;
      await expect(handlers.createSchedule(req)).rejects.toThrow(
        expect.objectContaining({ code: Code.NotFound }),
      );
    });

    it("throws InvalidArgument when expression is invalid", async () => {
      const req = {
        title: "Test",
        scheduleExpression: "not-valid!!!",
        personaId: "p-1",
        description: "",
        environmentId: "",
        workspaceId: "",
        parentTaskId: "",
      } as grackle.CreateScheduleRequest;
      await expect(handlers.createSchedule(req)).rejects.toThrow(
        expect.objectContaining({ code: Code.InvalidArgument }),
      );
    });

    it("creates schedule, emits event, returns proto on success", async () => {
      const req = {
        title: "Test",
        scheduleExpression: "30s",
        personaId: "p-1",
        description: "d",
        environmentId: "",
        workspaceId: "",
        parentTaskId: "",
      } as grackle.CreateScheduleRequest;
      const result = await handlers.createSchedule(req);

      expect(scheduleStore.createSchedule).toHaveBeenCalledOnce();
      expect(emit).toHaveBeenCalledWith(
        "schedule.created",
        expect.objectContaining({ scheduleId: expect.any(String) }),
      );
      expect(result.id).toBe("sched-1");
      expect(result.title).toBe("My Schedule");
    });

    it("accepts agentId without personaId (persona optional when agent is set)", async () => {
      const req = {
        title: "Agent Schedule",
        scheduleExpression: "30s",
        personaId: "",
        agentId: "agent-1",
        description: "",
        workspaceId: "",
        parentTaskId: "",
      } as grackle.CreateScheduleRequest;
      const result = await handlers.createSchedule(req);
      expect(scheduleStore.createSchedule).toHaveBeenCalledOnce();
      expect(result.id).toBe("sched-1");
    });

    it("throws NotFound when agentId points to a non-existent agent", async () => {
      vi.mocked(agentStore.getAgent).mockReturnValue(undefined);
      const req = {
        title: "Test",
        scheduleExpression: "30s",
        personaId: "",
        agentId: "ghost-agent",
        description: "",
        workspaceId: "",
        parentTaskId: "",
      } as grackle.CreateScheduleRequest;
      await expect(handlers.createSchedule(req)).rejects.toThrow(
        expect.objectContaining({ code: Code.NotFound }),
      );
    });

    it("validates explicit personaId when agentId is also set", async () => {
      vi.mocked(personaStore.getPersona).mockReturnValue(undefined);
      const req = {
        title: "Test",
        scheduleExpression: "30s",
        personaId: "missing-persona",
        agentId: "agent-1",
        description: "",
        workspaceId: "",
        parentTaskId: "",
      } as grackle.CreateScheduleRequest;
      await expect(handlers.createSchedule(req)).rejects.toThrow(
        expect.objectContaining({ code: Code.NotFound }),
      );
    });
  });

  // ── listSchedules ───────────────────────────────────────

  describe("listSchedules", () => {
    it("returns list of schedules as proto", async () => {
      const req = { workspaceId: "" } as grackle.ListSchedulesRequest;
      const result = await handlers.listSchedules(req);
      expect(result.schedules).toHaveLength(1);
      expect(result.schedules[0]!.id).toBe("sched-1");
    });

    it("passes workspaceId filter to store", async () => {
      const req = { workspaceId: "ws-1" } as grackle.ListSchedulesRequest;
      await handlers.listSchedules(req);
      expect(scheduleStore.listSchedules).toHaveBeenCalledWith("ws-1");
    });

    it("passes undefined when workspaceId is empty string", async () => {
      const req = { workspaceId: "" } as grackle.ListSchedulesRequest;
      await handlers.listSchedules(req);
      expect(scheduleStore.listSchedules).toHaveBeenCalledWith(undefined);
    });
  });

  // ── getSchedule ─────────────────────────────────────────

  describe("getSchedule", () => {
    it("returns schedule as proto", async () => {
      const req = { id: "sched-1" } as grackle.ScheduleId;
      const result = await handlers.getSchedule(req);
      expect(result.id).toBe("sched-1");
    });

    it("throws NotFound when schedule does not exist", async () => {
      vi.mocked(scheduleStore.getSchedule).mockReturnValue(undefined);
      const req = { id: "missing" } as grackle.ScheduleId;
      await expect(handlers.getSchedule(req)).rejects.toThrow(
        expect.objectContaining({ code: Code.NotFound }),
      );
    });
  });

  // ── updateSchedule ──────────────────────────────────────

  describe("updateSchedule", () => {
    it("throws NotFound when schedule does not exist", async () => {
      vi.mocked(scheduleStore.getSchedule).mockReturnValueOnce(undefined);
      const req = { id: "missing" } as grackle.UpdateScheduleRequest;
      await expect(handlers.updateSchedule(req)).rejects.toThrow(
        expect.objectContaining({ code: Code.NotFound }),
      );
    });

    it("throws NotFound when updated personaId does not exist", async () => {
      vi.mocked(personaStore.getPersona).mockReturnValue(undefined);
      const req = { id: "sched-1", personaId: "ghost" } as grackle.UpdateScheduleRequest;
      await expect(handlers.updateSchedule(req)).rejects.toThrow(
        expect.objectContaining({ code: Code.NotFound }),
      );
    });

    it("throws InvalidArgument when updated expression is invalid", async () => {
      const req = { id: "sched-1", scheduleExpression: "bad!!!" } as grackle.UpdateScheduleRequest;
      await expect(handlers.updateSchedule(req)).rejects.toThrow(
        expect.objectContaining({ code: Code.InvalidArgument }),
      );
    });

    it("sets nextRunAt to null when enabled=false", async () => {
      const req = { id: "sched-1", enabled: false } as grackle.UpdateScheduleRequest;
      await handlers.updateSchedule(req);
      expect(scheduleStore.updateSchedule).toHaveBeenCalledWith(
        "sched-1",
        expect.objectContaining({ enabled: false, nextRunAt: null }),
      );
    });

    it("computes nextRunAt when enabled=true", async () => {
      const req = { id: "sched-1", enabled: true } as grackle.UpdateScheduleRequest;
      await handlers.updateSchedule(req);
      const updateArg = vi.mocked(scheduleStore.updateSchedule).mock.calls[0]![1];
      expect(updateArg.enabled).toBe(true);
      expect(typeof updateArg.nextRunAt).toBe("string");
      expect(updateArg.nextRunAt).not.toBe(null);
    });

    it("recomputes nextRunAt when expression changes on enabled schedule", async () => {
      const req = { id: "sched-1", scheduleExpression: "5m" } as grackle.UpdateScheduleRequest;
      await handlers.updateSchedule(req);
      const updateArg = vi.mocked(scheduleStore.updateSchedule).mock.calls[0]![1];
      expect(updateArg.scheduleExpression).toBe("5m");
      expect(typeof updateArg.nextRunAt).toBe("string");
    });

    it("emits schedule.updated on success", async () => {
      const req = { id: "sched-1", title: "New Title" } as grackle.UpdateScheduleRequest;
      await handlers.updateSchedule(req);
      expect(emit).toHaveBeenCalledWith(
        "schedule.updated",
        expect.objectContaining({ scheduleId: "sched-1" }),
      );
    });

    it("attaches an agent when valid agentId is provided", async () => {
      const req = { id: "sched-1", agentId: "agent-1" } as grackle.UpdateScheduleRequest;
      await handlers.updateSchedule(req);
      expect(scheduleStore.updateSchedule).toHaveBeenCalledWith(
        "sched-1",
        expect.objectContaining({ agentId: "agent-1" }),
      );
    });

    it("throws NotFound when attaching a non-existent agent", async () => {
      vi.mocked(agentStore.getAgent).mockReturnValue(undefined);
      const req = { id: "sched-1", agentId: "ghost" } as grackle.UpdateScheduleRequest;
      await expect(handlers.updateSchedule(req)).rejects.toThrow(
        expect.objectContaining({ code: Code.NotFound }),
      );
    });

    it("detaches agent when agentId is empty and schedule has a personaId", async () => {
      const req = { id: "sched-1", agentId: "" } as grackle.UpdateScheduleRequest;
      await handlers.updateSchedule(req);
      expect(scheduleStore.updateSchedule).toHaveBeenCalledWith(
        "sched-1",
        expect.objectContaining({ agentId: null }),
      );
    });

    it("throws InvalidArgument when detaching agent leaves schedule with no personaId", async () => {
      vi.mocked(scheduleStore.getSchedule).mockReturnValue(
        makeRow({ personaId: "" }) as ReturnType<typeof scheduleStore.getSchedule>,
      );
      const req = { id: "sched-1", agentId: "" } as grackle.UpdateScheduleRequest;
      await expect(handlers.updateSchedule(req)).rejects.toThrow(
        expect.objectContaining({ code: Code.InvalidArgument }),
      );
    });

    it("allows detaching agent when req.personaId provides a fallback persona", async () => {
      vi.mocked(scheduleStore.getSchedule).mockReturnValue(
        makeRow({ personaId: "" }) as ReturnType<typeof scheduleStore.getSchedule>,
      );
      const req = {
        id: "sched-1",
        agentId: "",
        personaId: "p-1",
      } as grackle.UpdateScheduleRequest;
      await handlers.updateSchedule(req);
      expect(scheduleStore.updateSchedule).toHaveBeenCalledWith(
        "sched-1",
        expect.objectContaining({ agentId: null }),
      );
    });
  });

  // ── deleteSchedule ──────────────────────────────────────

  describe("deleteSchedule", () => {
    it("calls deleteSchedule on store", async () => {
      const req = { id: "sched-1" } as grackle.ScheduleId;
      await handlers.deleteSchedule(req);
      expect(scheduleStore.deleteSchedule).toHaveBeenCalledWith("sched-1");
    });

    it("emits schedule.deleted", async () => {
      const req = { id: "sched-1" } as grackle.ScheduleId;
      await handlers.deleteSchedule(req);
      expect(emit).toHaveBeenCalledWith(
        "schedule.deleted",
        expect.objectContaining({ scheduleId: "sched-1" }),
      );
    });

    it("returns Empty", async () => {
      const req = { id: "sched-1" } as grackle.ScheduleId;
      const result = await handlers.deleteSchedule(req);
      expect(result).toBeDefined();
    });
  });
});
