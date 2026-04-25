// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { ConnectError, Code } from "@connectrpc/connect";
import { useTasks } from "./useTasks.js";

// ---------------------------------------------------------------------------
// Mock grackleClient (vi.hoisted ensures the object exists before vi.mock runs)
// ---------------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  listTasks: vi.fn(),
  startTask: vi.fn(),
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

describe("useTasks startTask", () => {
  it("sets startingId and re-throws non-ResourceExhausted errors", async () => {
    const connectErr = new ConnectError("No environment specified", Code.FailedPrecondition);
    mockClient.startTask.mockRejectedValue(connectErr);

    const { result } = setup();

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.startTask("task-1");
      } catch (e) {
        caught = e;
      }
    });

    expect(result.current.taskStartingId).toBe(undefined);
    expect(caught).toBe(connectErr);
  });

  it("does NOT re-throw ResourceExhausted (task queued)", async () => {
    const resourceErr = new ConnectError("Environment at capacity", Code.ResourceExhausted);
    mockClient.startTask.mockRejectedValue(resourceErr);

    const { result } = setup();

    let threw = false;
    await act(async () => {
      try {
        await result.current.startTask("task-1");
      } catch {
        threw = true;
      }
    });

    // StartingId should remain set (task is queued)
    expect(result.current.taskStartingId).toBe("task-1");

    // Should not have thrown
    expect(threw).toBe(false);
  });

  it("clears startingId and re-throws on generic error", async () => {
    const genericErr = new Error("Something went wrong");
    mockClient.startTask.mockRejectedValue(genericErr);

    const { result } = setup();

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.startTask("task-1");
      } catch (e) {
        caught = e;
      }
    });

    expect(result.current.taskStartingId).toBe(undefined);
    expect(caught).toBe(genericErr);
  });
});
