// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWorkspaces } from "./useWorkspaces.js";

// ---------------------------------------------------------------------------
// Mock grackleClient (vi.hoisted ensures the object exists before vi.mock runs)
// ---------------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
}));

vi.mock("./useGrackleClient.js", () => ({
  grackleClient: mockClient,
}));

// Mock proto-converters — identity passthrough for these tests
vi.mock("./proto-converters.js", () => ({
  protoToWorkspace: (w: unknown) => w,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(): { result: { current: ReturnType<typeof useWorkspaces> } } {
  const { result } = renderHook(() => useWorkspaces());
  return { result };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useWorkspaces loading state", () => {
  it("workspacesLoading starts false", () => {
    const { result } = setup();
    expect(result.current.workspacesLoading).toBe(false);
  });

  it("workspacesLoading flips true on loadWorkspaces(), then false on resolve", async () => {
    mockClient.listWorkspaces.mockResolvedValue({ workspaces: [] });

    const { result } = setup();

    act(() => {
      result.current.loadWorkspaces().catch(() => {});
    });

    expect(result.current.workspacesLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.workspacesLoading).toBe(false);
    });
  });

  it("workspacesLoading flips false on RPC error", async () => {
    mockClient.listWorkspaces.mockRejectedValue(new Error("unavailable"));

    const { result } = setup();

    act(() => {
      result.current.loadWorkspaces().catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.workspacesLoading).toBe(false);
    });
  });
});
