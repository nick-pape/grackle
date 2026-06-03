// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { UseKnowledgeResult } from "@grackle-ai/web-components";
import { KnowledgePage } from "./KnowledgePage.js";

// ---------------------------------------------------------------------------
// Mocks
//
// `useGrackle` reads from a mutable holder so each test can control the
// returned `knowledge` slice and swap it between renders. The heavy
// web-components (force-graph canvas, router-backed breadcrumbs) are stubbed
// to nulls — this test only exercises KnowledgePage's own effect + branching.
// ---------------------------------------------------------------------------

const holder = vi.hoisted(() => ({ knowledge: undefined as unknown as UseKnowledgeResult }));

vi.mock("../context/GrackleContext.js", () => ({
  useGrackle: () => ({ knowledge: holder.knowledge }),
}));

vi.mock("@grackle-ai/web-components", () => ({
  KNOWLEDGE_URL: "/knowledge",
  HOME_URL: "/",
  buildHomeBreadcrumbs: () => [{ label: "Home", url: undefined }],
  PageHeader: () => null,
  KnowledgeGraph: () => null,
  KnowledgeDetailPanel: () => null,
}));

/** Build a knowledge slice with sensible defaults, overridable per test. */
function makeKnowledge(overrides: Partial<UseKnowledgeResult> = {}): UseKnowledgeResult {
  return {
    graphData: { nodes: [], links: [] },
    selectedNode: undefined,
    selectedId: undefined,
    loading: false,
    loadError: undefined,
    searchQuery: "",
    search: vi.fn().mockResolvedValue(undefined),
    clearSearch: vi.fn(),
    selectNode: vi.fn().mockResolvedValue(undefined),
    clearSelection: vi.fn(),
    expandNode: vi.fn().mockResolvedValue(undefined),
    loadRecent: vi.fn().mockResolvedValue(undefined),
    handleEvent: vi.fn().mockReturnValue(false),
    domainHook: { onConnect: vi.fn(), onDisconnect: vi.fn(), handleEvent: vi.fn() },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // This package's vitest config doesn't enable globals, so testing-library's
  // automatic per-test cleanup isn't registered — unmount explicitly.
  cleanup();
});

describe("KnowledgePage", () => {
  // ── mount-once invariant (#1357) ──────────────────────────────

  it("calls loadRecent exactly once on mount", () => {
    const loadRecent = vi.fn().mockResolvedValue(undefined);
    holder.knowledge = makeKnowledge({ loadRecent });

    render(<KnowledgePage />);

    expect(loadRecent).toHaveBeenCalledTimes(1);
  });

  it("does not re-fire loadRecent when the knowledge object identity changes", () => {
    // Regression for the render-loop: the effect must depend on the stable
    // `loadRecent` callback, not the `knowledge` wrapper. A fresh wrapper object
    // every render (the pre-fix reality) must NOT re-trigger the load.
    const loadRecent = vi.fn().mockResolvedValue(undefined);
    holder.knowledge = makeKnowledge({ loadRecent });

    const { rerender } = render(<KnowledgePage />);
    expect(loadRecent).toHaveBeenCalledTimes(1);

    // New wrapper object, same stable callback — as the real hook now behaves.
    holder.knowledge = makeKnowledge({ loadRecent });
    rerender(<KnowledgePage />);
    holder.knowledge = makeKnowledge({ loadRecent });
    rerender(<KnowledgePage />);

    expect(loadRecent).toHaveBeenCalledTimes(1);
  });

  // ── error UX (#1357) ──────────────────────────────────────────

  it('shows "knowledge server can\'t be reached" when loadError is "unavailable"', () => {
    holder.knowledge = makeKnowledge({ loadError: "unavailable" });

    render(<KnowledgePage />);

    expect(screen.getByTestId("knowledge-error")).toBeTruthy();
    expect(screen.getByText(/can't be reached/i)).toBeTruthy();
    expect(screen.queryByText(/No knowledge nodes found/i)).toBeNull();
  });

  it('shows a generic error when loadError is "error"', () => {
    holder.knowledge = makeKnowledge({ loadError: "error" });

    render(<KnowledgePage />);

    expect(screen.getByTestId("knowledge-error")).toBeTruthy();
    expect(screen.getByText(/Failed to load the knowledge graph/i)).toBeTruthy();
  });

  it("retries loadRecent when the Retry button is clicked", () => {
    const loadRecent = vi.fn().mockResolvedValue(undefined);
    holder.knowledge = makeKnowledge({ loadError: "unavailable", loadRecent });

    render(<KnowledgePage />);
    expect(loadRecent).toHaveBeenCalledTimes(1); // mount

    fireEvent.click(screen.getByTestId("knowledge-retry"));
    expect(loadRecent).toHaveBeenCalledTimes(2); // retry
  });

  it("hides the error panel while a (re)load is in flight", () => {
    // While loading, neither the error nor the empty state shows (both branches
    // require !loading) — importantly, a stale error must not flash during retry.
    holder.knowledge = makeKnowledge({ loadError: "unavailable", loading: true });

    render(<KnowledgePage />);

    expect(screen.queryByTestId("knowledge-error")).toBeNull();
    expect(screen.queryByText(/No knowledge nodes found/i)).toBeNull();
  });

  it("shows the empty state when there are no nodes and no error", () => {
    holder.knowledge = makeKnowledge();

    render(<KnowledgePage />);

    expect(screen.getByText(/No knowledge nodes found/i)).toBeTruthy();
    expect(screen.queryByTestId("knowledge-error")).toBeNull();
  });
});
