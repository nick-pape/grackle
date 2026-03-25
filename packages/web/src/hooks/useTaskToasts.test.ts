// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { TaskData } from "./types.js";
import { useTaskToasts } from "./useTaskToasts.js";

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
    ...overrides,
  };
}

describe("useTaskToasts", () => {
  it("does not fire toasts on initial render", () => {
    const showToast = vi.fn();
    const tasks = [makeTask({ id: "t1", status: "working" })];

    renderHook(() => useTaskToasts(tasks, showToast));

    expect(showToast).not.toHaveBeenCalled();
  });

  it("fires started toast when task transitions to working", () => {
    const showToast = vi.fn();
    const initial = [makeTask({ id: "t1", status: "not_started" })];
    const updated = [makeTask({ id: "t1", status: "working" })];

    const { rerender } = renderHook(
      ({ tasks }) => useTaskToasts(tasks, showToast),
      { initialProps: { tasks: initial } },
    );

    expect(showToast).not.toHaveBeenCalled();

    rerender({ tasks: updated });

    expect(showToast).toHaveBeenCalledWith("Task started", "info");
  });

  it("fires completed toast on working → complete", () => {
    const showToast = vi.fn();
    const initial = [makeTask({ id: "t1", status: "working" })];
    const updated = [makeTask({ id: "t1", status: "complete" })];

    const { rerender } = renderHook(
      ({ tasks }) => useTaskToasts(tasks, showToast),
      { initialProps: { tasks: initial } },
    );

    rerender({ tasks: updated });

    expect(showToast).toHaveBeenCalledWith("Task completed", "success");
  });

  it("fires failed toast on working → failed", () => {
    const showToast = vi.fn();
    const initial = [makeTask({ id: "t1", status: "working" })];
    const updated = [makeTask({ id: "t1", status: "failed" })];

    const { rerender } = renderHook(
      ({ tasks }) => useTaskToasts(tasks, showToast),
      { initialProps: { tasks: initial } },
    );

    rerender({ tasks: updated });

    expect(showToast).toHaveBeenCalledWith("Task failed", "error");
  });

  it("fires deleted toast when task is removed from array", () => {
    const showToast = vi.fn();
    const initial = [makeTask({ id: "t1", status: "working" })];
    const updated: TaskData[] = [];

    const { rerender } = renderHook(
      ({ tasks }) => useTaskToasts(tasks, showToast),
      { initialProps: { tasks: initial } },
    );

    rerender({ tasks: updated });

    expect(showToast).toHaveBeenCalledWith("Task deleted", "info");
  });

  it("does not fire for newly added tasks", () => {
    const showToast = vi.fn();
    const initial: TaskData[] = [];
    const updated = [makeTask({ id: "t1", status: "working" })];

    const { rerender } = renderHook(
      ({ tasks }) => useTaskToasts(tasks, showToast),
      { initialProps: { tasks: initial } },
    );

    rerender({ tasks: updated });

    expect(showToast).not.toHaveBeenCalled();
  });

  it("handles multiple simultaneous changes", () => {
    const showToast = vi.fn();
    const initial = [
      makeTask({ id: "t1", status: "not_started" }),
      makeTask({ id: "t2", status: "working" }),
    ];
    const updated = [
      makeTask({ id: "t1", status: "working" }),
      makeTask({ id: "t2", status: "complete" }),
    ];

    const { rerender } = renderHook(
      ({ tasks }) => useTaskToasts(tasks, showToast),
      { initialProps: { tasks: initial } },
    );

    rerender({ tasks: updated });

    expect(showToast).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledWith("Task started", "info");
    expect(showToast).toHaveBeenCalledWith("Task completed", "success");
  });
});
