import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock dependencies ────────────────────────────────────────

vi.mock("@grackle-ai/database", async () => {
  const { createDatabaseMock } = await import("../test-utils/mock-database.js");
  return createDatabaseMock();
});

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../log-writer.js", () => ({
  initLog: vi.fn(),
  writeEvent: vi.fn(),
  endSession: vi.fn(),
  readLastTextEntry: vi.fn(() => undefined),
}));

vi.mock("../stream-hub.js", () => ({
  publish: vi.fn(),
  createStream: vi.fn(() => {
    const iter = (async function* () {})();
    return Object.assign(iter, { cancel: vi.fn() });
  }),
  createGlobalStream: vi.fn(() => {
    const iter = (async function* () {})();
    return Object.assign(iter, { cancel: vi.fn() });
  }),
}));


vi.mock("../event-bus.js", () => {
  const subscribers: Array<(event: unknown) => void> = [];
  return {
    emit: vi.fn(),
    subscribe: vi.fn((fn: (event: unknown) => void) => {
      subscribers.push(fn);
      return () => {
        const idx = subscribers.indexOf(fn);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    }),
    _testFire: (event: unknown) => {
      for (const fn of subscribers) fn(event);
    },
    _testReset: () => { subscribers.length = 0; },
  };
});

vi.mock("../reanimate-agent.js", () => ({
  reanimateAgent: vi.fn(),
}));

vi.mock("./signal-delivery.js", () => ({
  deliverSignalToTask: vi.fn().mockResolvedValue(true),
}));

import { taskStore, sessionStore } from "@grackle-ai/database";
import { readLastTextEntry } from "../log-writer.js";
import { deliverSignalToTask } from "./signal-delivery.js";
import { initSigchldSubscriber, _resetForTesting } from "./sigchld.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eventBusMock = await import("../event-bus.js") as any;

// ── Helpers ──────────────────────────────────────────────────

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-child",
    workspaceId: "proj-1",
    title: "Design API",
    description: "",
    status: "working",
    branch: null,
    dependsOn: "[]",
    parentTaskId: "task-parent",
    depth: 1,
    canDecompose: false,
    defaultPersonaId: null,
    sortOrder: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess-child",
    environmentId: "env-1",
    status: "stopped",
    runtime: "stub",
    runtimeSessionId: "rt-1",
    prompt: "",
    model: "claude",
    logPath: "/tmp/log-child",
    turns: 5,
    startedAt: new Date().toISOString(),
    suspendedAt: null,
    endedAt: new Date().toISOString(),
    error: null,
    taskId: "task-child",
    personaId: null,
    endReason: "completed",
    ...overrides,
  };
}

function fireTaskUpdated(taskId: string) {
  eventBusMock._testFire({
    id: "evt-1",
    type: "task.updated",
    timestamp: new Date().toISOString(),
    payload: { taskId, workspaceId: "proj-1" },
  });
}

/** Wait for async event-bus microtask + fire-and-forget promise. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

// ── Tests ────────────────────────────────────────────────────

describe("initSigchldSubscriber", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    _resetForTesting();
    eventBusMock._testReset();
    initSigchldSubscriber();
  });

  it("calls deliverSignalToTask with correct args when child goes idle", async () => {
    vi.spyOn(taskStore, "getTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeTask() as any,
    );
    vi.spyOn(sessionStore, "getLatestSessionForTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeSession({ status: "idle" }) as any,
    );
    vi.mocked(readLastTextEntry).mockReturnValue(
      { session_id: "sess-child", type: "text", timestamp: "", content: "Created PR #42." },
    );

    fireTaskUpdated("task-child");
    await flush();

    expect(deliverSignalToTask).toHaveBeenCalledWith(
      "task-parent",
      "sigchld",
      expect.stringContaining("[SIGCHLD]"),
    );
    expect(deliverSignalToTask).toHaveBeenCalledWith(
      "task-parent",
      "sigchld",
      expect.stringContaining("finished working"),
    );
  });

  it("calls deliverSignalToTask when child stopped with killed reason", async () => {
    vi.spyOn(taskStore, "getTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeTask() as any,
    );
    vi.spyOn(sessionStore, "getLatestSessionForTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeSession({ status: "stopped", endReason: "killed" }) as any,
    );
    vi.mocked(readLastTextEntry).mockReturnValue(undefined);

    fireTaskUpdated("task-child");
    await flush();

    expect(deliverSignalToTask).toHaveBeenCalledWith(
      "task-parent",
      "sigchld",
      expect.stringContaining("was killed"),
    );
  });

  it("calls deliverSignalToTask when child stopped with interrupted reason", async () => {
    vi.spyOn(taskStore, "getTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeTask() as any,
    );
    vi.spyOn(sessionStore, "getLatestSessionForTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeSession({ status: "stopped", endReason: "interrupted" }) as any,
    );
    vi.mocked(readLastTextEntry).mockReturnValue(undefined);

    fireTaskUpdated("task-child");
    await flush();

    expect(deliverSignalToTask).toHaveBeenCalledWith(
      "task-parent",
      "sigchld",
      expect.stringContaining("crashed unexpectedly"),
    );
  });

  it("skips root tasks (no parentTaskId)", async () => {
    vi.spyOn(taskStore, "getTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeTask({ parentTaskId: null }) as any,
    );

    fireTaskUpdated("task-root");
    await flush();

    expect(deliverSignalToTask).not.toHaveBeenCalled();
  });

  it("skips non-triggering session statuses (running, pending)", async () => {
    vi.spyOn(taskStore, "getTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeTask() as any,
    );

    vi.spyOn(sessionStore, "getLatestSessionForTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeSession({ status: "running" }) as any,
    );
    fireTaskUpdated("task-child");
    await flush();
    expect(deliverSignalToTask).not.toHaveBeenCalled();
  });

  it("does not duplicate delivery for same child session terminal event", async () => {
    vi.spyOn(taskStore, "getTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeTask() as any,
    );
    vi.spyOn(sessionStore, "getLatestSessionForTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeSession({ status: "idle" }) as any,
    );
    vi.mocked(readLastTextEntry).mockReturnValue(undefined);

    // Fire twice for the same child
    fireTaskUpdated("task-child");
    await flush();
    fireTaskUpdated("task-child");
    await flush();

    expect(deliverSignalToTask).toHaveBeenCalledTimes(1);
  });

  it("notification text includes child ID, title, status, and last text message", async () => {
    vi.spyOn(taskStore, "getTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeTask({ title: "Implement auth flow" }) as any,
    );
    vi.spyOn(sessionStore, "getLatestSessionForTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeSession({ status: "idle" }) as any,
    );
    vi.mocked(readLastTextEntry).mockReturnValue(
      { session_id: "sess-child", type: "text", timestamp: "", content: "All tests pass. PR created." },
    );

    fireTaskUpdated("task-child");
    await flush();

    const message = vi.mocked(deliverSignalToTask).mock.calls[0][2];
    expect(message).toContain("[SIGCHLD]");
    expect(message).toContain("task-child");
    expect(message).toContain("Implement auth flow");
    expect(message).toContain("finished working");
    expect(message).toContain("All tests pass. PR created.");
  });

  it("retries delivery when first attempt fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(taskStore, "getTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeTask() as any,
    );
    vi.spyOn(sessionStore, "getLatestSessionForTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeSession({ status: "idle" }) as any,
    );
    vi.mocked(readLastTextEntry).mockReturnValue(undefined);

    // First delivery fails, retry should succeed
    vi.mocked(deliverSignalToTask)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    fireTaskUpdated("task-child");
    // Advance past retry delays (MAX_DELIVERY_RETRIES * 1000ms + buffer)
    await vi.advanceTimersByTimeAsync(5000);

    // Should have been called twice: original attempt + retry
    expect(deliverSignalToTask).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not lose signal when concurrent handlers race and first fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(taskStore, "getTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeTask() as any,
    );
    vi.spyOn(sessionStore, "getLatestSessionForTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeSession({ status: "idle" }) as any,
    );
    vi.mocked(readLastTextEntry).mockReturnValue(undefined);

    // First attempt fails, retry succeeds
    vi.mocked(deliverSignalToTask)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    // Fire two events concurrently — handler B should be deduped,
    // but handler A should retry and succeed
    fireTaskUpdated("task-child");
    fireTaskUpdated("task-child");
    await vi.advanceTimersByTimeAsync(5000);

    // At least one successful delivery must happen (via retry)
    const calls = vi.mocked(deliverSignalToTask).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });

  it("deletes dedup key only after all retries are exhausted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(taskStore, "getTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeTask() as any,
    );
    vi.spyOn(sessionStore, "getLatestSessionForTask").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeSession({ status: "idle" }) as any,
    );
    vi.mocked(readLastTextEntry).mockReturnValue(undefined);

    // All attempts fail
    vi.mocked(deliverSignalToTask).mockResolvedValue(false);

    fireTaskUpdated("task-child");
    await vi.advanceTimersByTimeAsync(10000);

    // After all retries exhausted, a subsequent event should try again
    vi.mocked(deliverSignalToTask).mockResolvedValue(true);
    fireTaskUpdated("task-child");
    await vi.advanceTimersByTimeAsync(5000);

    // The last call should have succeeded
    const lastCall = vi.mocked(deliverSignalToTask).mock.results.at(-1);
    expect(await lastCall?.value).toBe(true);
    vi.useRealTimers();
  });
});
