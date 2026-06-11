// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGroupByStatus } from "./useGroupByStatus.js";

describe("useGroupByStatus", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to not grouped", () => {
    const { result } = renderHook(() => useGroupByStatus());
    expect(result.current.groupByStatus).toBe(false);
  });

  it("reads initial state from localStorage", () => {
    localStorage.setItem("grackle-task-group-by-status", "true");
    const { result } = renderHook(() => useGroupByStatus());
    expect(result.current.groupByStatus).toBe(true);
  });

  it("toggles groupByStatus and persists to localStorage", () => {
    const { result } = renderHook(() => useGroupByStatus());
    expect(result.current.groupByStatus).toBe(false);

    act(() => {
      result.current.toggleGroupByStatus();
    });

    expect(result.current.groupByStatus).toBe(true);
    expect(localStorage.getItem("grackle-task-group-by-status")).toBe("true");
  });

  it("toggles back to false and persists", () => {
    localStorage.setItem("grackle-task-group-by-status", "true");
    const { result } = renderHook(() => useGroupByStatus());

    act(() => {
      result.current.toggleGroupByStatus();
    });

    expect(result.current.groupByStatus).toBe(false);
    expect(localStorage.getItem("grackle-task-group-by-status")).toBe("false");
  });

  it("expands all groups by default when toggled on", () => {
    const { result } = renderHook(() => useGroupByStatus());

    act(() => {
      result.current.toggleGroupByStatus();
    });

    expect(result.current.isGroupExpanded("working")).toBe(true);
    expect(result.current.isGroupExpanded("complete")).toBe(true);
  });

  it("can toggle a single status group and then restore it", () => {
    localStorage.setItem("grackle-task-group-by-status", "true");
    const { result } = renderHook(() => useGroupByStatus());

    // Initially expanded
    expect(result.current.isGroupExpanded("working")).toBe(true);

    // Collapse
    act(() => {
      result.current.toggleStatusGroup("working");
    });
    expect(result.current.isGroupExpanded("working")).toBe(false);
    expect(result.current.isGroupExpanded("complete")).toBe(true);

    // Re-expand
    act(() => {
      result.current.toggleStatusGroup("working");
    });
    expect(result.current.isGroupExpanded("working")).toBe(true);
  });

  it("resets group overrides when toggled back on", () => {
    localStorage.setItem("grackle-task-group-by-status", "true");
    const { result } = renderHook(() => useGroupByStatus());

    // Collapse one group
    act(() => {
      result.current.toggleStatusGroup("working");
    });
    expect(result.current.isGroupExpanded("working")).toBe(false);

    // Toggle off then on — overrides should be cleared
    act(() => {
      result.current.toggleGroupByStatus();
    });
    act(() => {
      result.current.toggleGroupByStatus();
    });

    expect(result.current.isGroupExpanded("working")).toBe(true);
  });

  it("handles localStorage unavailable gracefully", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("unavailable");
    });

    const { result } = renderHook(() => useGroupByStatus());
    expect(result.current.groupByStatus).toBe(false);

    act(() => {
      result.current.toggleGroupByStatus();
    });
    expect(result.current.groupByStatus).toBe(true);

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });
});
