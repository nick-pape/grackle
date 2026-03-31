// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSchedules } from "./useSchedules.js";
import type { GrackleEvent } from "@grackle-ai/web-components";

// ---------------------------------------------------------------------------
// Mock grackleClient (vi.hoisted ensures the object exists before vi.mock runs)
// ---------------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
}));

vi.mock("./useGrackleClient.js", () => ({
  schedulingClient: mockClient,
}));

// Mock proto-converters — identity passthrough for these tests
vi.mock("./proto-converters.js", () => ({
  protoToSchedule: (p: unknown) => p,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(): { result: { current: ReturnType<typeof useSchedules> } } {
  const { result } = renderHook(() => useSchedules());
  return { result };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSchedules loading state", () => {
  it("schedulesLoading starts false", () => {
    const { result } = setup();
    expect(result.current.schedulesLoading).toBe(false);
  });

  it("schedulesLoading flips true on loadSchedules(), then false on resolve", async () => {
    mockClient.listSchedules.mockResolvedValue({ schedules: [] });

    const { result } = setup();

    act(() => {
      result.current.loadSchedules().catch(() => {});
    });

    expect(result.current.schedulesLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.schedulesLoading).toBe(false);
    });
  });

  it("schedulesLoading flips false on RPC error", async () => {
    mockClient.listSchedules.mockRejectedValue(new Error("unavailable"));

    const { result } = setup();

    act(() => {
      result.current.loadSchedules().catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.schedulesLoading).toBe(false);
    });
  });
});

describe("useSchedules loadSchedules", () => {
  it("calls grackleClient.listSchedules and populates state", async () => {
    const mockSchedule = { id: "s1", title: "Nightly" };
    mockClient.listSchedules.mockResolvedValue({ schedules: [mockSchedule] });

    const { result } = setup();

    await act(async () => {
      await result.current.loadSchedules();
    });

    expect(mockClient.listSchedules).toHaveBeenCalledWith({});
    expect(result.current.schedules).toEqual([mockSchedule]);
  });

  it("silently swallows RPC errors and leaves state unchanged", async () => {
    mockClient.listSchedules.mockRejectedValue(new Error("network error"));

    const { result } = setup();

    await act(async () => {
      await result.current.loadSchedules();
    });

    expect(result.current.schedules).toEqual([]);
  });
});

describe("useSchedules createSchedule", () => {
  it("calls grackleClient.createSchedule with correct args and appends to state", async () => {
    const newSchedule = { id: "s2", title: "Daily", scheduleExpression: "1d", personaId: "p1" };
    mockClient.createSchedule.mockResolvedValue(newSchedule);

    const { result } = setup();

    let created: unknown;
    await act(async () => {
      created = await result.current.createSchedule("Daily", "", "1d", "p1");
    });

    expect(mockClient.createSchedule).toHaveBeenCalledWith({
      title: "Daily",
      description: "",
      scheduleExpression: "1d",
      personaId: "p1",
      environmentId: "",
      workspaceId: "",
      parentTaskId: "",
    });
    expect(created).toEqual(newSchedule);
    expect(result.current.schedules).toContainEqual(newSchedule);
  });

  it("passes optional environmentId, workspaceId, parentTaskId", async () => {
    const newSchedule = { id: "s3", title: "Custom" };
    mockClient.createSchedule.mockResolvedValue(newSchedule);

    const { result } = setup();

    await act(async () => {
      await result.current.createSchedule("Custom", "desc", "5m", "p2", "env-1", "ws-1", "task-1");
    });

    expect(mockClient.createSchedule).toHaveBeenCalledWith({
      title: "Custom",
      description: "desc",
      scheduleExpression: "5m",
      personaId: "p2",
      environmentId: "env-1",
      workspaceId: "ws-1",
      parentTaskId: "task-1",
    });
  });

  it("deduplicates: replaces existing schedule with same id on create", async () => {
    const existing = { id: "s1", title: "Old" };
    const updated = { id: "s1", title: "New" };
    mockClient.listSchedules.mockResolvedValue({ schedules: [existing] });
    mockClient.createSchedule.mockResolvedValue(updated);

    const { result } = setup();

    await act(async () => {
      await result.current.loadSchedules();
    });

    await act(async () => {
      await result.current.createSchedule("New", "", "5m", "p1");
    });

    const ids = result.current.schedules.map((s) => s.id);
    expect(ids.filter((id) => id === "s1")).toHaveLength(1);
    expect(result.current.schedules).toContainEqual(updated);
  });
});

describe("useSchedules updateSchedule", () => {
  it("calls grackleClient.updateSchedule with id + only provided fields", async () => {
    const updated = { id: "s1", title: "Updated", enabled: true };
    mockClient.updateSchedule.mockResolvedValue(updated);

    const { result } = setup();

    let returned: unknown;
    await act(async () => {
      returned = await result.current.updateSchedule("s1", { title: "Updated", enabled: true });
    });

    expect(mockClient.updateSchedule).toHaveBeenCalledWith({
      id: "s1",
      title: "Updated",
      enabled: true,
    });
    expect(returned).toEqual(updated);
  });

  it("replaces matching schedule in state after update", async () => {
    const original = { id: "s1", title: "Before" };
    const updatedSchedule = { id: "s1", title: "After" };
    mockClient.listSchedules.mockResolvedValue({ schedules: [original] });
    mockClient.updateSchedule.mockResolvedValue(updatedSchedule);

    const { result } = setup();

    await act(async () => {
      await result.current.loadSchedules();
    });

    await act(async () => {
      await result.current.updateSchedule("s1", { title: "After" });
    });

    expect(result.current.schedules).toContainEqual(updatedSchedule);
    expect(result.current.schedules).not.toContainEqual(original);
  });

  it("omits undefined fields from the update request", async () => {
    const updated = { id: "s2", scheduleExpression: "1h" };
    mockClient.updateSchedule.mockResolvedValue(updated);

    const { result } = setup();

    await act(async () => {
      await result.current.updateSchedule("s2", { scheduleExpression: "1h" });
    });

    const call = mockClient.updateSchedule.mock.calls[0][0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("title");
    expect(call).not.toHaveProperty("enabled");
    expect(call.scheduleExpression).toBe("1h");
  });
});

describe("useSchedules deleteSchedule", () => {
  it("calls grackleClient.deleteSchedule with the schedule id", async () => {
    mockClient.deleteSchedule.mockResolvedValue({});

    const { result } = setup();

    await act(async () => {
      await result.current.deleteSchedule("s1");
    });

    expect(mockClient.deleteSchedule).toHaveBeenCalledWith({ id: "s1" });
  });

  it("removes deleted schedule from state", async () => {
    const s1 = { id: "s1", title: "Keep" };
    const s2 = { id: "s2", title: "Delete Me" };
    mockClient.listSchedules.mockResolvedValue({ schedules: [s1, s2] });
    mockClient.deleteSchedule.mockResolvedValue({});

    const { result } = setup();

    await act(async () => {
      await result.current.loadSchedules();
    });

    await act(async () => {
      await result.current.deleteSchedule("s2");
    });

    expect(result.current.schedules).toContainEqual(s1);
    expect(result.current.schedules).not.toContainEqual(s2);
  });
});

describe("useSchedules handleEvent", () => {
  it.each(["schedule.created", "schedule.updated", "schedule.deleted"] as const)(
    "returns true and triggers reload for %s",
    async (eventType) => {
      mockClient.listSchedules.mockResolvedValue({ schedules: [] });

      const { result } = setup();

      let handled: boolean = false;
      act(() => {
        handled = result.current.handleEvent({ type: eventType } as GrackleEvent);
      });

      expect(handled).toBe(true);

      await waitFor(() => {
        expect(mockClient.listSchedules).toHaveBeenCalled();
      });
    },
  );

  it("returns true and triggers reload for schedule.fired (debounced)", async () => {
    vi.useFakeTimers();
    mockClient.listSchedules.mockResolvedValue({ schedules: [] });

    const { result } = setup();

    let handled: boolean = false;
    act(() => {
      handled = result.current.handleEvent({ type: "schedule.fired" } as GrackleEvent);
    });

    expect(handled).toBe(true);
    expect(mockClient.listSchedules).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(mockClient.listSchedules).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("returns false and does not reload for unrelated events", async () => {
    const { result } = setup();

    let handled: boolean = false;
    act(() => {
      handled = result.current.handleEvent({ type: "task.created" } as GrackleEvent);
    });

    expect(handled).toBe(false);
    expect(mockClient.listSchedules).not.toHaveBeenCalled();
  });
});
