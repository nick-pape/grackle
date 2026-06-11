import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

// ── Mock grackle clients ──────────────────────────────────────────────────────

const mockCreateSchedule = vi.fn();
const mockUpdateSchedule = vi.fn();
const mockListSchedules = vi.fn();
const mockGetSchedule = vi.fn();
const mockDeleteSchedule = vi.fn();

vi.mock("../client.js", () => ({
  createGrackleClients: () => ({
    scheduling: {
      createSchedule: mockCreateSchedule,
      updateSchedule: mockUpdateSchedule,
      listSchedules: mockListSchedules,
      getSchedule: mockGetSchedule,
      deleteSchedule: mockDeleteSchedule,
    },
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  return program;
}

async function run(program: Command, args: string[]): Promise<void> {
  await program.parseAsync(args, { from: "user" });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("registerScheduleCommands", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as (code?: string | number | null) => never);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // ── schedule create ─────────────────────────────────────────────────────────

  describe("schedule create", () => {
    it("sends agentId when --agent is given (persona omitted)", async () => {
      mockCreateSchedule.mockResolvedValue({
        id: "s1",
        title: "Scan",
        scheduleExpression: "30s",
        agentId: "agent-1",
        personaId: "",
        nextRunAt: "",
      });

      const { registerScheduleCommands } = await import("./schedule.js");
      const program = makeProgram();
      registerScheduleCommands(program);
      await run(program, ["schedule", "create", "Scan", "--schedule", "30s", "--agent", "agent-1"]);

      expect(mockCreateSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: "agent-1", personaId: "" }),
      );
    });

    it("sends personaId when --persona is given (no agent)", async () => {
      mockCreateSchedule.mockResolvedValue({
        id: "s2",
        title: "Check",
        scheduleExpression: "1h",
        agentId: "",
        personaId: "persona-1",
        nextRunAt: "",
      });

      const { registerScheduleCommands } = await import("./schedule.js");
      const program = makeProgram();
      registerScheduleCommands(program);
      await run(program, [
        "schedule",
        "create",
        "Check",
        "--schedule",
        "1h",
        "--persona",
        "persona-1",
      ]);

      expect(mockCreateSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ personaId: "persona-1", agentId: "" }),
      );
    });

    it("exits 1 when neither --agent nor --persona is given", async () => {
      const { registerScheduleCommands } = await import("./schedule.js");
      const program = makeProgram();
      registerScheduleCommands(program);

      await expect(
        run(program, ["schedule", "create", "Scan", "--schedule", "30s"]),
      ).rejects.toThrow("process.exit called");

      expect(errorSpy).toHaveBeenCalledWith("Error: --persona or --agent is required");
      expect(mockCreateSchedule).not.toHaveBeenCalled();
    });
  });

  // ── schedule edit ───────────────────────────────────────────────────────────

  describe("schedule edit", () => {
    it("sends agentId='' (detach sentinel) when --detach-agent is given", async () => {
      mockUpdateSchedule.mockResolvedValue({
        id: "s1",
        agentId: "",
        personaId: "p1",
        scheduleExpression: "5m",
        enabled: true,
      });

      const { registerScheduleCommands } = await import("./schedule.js");
      const program = makeProgram();
      registerScheduleCommands(program);
      await run(program, ["schedule", "edit", "s1", "--detach-agent"]);

      expect(mockUpdateSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ id: "s1", agentId: "" }),
      );
    });

    it("sends agentId when --agent is given (attach)", async () => {
      mockUpdateSchedule.mockResolvedValue({
        id: "s1",
        agentId: "agent-1",
        personaId: "",
        scheduleExpression: "5m",
        enabled: true,
      });

      const { registerScheduleCommands } = await import("./schedule.js");
      const program = makeProgram();
      registerScheduleCommands(program);
      await run(program, ["schedule", "edit", "s1", "--agent", "agent-1"]);

      expect(mockUpdateSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ id: "s1", agentId: "agent-1" }),
      );
    });

    it("sends personaId='' when --persona '' is given (clear persona override)", async () => {
      mockUpdateSchedule.mockResolvedValue({
        id: "s1",
        agentId: "agent-1",
        personaId: "",
        scheduleExpression: "5m",
        enabled: true,
      });

      const { registerScheduleCommands } = await import("./schedule.js");
      const program = makeProgram();
      registerScheduleCommands(program);
      await run(program, ["schedule", "edit", "s1", "--persona", ""]);

      expect(mockUpdateSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ id: "s1", personaId: "" }),
      );
    });

    it("exits 1 when --agent and --detach-agent are both given", async () => {
      const { registerScheduleCommands } = await import("./schedule.js");
      const program = makeProgram();
      registerScheduleCommands(program);

      await expect(
        run(program, ["schedule", "edit", "s1", "--agent", "agent-1", "--detach-agent"]),
      ).rejects.toThrow("process.exit called");

      expect(errorSpy).toHaveBeenCalledWith(
        "Error: --agent and --detach-agent are mutually exclusive",
      );
      expect(mockUpdateSchedule).not.toHaveBeenCalled();
    });

    it("exits 1 when no mutable fields are given (no-op guard)", async () => {
      const { registerScheduleCommands } = await import("./schedule.js");
      const program = makeProgram();
      registerScheduleCommands(program);

      await expect(run(program, ["schedule", "edit", "s1"])).rejects.toThrow("process.exit called");

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("no fields to update"));
      expect(mockUpdateSchedule).not.toHaveBeenCalled();
    });

    it("does NOT send agentId when neither --agent nor --detach-agent is given", async () => {
      mockUpdateSchedule.mockResolvedValue({
        id: "s1",
        agentId: "agent-1",
        personaId: "",
        scheduleExpression: "1h",
        enabled: true,
      });

      const { registerScheduleCommands } = await import("./schedule.js");
      const program = makeProgram();
      registerScheduleCommands(program);
      await run(program, ["schedule", "edit", "s1", "--title", "New Title"]);

      const req = vi.mocked(mockUpdateSchedule).mock.calls[0]![0] as Record<string, unknown>;
      expect(req.agentId).toBeUndefined();
    });
  });
});
