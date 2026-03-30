import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TaskRow } from "@grackle-ai/database";
import type { WorkspaceRow } from "@grackle-ai/database";

// ── Mocks ────────────────────────────────────────────────────
vi.mock("@grackle-ai/database", () => ({
  taskStore: {
    getTask: vi.fn(),
    listTasks: vi.fn().mockReturnValue([]),
  },
  workspaceStore: {
    getWorkspace: vi.fn(),
  },
  sessionStore: {
    aggregateUsage: vi.fn(),
  },
}));

import { taskStore, workspaceStore, sessionStore } from "@grackle-ai/database";
import { checkBudget, costUsdToMillicents } from "./budget-checker.js";

const mockGetTask = vi.mocked(taskStore.getTask);
const mockListTasks = vi.mocked(taskStore.listTasks);
const mockGetWorkspace = vi.mocked(workspaceStore.getWorkspace);
const mockAggregateUsage = vi.mocked(sessionStore.aggregateUsage);

/** Helper to create a minimal TaskRow with optional overrides applied via Object.assign. */
function fakeTask(overrides: Record<string, unknown> = {}): TaskRow {
  const row = {
    id: "t1",
    workspaceId: "ws1",
    title: "Test Task",
    description: "",
    status: "working",
    branch: "",
    dependsOn: "[]",
    startedAt: null,
    completedAt: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    sortOrder: 0,
    parentTaskId: "",
    depth: 0,
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    scheduleId: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
  };
  return Object.assign(row, overrides) as TaskRow;
}

/** Helper to create a minimal WorkspaceRow with optional overrides applied via Object.assign. */
function fakeWorkspace(overrides: Record<string, unknown> = {}): WorkspaceRow {
  const row = {
    id: "ws1",
    name: "Test Workspace",
    description: "",
    repoUrl: "",
    environmentId: "env-1",
    status: "active",
    useWorktrees: true,
    workingDirectory: "",
    defaultPersonaId: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
  return Object.assign(row, overrides) as WorkspaceRow;
}

describe("costUsdToMillicents", () => {
  it("converts 1.00 USD to 100000 millicents", () => {
    expect(costUsdToMillicents(1.0)).toBe(100000);
  });

  it("converts 0.001 USD to 100 millicents", () => {
    expect(costUsdToMillicents(0.001)).toBe(100);
  });

  it("converts 0 to 0", () => {
    expect(costUsdToMillicents(0)).toBe(0);
  });

  it("rounds to nearest integer", () => {
    // 0.000006 * 100000 = 0.6 → rounds to 1
    expect(costUsdToMillicents(0.000006)).toBe(1);
  });
});

describe("checkBudget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when task has no budget (0)", () => {
    mockGetTask.mockReturnValue(fakeTask({ tokenBudget: 0, costBudgetMillicents: 0 }));
    mockAggregateUsage.mockReturnValue({ inputTokens: 1000, outputTokens: 500, costUsd: 0.5, sessionCount: 1 });
    expect(checkBudget("t1")).toBeUndefined();
  });

  it("returns null when usage is under token budget", () => {
    mockGetTask.mockReturnValue(fakeTask({ tokenBudget: 5000 }));
    mockAggregateUsage.mockReturnValue({ inputTokens: 1000, outputTokens: 500, costUsd: 0, sessionCount: 1 });
    expect(checkBudget("t1")).toBeUndefined();
  });

  it("returns task/token when task token budget is exceeded", () => {
    mockGetTask.mockReturnValue(fakeTask({ tokenBudget: 1000 }));
    mockAggregateUsage.mockReturnValue({ inputTokens: 800, outputTokens: 300, costUsd: 0, sessionCount: 1 });
    const result = checkBudget("t1");
    expect(result).not.toBeUndefined();
    expect(result!.scope).toBe("task");
    expect(result!.reason).toBe("token");
  });

  it("returns task/cost when task cost budget is exceeded", () => {
    mockGetTask.mockReturnValue(fakeTask({ costBudgetMillicents: 4000 }));
    mockAggregateUsage.mockReturnValue({ inputTokens: 0, outputTokens: 0, costUsd: 0.05, sessionCount: 1 });
    // 0.05 USD = 5000 millicents > 4000
    const result = checkBudget("t1");
    expect(result).not.toBeUndefined();
    expect(result!.scope).toBe("task");
    expect(result!.reason).toBe("cost");
  });

  it("returns null when workspace has no budget (0)", () => {
    mockGetTask.mockReturnValue(fakeTask({ workspaceId: "ws1" }));
    mockGetWorkspace.mockReturnValue(fakeWorkspace({ tokenBudget: 0, costBudgetMillicents: 0 }));
    mockAggregateUsage.mockReturnValue({ inputTokens: 1000, outputTokens: 500, costUsd: 0.5, sessionCount: 1 });
    expect(checkBudget("t1", "ws1")).toBeUndefined();
  });

  it("returns workspace/token when workspace token budget is exceeded", () => {
    mockGetTask.mockReturnValue(fakeTask());
    mockGetWorkspace.mockReturnValue(fakeWorkspace({ tokenBudget: 5000 }));
    mockListTasks.mockReturnValue([fakeTask({ id: "t1" }), fakeTask({ id: "t2" })]);
    // Task-level usage (first call) — under any task budget
    // Workspace-level usage (second call) — over workspace budget
    mockAggregateUsage
      .mockReturnValueOnce({ inputTokens: 100, outputTokens: 100, costUsd: 0, sessionCount: 1 })
      .mockReturnValueOnce({ inputTokens: 3000, outputTokens: 2500, costUsd: 0, sessionCount: 3 });
    mockGetWorkspace.mockReturnValue(fakeWorkspace({ tokenBudget: 5000 }));
    const result = checkBudget("t1", "ws1");
    expect(result).not.toBeUndefined();
    expect(result!.scope).toBe("workspace");
    expect(result!.reason).toBe("token");
  });

  it("checks task budget before workspace budget", () => {
    mockGetTask.mockReturnValue(fakeTask({ tokenBudget: 500 }));
    mockGetWorkspace.mockReturnValue(fakeWorkspace({ tokenBudget: 50000 }));
    mockListTasks.mockReturnValue([fakeTask({ id: "t1" })]);
    mockAggregateUsage.mockReturnValue({ inputTokens: 400, outputTokens: 200, costUsd: 0, sessionCount: 1 });
    const result = checkBudget("t1", "ws1");
    // Task budget (500) is exceeded (600 tokens used), should report task not workspace
    expect(result!.scope).toBe("task");
  });

  it("handles edge: budget = 1, usage = 0 -> not exceeded", () => {
    mockGetTask.mockReturnValue(fakeTask({ tokenBudget: 1 }));
    mockAggregateUsage.mockReturnValue({ inputTokens: 0, outputTokens: 0, costUsd: 0, sessionCount: 0 });
    expect(checkBudget("t1")).toBeUndefined();
  });

  it("returns null when task not found", () => {
    mockGetTask.mockReturnValue(undefined);
    expect(checkBudget("nonexistent")).toBeUndefined();
  });

  it("includes a human-readable message", () => {
    mockGetTask.mockReturnValue(fakeTask({ tokenBudget: 1000 }));
    mockAggregateUsage.mockReturnValue({ inputTokens: 800, outputTokens: 300, costUsd: 0, sessionCount: 1 });
    const result = checkBudget("t1");
    expect(result!.message).toContain("1100");
    expect(result!.message).toContain("1000");
  });
});
