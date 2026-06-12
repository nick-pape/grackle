import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

// ── Mock grackle clients ──────────────────────────────────────────────────────

const mockGetTask = vi.fn();
const mockGetUsage = vi.fn();

vi.mock("../client.js", () => ({
  createGrackleClients: () => ({
    orchestration: {
      getTask: mockGetTask,
    },
    core: {
      getUsage: mockGetUsage,
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

describe("registerTaskCommands — task show", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.clearAllMocks();
    // Default: usage returns zeros so the usage block doesn't interfere.
    mockGetUsage.mockResolvedValue({ inputTokens: 0, outputTokens: 0, costMillicents: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("prints Kind, Agent, and Parent for a schedule_fire task (#1439)", async () => {
    mockGetTask.mockResolvedValue({
      id: "fire-1",
      title: "nightly scan @ 2026-06-11T01:00:00Z",
      status: 2,
      branch: "",
      kind: "schedule_fire",
      agentId: "agent-abc",
      parentTaskId: "root-xyz",
      latestSessionId: "",
      dependsOn: [],
      canDecompose: false,
      injectKnowledge: false,
      description: "",
      workpad: "",
      tokenBudget: 0,
      costBudgetMillicents: 0,
    });

    const { registerTaskCommands } = await import("./task.js");
    const program = makeProgram();
    registerTaskCommands(program);
    await run(program, ["task", "show", "fire-1"]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Kind:        schedule_fire"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Agent:       agent-abc"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Parent:      root-xyz"));
  });

  it("omits Kind, Agent, and Parent lines for an ordinary task (#1439)", async () => {
    mockGetTask.mockResolvedValue({
      id: "task-1",
      title: "Fix the bug",
      status: 1,
      branch: "main",
      kind: "",
      agentId: "",
      parentTaskId: "",
      latestSessionId: "",
      dependsOn: [],
      canDecompose: false,
      injectKnowledge: true,
      description: "",
      workpad: "",
      tokenBudget: 0,
      costBudgetMillicents: 0,
    });

    const { registerTaskCommands } = await import("./task.js");
    const program = makeProgram();
    registerTaskCommands(program);
    await run(program, ["task", "show", "task-1"]);

    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Kind:"));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Agent:"));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Parent:"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("ID:          task-1"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Title:       Fix the bug"));
  });
});
