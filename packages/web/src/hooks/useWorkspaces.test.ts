// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWorkspaces } from "./useWorkspaces.js";

// ---------------------------------------------------------------------------
// Mock grackleClient (vi.hoisted ensures the object exists before vi.mock runs)
// ---------------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  linkEnvironment: vi.fn(),
  unlinkEnvironment: vi.fn(),
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

describe("linkEnvironment", () => {
  it("calls grackleClient.linkEnvironment with correct args", async () => {
    mockClient.linkEnvironment.mockResolvedValue({});

    const { result } = setup();

    await act(async () => {
      await result.current.linkEnvironment("ws-1", "env-2");
    });

    expect(mockClient.linkEnvironment).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      environmentId: "env-2",
    });
  });

  it("does not propagate RPC errors to caller", async () => {
    mockClient.linkEnvironment.mockRejectedValue(new Error("already linked"));

    const { result } = setup();

    await act(async () => {
      await result.current.linkEnvironment("ws-1", "env-2");
    });

    expect(mockClient.linkEnvironment).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      environmentId: "env-2",
    });
  });
});

describe("unlinkEnvironment", () => {
  it("calls grackleClient.unlinkEnvironment with correct args", async () => {
    mockClient.unlinkEnvironment.mockResolvedValue({});

    const { result } = setup();

    await act(async () => {
      await result.current.unlinkEnvironment("ws-1", "env-2");
    });

    expect(mockClient.unlinkEnvironment).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      environmentId: "env-2",
    });
  });

  it("does not propagate RPC errors to caller", async () => {
    mockClient.unlinkEnvironment.mockRejectedValue(new Error("not found"));

    const { result } = setup();

    await act(async () => {
      await result.current.unlinkEnvironment("ws-1", "env-2");
    });

    expect(mockClient.unlinkEnvironment).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      environmentId: "env-2",
    });
  });
});
