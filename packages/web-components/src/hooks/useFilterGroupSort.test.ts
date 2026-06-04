// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFilterGroupSort } from "./useFilterGroupSort.js";

const PREFIX = "test-nav";

function renderFGS(opts?: { validGroupKeys?: string[]; validSortKeys?: string[] }) {
  return renderHook(() => useFilterGroupSort({ storagePrefix: PREFIX, ...opts }));
}

beforeEach(() => {
  localStorage.clear();
});

describe("useFilterGroupSort — filter", () => {
  it("starts with empty filter and filterActive false", () => {
    const { result } = renderFGS();
    expect(result.current.filterValues.size).toBe(0);
    expect(result.current.filterActive).toBe(false);
  });

  it("loads persisted filter values from localStorage", () => {
    localStorage.setItem(`${PREFIX}-filter`, JSON.stringify(["a", "b"]));
    const { result } = renderFGS();
    expect(result.current.filterValues.has("a")).toBe(true);
    expect(result.current.filterValues.has("b")).toBe(true);
    expect(result.current.filterActive).toBe(true);
  });

  it("toggleFilter adds a key and persists it", () => {
    const { result } = renderFGS();
    act(() => {
      result.current.toggleFilter("x");
    });
    expect(result.current.filterValues.has("x")).toBe(true);
    expect(result.current.filterActive).toBe(true);
    expect(localStorage.getItem(`${PREFIX}-filter`)).toBe('["x"]');
  });

  it("toggleFilter removes a key that is already selected", () => {
    const { result } = renderFGS();
    act(() => {
      result.current.toggleFilter("x");
    });
    act(() => {
      result.current.toggleFilter("x");
    });
    expect(result.current.filterValues.has("x")).toBe(false);
    expect(result.current.filterActive).toBe(false);
  });

  it("clearFilter empties the set and removes the storage key", () => {
    const { result } = renderFGS();
    act(() => {
      result.current.toggleFilter("x");
    });
    act(() => {
      result.current.clearFilter();
    });
    expect(result.current.filterValues.size).toBe(0);
    expect(result.current.filterActive).toBe(false);
    expect(localStorage.getItem(`${PREFIX}-filter`)).toBeNull();
  });
});

describe("useFilterGroupSort — groupBy", () => {
  it("starts with groupBy '' and groupActive false", () => {
    const { result } = renderFGS();
    expect(result.current.groupBy).toBe("");
    expect(result.current.groupActive).toBe(false);
  });

  it("loads persisted groupBy from localStorage", () => {
    localStorage.setItem(`${PREFIX}-group`, "workspace");
    const { result } = renderFGS();
    expect(result.current.groupBy).toBe("workspace");
    expect(result.current.groupActive).toBe(true);
  });

  it("toggleGroup sets a group key and persists it", () => {
    const { result } = renderFGS();
    act(() => {
      result.current.toggleGroup("workspace");
    });
    expect(result.current.groupBy).toBe("workspace");
    expect(result.current.groupActive).toBe(true);
    expect(localStorage.getItem(`${PREFIX}-group`)).toBe("workspace");
  });

  it("toggleGroup with same key clears groupBy", () => {
    const { result } = renderFGS();
    act(() => {
      result.current.toggleGroup("workspace");
    });
    act(() => {
      result.current.toggleGroup("workspace");
    });
    expect(result.current.groupBy).toBe("");
    expect(result.current.groupActive).toBe(false);
    expect(localStorage.getItem(`${PREFIX}-group`)).toBeNull();
  });

  it("clearGroup resets to '' and removes the storage key", () => {
    const { result } = renderFGS();
    act(() => {
      result.current.toggleGroup("workspace");
    });
    act(() => {
      result.current.clearGroup();
    });
    expect(result.current.groupBy).toBe("");
    expect(localStorage.getItem(`${PREFIX}-group`)).toBeNull();
  });

  it("sanitizes a stale groupBy value not in validGroupKeys", () => {
    localStorage.setItem(`${PREFIX}-group`, "old-key");
    const { result } = renderFGS({ validGroupKeys: ["workspace", "tag"] });
    expect(result.current.groupBy).toBe("");
    expect(result.current.groupActive).toBe(false);
    expect(localStorage.getItem(`${PREFIX}-group`)).toBeNull();
  });

  it("keeps a valid groupBy value when validGroupKeys is provided", () => {
    localStorage.setItem(`${PREFIX}-group`, "workspace");
    const { result } = renderFGS({ validGroupKeys: ["workspace", "tag"] });
    expect(result.current.groupBy).toBe("workspace");
    expect(result.current.groupActive).toBe(true);
  });

  it("does not sanitize when validGroupKeys is omitted", () => {
    localStorage.setItem(`${PREFIX}-group`, "anything");
    const { result } = renderFGS();
    expect(result.current.groupBy).toBe("anything");
  });
});

describe("useFilterGroupSort — sortBy", () => {
  it("starts with sortBy '' and sortActive false", () => {
    const { result } = renderFGS();
    expect(result.current.sortBy).toBe("");
    expect(result.current.sortActive).toBe(false);
  });

  it("toggleSort sets a sort key and persists it", () => {
    const { result } = renderFGS();
    act(() => {
      result.current.toggleSort("name");
    });
    expect(result.current.sortBy).toBe("name");
    expect(result.current.sortActive).toBe(true);
    expect(localStorage.getItem(`${PREFIX}-sort`)).toBe("name");
  });

  it("toggleSort with same key clears sortBy", () => {
    const { result } = renderFGS();
    act(() => {
      result.current.toggleSort("name");
    });
    act(() => {
      result.current.toggleSort("name");
    });
    expect(result.current.sortBy).toBe("");
    expect(localStorage.getItem(`${PREFIX}-sort`)).toBeNull();
  });

  it("clearSort resets to '' and removes the storage key", () => {
    const { result } = renderFGS();
    act(() => {
      result.current.toggleSort("name");
    });
    act(() => {
      result.current.clearSort();
    });
    expect(result.current.sortBy).toBe("");
    expect(localStorage.getItem(`${PREFIX}-sort`)).toBeNull();
  });

  it("sanitizes a stale sortBy value not in validSortKeys", () => {
    localStorage.setItem(`${PREFIX}-sort`, "old-sort");
    const { result } = renderFGS({ validSortKeys: ["name", "created"] });
    expect(result.current.sortBy).toBe("");
    expect(result.current.sortActive).toBe(false);
    expect(localStorage.getItem(`${PREFIX}-sort`)).toBeNull();
  });

  it("keeps a valid sortBy value when validSortKeys is provided", () => {
    localStorage.setItem(`${PREFIX}-sort`, "name");
    const { result } = renderFGS({ validSortKeys: ["name", "created"] });
    expect(result.current.sortBy).toBe("name");
  });
});
