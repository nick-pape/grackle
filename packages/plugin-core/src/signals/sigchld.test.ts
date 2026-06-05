import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { setupTestDatabase } from "@grackle-ai/test-utils";

// ── Mock dependencies ────────────────────────────────────────

// NOTE: @grackle-ai/database is NOT mocked — real stores run against
// an in-memory SQLite database initialized by setupTestDatabase().

vi.mock("@grackle-ai/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    logWriter: {
      initLog: vi.fn(),
      writeEvent: vi.fn(),
      endSession: vi.fn(),
      readLastTextEntry: vi.fn(() => undefined),
    },
    readLastTextEntry: vi.fn(() => undefined),
    streamHub: {
      publish: vi.fn(),
      createStream: vi.fn(() => {
        const iter = (async function* () {})();
        return Object.assign(iter, { cancel: vi.fn() });
      }),
      createGlobalStream: vi.fn(() => {
        const iter = (async function* () {})();
        return Object.assign(iter, { cancel: vi.fn() });
      }),
    },
    reanimateAgent: vi.fn(),
    deliverSignalToTask: vi.fn().mockResolvedValue(true),
  };
});

import { taskStore, sessionStore, envRegistry, workspaceStore } from "@grackle-ai/database";
import { readLastTextEntry, deliverSignalToTask } from "@grackle-ai/core";
import { createSigchldSubscriber } from "./sigchld.js";
import type { GrackleEvent } from "@grackle-ai/core";
import type { Disposable, PluginContext } from "@grackle-ai/plugin-sdk";
import { createMockPluginContext } from "../test-utils/mock-plugin-context.js";

// ── Test DB ───────────────────────────────────────────────────

const testDb = setupTestDatabase();
afterAll(() => testDb.cleanup());

// ── Helpers ──────────────────────────────────────────────────

function insertBaseEntities(): void {
  envRegistry.addEnvironment("env-1", "Test Env", "local", "{}");
  workspaceStore.createWorkspace("proj-1", "Test Project", "", "");
}

function insertParentTask(): void {
  taskStore.createTask("task-parent", "proj-1", "Parent Task", "", [], "proj-1", "", true);
}

function insertChildTask(
  id: string = "task-child",
  opts: { parentTaskId?: string | null; title?: string } = {},
): void {
  const parentTaskId = opts.parentTaskId === null ? "" : (opts.parentTaskId ?? "task-parent");
  taskStore.createTask(id, "proj-1", opts.title ?? "Design API", "", [], "proj-1", parentTaskId);
}

function insertSession(taskId: string, status: string, id?: string): void {
  const sessionId = id ?? `sess-${taskId}`;
  sessionStore.createSession(sessionId, "env-1", "stub", "", "claude", "/tmp/log-child", taskId);
  if (status !== "pending") {
    sessionStore.updateSession(sessionId, status as never);
  }
}

/** Wait for async event-bus microtask + fire-and-forget promise. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

// ── Tests ────────────────────────────────────────────────────

describe("createSigchldSubscriber", () => {
  let ctx: PluginContext;
  let capturedHandler: (event: GrackleEvent) => void;
  let disposable: Disposable;
  let unsubscribeFn: ReturnType<typeof vi.fn>;

  function fireTaskUpdated(taskId: string): void {
    capturedHandler({
      id: "evt-1",
      type: "task.updated",
      timestamp: new Date().toISOString(),
      payload: { taskId, workspaceId: "proj-1" },
    });
  }

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    testDb.truncateAll();
    insertBaseEntities();
    insertParentTask();

    unsubscribeFn = vi.fn();
    ctx = createMockPluginContext({
      subscribe: vi.fn((fn: (event: GrackleEvent) => void) => {
        capturedHandler = fn;
        return unsubscribeFn;
      }),
    });

    disposable = createSigchldSubscriber(ctx);
  });

  afterEach(() => {
    disposable.dispose();
  });

  it("subscribes to event bus on creation", () => {
    expect(ctx.subscribe).toHaveBeenCalledOnce();
  });

  it("unsubscribes on dispose", () => {
    disposable.dispose();
    expect(unsubscribeFn).toHaveBeenCalledOnce();
  });

  it("calls deliverSignalToTask with correct args when child goes idle", async () => {
    insertChildTask();
    insertSession("task-child", "idle");
    vi.mocked(readLastTextEntry).mockReturnValue({
      session_id: "sess-child",
      type: "text",
      timestamp: "",
      content: "Created PR #42.",
    });

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
    insertChildTask();
    // Create session and set status=stopped with endReason=killed via real DB
    const sid = "sess-task-child";
    sessionStore.createSession(sid, "env-1", "stub", "", "claude", "/tmp/log-child", "task-child");
    sessionStore.updateSession(sid, "stopped" as never, undefined, undefined, "killed" as never);
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
    insertChildTask();
    const sid = "sess-task-child";
    sessionStore.createSession(sid, "env-1", "stub", "", "claude", "/tmp/log-child", "task-child");
    sessionStore.updateSession(
      sid,
      "stopped" as never,
      undefined,
      undefined,
      "interrupted" as never,
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
    insertChildTask("task-root", { parentTaskId: null });
    insertSession("task-root", "idle");

    fireTaskUpdated("task-root");
    await flush();

    expect(deliverSignalToTask).not.toHaveBeenCalled();
  });

  it("skips non-triggering session statuses (running, pending)", async () => {
    insertChildTask();
    insertSession("task-child", "running");

    fireTaskUpdated("task-child");
    await flush();

    expect(deliverSignalToTask).not.toHaveBeenCalled();
  });

  it("does not duplicate delivery for same child session terminal event", async () => {
    insertChildTask();
    insertSession("task-child", "idle");
    vi.mocked(readLastTextEntry).mockReturnValue(undefined);

    // Fire twice for the same child
    fireTaskUpdated("task-child");
    await flush();
    fireTaskUpdated("task-child");
    await flush();

    expect(deliverSignalToTask).toHaveBeenCalledTimes(1);
  });

  it("notification text includes child ID, title, status, and last text message", async () => {
    insertChildTask("task-child", { title: "Implement auth flow" });
    insertSession("task-child", "idle");
    vi.mocked(readLastTextEntry).mockReturnValue({
      session_id: "sess-child",
      type: "text",
      timestamp: "",
      content: "All tests pass. PR created.",
    });

    fireTaskUpdated("task-child");
    await flush();

    const message = vi.mocked(deliverSignalToTask).mock.calls[0][2];
    expect(message).toContain("[SIGCHLD]");
    expect(message).toContain("task-child");
    expect(message).toContain("Implement auth flow");
    expect(message).toContain("finished working");
    expect(message).toContain("All tests pass. PR created.");
  });

  it("delivers SIGCHLD when child session has no parentSessionId (web-UI-started)", async () => {
    insertChildTask("task-child", { parentTaskId: "task-parent" });
    insertSession("task-child", "idle");
    vi.mocked(readLastTextEntry).mockReturnValue(undefined);

    fireTaskUpdated("task-child");
    await flush();

    // SIGCHLD delivery should still work — it's based on task.parentTaskId,
    // not session.parentSessionId
    expect(deliverSignalToTask).toHaveBeenCalledWith(
      "task-parent",
      "sigchld",
      expect.stringContaining("[SIGCHLD]"),
    );
  });

  it("retries delivery when first attempt fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    insertChildTask();
    insertSession("task-child", "idle");
    vi.mocked(readLastTextEntry).mockReturnValue(undefined);

    // First delivery fails, retry should succeed
    vi.mocked(deliverSignalToTask).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    fireTaskUpdated("task-child");
    // Advance past retry delays (MAX_DELIVERY_RETRIES * 1000ms + buffer)
    await vi.advanceTimersByTimeAsync(5000);

    // Should have been called twice: original attempt + retry
    expect(deliverSignalToTask).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not lose signal when concurrent handlers race and first fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    insertChildTask();
    insertSession("task-child", "idle");
    vi.mocked(readLastTextEntry).mockReturnValue(undefined);

    // First attempt fails, retry succeeds
    vi.mocked(deliverSignalToTask).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

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
    insertChildTask();
    insertSession("task-child", "idle");
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

  it("creates independent state per factory call (no shared module state)", async () => {
    // Create a second subscriber with its own context
    const unsub2 = vi.fn();
    let handler2: (event: GrackleEvent) => void;
    const ctx2: PluginContext = createMockPluginContext({
      subscribe: vi.fn((fn: (event: GrackleEvent) => void) => {
        handler2 = fn;
        return unsub2;
      }),
    });
    const disposable2 = createSigchldSubscriber(ctx2);

    insertChildTask();
    insertSession("task-child", "idle");
    vi.mocked(readLastTextEntry).mockReturnValue(undefined);

    // Fire via first subscriber
    fireTaskUpdated("task-child");
    await flush();

    // Fire via second subscriber — should ALSO deliver (independent dedup state)
    handler2!({
      id: "evt-2",
      type: "task.updated",
      timestamp: new Date().toISOString(),
      payload: { taskId: "task-child", workspaceId: "proj-1" },
    });
    await flush();

    expect(deliverSignalToTask).toHaveBeenCalledTimes(2);
    disposable2.dispose();
  });
});
