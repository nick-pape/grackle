// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTasks } from "./useTasks.js";

// ---------------------------------------------------------------------------
// Mock grackleClient (vi.hoisted ensures the object exists before vi.mock runs)
// ---------------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  listTasks: vi.fn(),
}));

vi.mock("./useGrackleClient.js", () => ({
  orchestrationClient: mockClient,
}));

// Mock proto-converters — identity passthrough for these tests
vi.mock("./proto-converters.js", () => ({
  protoToTask: (t: unknown) => t,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(): { result: { current: ReturnType<typeof useTasks> } } {
  const { result } = renderHook(() => useTasks());
  return { result };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useTasks loading state", () => {
  it("tasksLoading starts false", () => {
    const { result } = setup();
    expect(result.current.tasksLoading).toBe(false);
  });

  it("tasksLoading flips true on loadAllTasks(), then false on resolve", async () => {
    mockClient.listTasks.mockResolvedValue({ tasks: [] });

    const { result } = setup();

    act(() => {
      result.current.loadAllTasks().catch(() => {});
    });

    expect(result.current.tasksLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.tasksLoading).toBe(false);
    });
  });

  it("tasksLoading flips false on RPC error", async () => {
    mockClient.listTasks.mockRejectedValue(new Error("unavailable"));

    const { result } = setup();

    act(() => {
      result.current.loadAllTasks().catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.tasksLoading).toBe(false);
    });
  });
});
