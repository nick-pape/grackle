import { describe, it, expect } from "vitest";
import type { TaskData } from "@grackle-ai/web-components";
import { taskStatusToToast, diffTasksForToasts } from "./taskToastHelpers.js";

/** Build a minimal TaskData with sensible defaults. */
function makeTask(overrides: Partial<TaskData> & { id: string }): TaskData {
  return {
    workspaceId: "ws-1",
    title: "",
    description: "",
    status: "not_started",
    branch: "",
    latestSessionId: "",
    dependsOn: [],
    sortOrder: 0,
    createdAt: "",
    parentTaskId: "",
    depth: 0,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// taskStatusToToast
// ---------------------------------------------------------------------------

describe("taskStatusToToast", () => {
  it("returns info for working", () => {
    expect(taskStatusToToast("working")).toEqual({ message: "Task is now running", variant: "info" });
  });

  it("returns warning for paused", () => {
    expect(taskStatusToToast("paused")).toEqual({ message: "Task paused", variant: "warning" });
  });

  it("returns success for complete", () => {
    expect(taskStatusToToast("complete")).toEqual({ message: "Task complete", variant: "success" });
  });

  it("returns error for failed", () => {
    expect(taskStatusToToast("failed")).toEqual({ message: "Task failed to complete", variant: "error" });
  });

  it("returns undefined for not_started", () => {
    expect(taskStatusToToast("not_started")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(taskStatusToToast("")).toBeUndefined();
  });

  it("returns undefined for unknown status", () => {
    expect(taskStatusToToast("bogus")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// diffTasksForToasts
// ---------------------------------------------------------------------------

describe("diffTasksForToasts", () => {
  it("returns empty for undefined previous (initial load)", () => {
    const current = [makeTask({ id: "t1", status: "working" })];
    expect(diffTasksForToasts(undefined, current)).toEqual([]);
  });

  it("returns empty when no tasks change status", () => {
    const tasks = [makeTask({ id: "t1", status: "working" })];
    expect(diffTasksForToasts(tasks, tasks)).toEqual([]);
  });

  it("detects not_started → working", () => {
    const prev = [makeTask({ id: "t1", status: "not_started" })];
    const cur = [makeTask({ id: "t1", status: "working" })];
    expect(diffTasksForToasts(prev, cur)).toEqual([
      { message: "Task is now running", variant: "info" },
    ]);
  });

  it("detects working → paused", () => {
    const prev = [makeTask({ id: "t1", status: "working" })];
    const cur = [makeTask({ id: "t1", status: "paused" })];
    expect(diffTasksForToasts(prev, cur)).toEqual([
      { message: "Task paused", variant: "warning" },
    ]);
  });

  it("detects working → complete", () => {
    const prev = [makeTask({ id: "t1", status: "working" })];
    const cur = [makeTask({ id: "t1", status: "complete" })];
    expect(diffTasksForToasts(prev, cur)).toEqual([
      { message: "Task complete", variant: "success" },
    ]);
  });

  it("detects working → failed", () => {
    const prev = [makeTask({ id: "t1", status: "working" })];
    const cur = [makeTask({ id: "t1", status: "failed" })];
    expect(diffTasksForToasts(prev, cur)).toEqual([
      { message: "Task failed to complete", variant: "error" },
    ]);
  });

  it("skips newly added tasks", () => {
    const prev: TaskData[] = [];
    const cur = [makeTask({ id: "t1", status: "working" })];
    expect(diffTasksForToasts(prev, cur)).toEqual([]);
  });

  it("detects removed tasks", () => {
    const prev = [makeTask({ id: "t1", status: "working" })];
    const cur: TaskData[] = [];
    expect(diffTasksForToasts(prev, cur)).toEqual([
      { message: "Task deleted", variant: "info" },
    ]);
  });

  it("handles multiple simultaneous transitions", () => {
    const prev = [
      makeTask({ id: "t1", status: "not_started" }),
      makeTask({ id: "t2", status: "working" }),
      makeTask({ id: "t3", status: "working" }),
    ];
    const cur = [
      makeTask({ id: "t1", status: "working" }),
      makeTask({ id: "t2", status: "complete" }),
      // t3 removed
    ];
    const result = diffTasksForToasts(prev, cur);
    expect(result).toHaveLength(3);
    expect(result).toContainEqual({ message: "Task is now running", variant: "info" });
    expect(result).toContainEqual({ message: "Task complete", variant: "success" });
    expect(result).toContainEqual({ message: "Task deleted", variant: "info" });
  });

  it("skips transition to not_started", () => {
    const prev = [makeTask({ id: "t1", status: "working" })];
    const cur = [makeTask({ id: "t1", status: "not_started" })];
    expect(diffTasksForToasts(prev, cur)).toEqual([]);
  });
});
