// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTaskSearch } from "./useTaskSearch.js";
import type { TaskData } from "../../hooks/types.js";

/** Minimal TaskData factory for tests. */
function makeTask(overrides: Partial<TaskData> & Pick<TaskData, "id" | "title">): TaskData {
  return {
    status: "not_started",
    description: "",
    workspaceId: "ws-1",
    parentTaskId: "",
    childTaskIds: [],
    dependsOn: [],
    branch: "main",
    latestSessionId: "",
    createdAt: "2024-01-01T00:00:00Z",
    defaultPersonaId: "",
    canDecompose: false,
    injectKnowledge: false,
    sortOrder: 0,
    depth: 0,
    workpad: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
    ...overrides,
  };
}

const TASKS: TaskData[] = [
  makeTask({ id: "t1", title: "Fix login bug", description: "Users cannot log in" }),
  makeTask({ id: "t2", title: "Add signup page" }),
  makeTask({ id: "t3", title: "Improve dashboard", description: "Make it faster" }),
  makeTask({ id: "t4", title: "Child of signup", parentTaskId: "t2" }),
];

describe("useTaskSearch", () => {
  it("returns undefined match sets and empty highlights when query is empty", () => {
    const { result } = renderHook(() => useTaskSearch(TASKS));

    expect(result.current.searchQuery).toBe("");
    expect(result.current.isSearching).toBe(false);
    expect(result.current.directMatchTaskIds).toBeUndefined();
    expect(result.current.treeMatchTaskIds).toBeUndefined();
    expect(result.current.titleHighlights.size).toBe(0);
  });

  it("finds direct title matches", () => {
    const { result } = renderHook(() => useTaskSearch(TASKS));

    act(() => {
      result.current.setSearchQuery("login");
    });

    expect(result.current.isSearching).toBe(true);
    expect(result.current.directMatchTaskIds?.has("t1")).toBe(true);
    expect(result.current.directMatchTaskIds?.has("t2")).toBe(false);
  });

  it("includes ancestor tasks in treeMatchTaskIds", () => {
    const { result } = renderHook(() => useTaskSearch(TASKS));

    // "signup" matches t2 directly and t4 is a child — but t4 title is "Child of signup"
    // which also matches. t2 should be in tree match because it's an ancestor of t4.
    act(() => {
      result.current.setSearchQuery("signup");
    });

    expect(result.current.directMatchTaskIds?.has("t2")).toBe(true);
    // t4 title contains "signup" so it's also a direct match
    expect(result.current.directMatchTaskIds?.has("t4")).toBe(true);
    // t2 is the parent of t4 and matches directly too
    expect(result.current.treeMatchTaskIds?.has("t2")).toBe(true);
  });

  it("populates title highlight indices for matched tasks", () => {
    const { result } = renderHook(() => useTaskSearch(TASKS));

    act(() => {
      result.current.setSearchQuery("Fix");
    });

    expect(result.current.titleHighlights.has("t1")).toBe(true);
    const indices = result.current.titleHighlights.get("t1");
    expect(indices).toBeDefined();
    expect(Array.isArray(indices)).toBe(true);
  });

  it("clears search state when query is cleared", () => {
    const { result } = renderHook(() => useTaskSearch(TASKS));

    act(() => {
      result.current.setSearchQuery("login");
    });
    expect(result.current.isSearching).toBe(true);

    act(() => {
      result.current.setSearchQuery("");
    });

    expect(result.current.isSearching).toBe(false);
    expect(result.current.directMatchTaskIds).toBeUndefined();
    expect(result.current.treeMatchTaskIds).toBeUndefined();
    expect(result.current.titleHighlights.size).toBe(0);
  });

  it("returns empty match sets for a query with no results", () => {
    const { result } = renderHook(() => useTaskSearch(TASKS));

    act(() => {
      result.current.setSearchQuery("xyzzy-no-match");
    });

    expect(result.current.isSearching).toBe(true);
    expect(result.current.directMatchTaskIds?.size).toBe(0);
    expect(result.current.treeMatchTaskIds?.size).toBe(0);
  });

  it("matches description text", () => {
    const { result } = renderHook(() => useTaskSearch(TASKS));

    act(() => {
      result.current.setSearchQuery("log in");
    });

    // t1 description: "Users cannot log in"
    expect(result.current.directMatchTaskIds?.has("t1")).toBe(true);
  });
});
