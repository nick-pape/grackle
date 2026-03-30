import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createDispatchPhase, type DispatchPhaseDeps } from "./dispatch-phase.js";
import type { DispatchQueueRow, TaskRow } from "@grackle-ai/database";

function makeQueueEntry(overrides: Partial<DispatchQueueRow> = {}): DispatchQueueRow {
  return {
    id: "dq-1",
    taskId: "task-1",
    environmentId: "env-1",
    personaId: "persona-1",
    notes: "",
    pipe: "",
    parentSessionId: "",
    enqueuedAt: "2026-03-29T00:00:00.000Z",
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "task-1",
    workspaceId: "ws-1",
    title: "Test Task",
    description: "",
    status: "not_started",
    branch: "",
    dependsOn: "[]",
    startedAt: null,
    completedAt: null,
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
    sortOrder: 0,
    parentTaskId: "",
    depth: 0,
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    scheduleId: "",
    ...overrides,
  };
}

function createMockDeps(): DispatchPhaseDeps {
  return {
    listPendingEntries: vi.fn().mockReturnValue([]),
    dequeueEntry: vi.fn(),
    getTask: vi.fn().mockReturnValue(makeTask()),
    hasCapacity: vi.fn().mockReturnValue(true),
    startTaskSession: vi.fn().mockResolvedValue(undefined),
    isEnvironmentConnected: vi.fn().mockReturnValue(true),
  };
}

describe("createDispatchPhase", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("is a no-op when the queue is empty", async () => {
    const deps = createMockDeps();
    const phase = createDispatchPhase(deps);
    await phase.execute();

    expect(deps.dequeueEntry).not.toHaveBeenCalled();
    expect(deps.startTaskSession).not.toHaveBeenCalled();
  });

  it("dispatches a queued task when capacity is available", async () => {
    const deps = createMockDeps();
    const entry = makeQueueEntry();
    vi.mocked(deps.listPendingEntries).mockReturnValue([entry]);

    const phase = createDispatchPhase(deps);
    await phase.execute();

    expect(deps.startTaskSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-1" }),
      { environmentId: "env-1", personaId: "persona-1", notes: "" },
    );
    // Dequeued after successful start (startTaskSession emits task.started internally)
    expect(deps.dequeueEntry).toHaveBeenCalledWith("task-1");
  });

  it("skips dispatch when environment is at capacity", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.hasCapacity).mockReturnValue(false);
    vi.mocked(deps.listPendingEntries).mockReturnValue([makeQueueEntry()]);

    const phase = createDispatchPhase(deps);
    await phase.execute();

    expect(deps.dequeueEntry).not.toHaveBeenCalled();
    expect(deps.startTaskSession).not.toHaveBeenCalled();
  });

  it("skips dispatch when environment is disconnected", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.isEnvironmentConnected).mockReturnValue(false);
    vi.mocked(deps.listPendingEntries).mockReturnValue([makeQueueEntry()]);

    const phase = createDispatchPhase(deps);
    await phase.execute();

    expect(deps.dequeueEntry).not.toHaveBeenCalled();
    expect(deps.startTaskSession).not.toHaveBeenCalled();
  });

  it("removes queue entry when task has been deleted", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getTask).mockReturnValue(undefined);
    vi.mocked(deps.listPendingEntries).mockReturnValue([makeQueueEntry()]);

    const phase = createDispatchPhase(deps);
    await phase.execute();

    expect(deps.dequeueEntry).toHaveBeenCalledWith("task-1");
    expect(deps.startTaskSession).not.toHaveBeenCalled();
  });

  it("handles multiple tasks in FIFO order — dispatches until capacity reached", async () => {
    const deps = createMockDeps();
    const entries = [
      makeQueueEntry({ id: "dq-1", taskId: "task-a", enqueuedAt: "2026-01-01T00:00:00.000Z" }),
      makeQueueEntry({ id: "dq-2", taskId: "task-b", enqueuedAt: "2026-01-01T00:00:01.000Z" }),
      makeQueueEntry({ id: "dq-3", taskId: "task-c", enqueuedAt: "2026-01-01T00:00:02.000Z" }),
    ];
    vi.mocked(deps.listPendingEntries).mockReturnValue(entries);

    // Allow first two, then capacity is full
    let callCount = 0;
    vi.mocked(deps.hasCapacity).mockImplementation(() => {
      callCount++;
      return callCount <= 2;
    });

    vi.mocked(deps.getTask).mockImplementation((id) => makeTask({ id }));

    const phase = createDispatchPhase(deps);
    await phase.execute();

    expect(deps.startTaskSession).toHaveBeenCalledTimes(2);
    expect(deps.dequeueEntry).toHaveBeenCalledWith("task-a");
    expect(deps.dequeueEntry).toHaveBeenCalledWith("task-b");
    // task-c should NOT have been dequeued or started
    expect(deps.dequeueEntry).not.toHaveBeenCalledWith("task-c");
  });

  it("keeps entry queued on startTaskSession failure for retry", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.listPendingEntries).mockReturnValue([makeQueueEntry()]);
    vi.mocked(deps.startTaskSession).mockResolvedValue("Environment not connected");

    const phase = createDispatchPhase(deps);
    await phase.execute();

    // Entry stays in queue for retry on next tick
    expect(deps.dequeueEntry).not.toHaveBeenCalled();
  });

  it("retries previously failed entry on next tick when capacity frees", async () => {
    const deps = createMockDeps();
    const entry = makeQueueEntry();
    vi.mocked(deps.listPendingEntries).mockReturnValue([entry]);

    // First tick: startTaskSession fails — entry stays queued
    vi.mocked(deps.startTaskSession).mockResolvedValue("PowerLine unavailable");
    const phase = createDispatchPhase(deps);
    await phase.execute();
    expect(deps.dequeueEntry).not.toHaveBeenCalled();

    // Second tick: startTaskSession succeeds — entry dequeued
    vi.mocked(deps.startTaskSession).mockResolvedValue(undefined);
    await phase.execute();
    expect(deps.dequeueEntry).toHaveBeenCalledWith("task-1");
  });

  it("has name 'dispatch'", () => {
    const deps = createMockDeps();
    const phase = createDispatchPhase(deps);
    expect(phase.name).toBe("dispatch");
  });
});
