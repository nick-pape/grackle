import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mock dependencies ────────────────────────────────────────

vi.mock("@grackle-ai/database", async () => {
  const { createDatabaseMock } = await import("../test-utils/mock-database.js");
  return createDatabaseMock();
});

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../log-writer.js", () => ({
  readLastTextEntry: vi.fn(() => undefined),
}));

vi.mock("../notification-router.js", () => ({
  routeEscalation: vi.fn().mockResolvedValue(undefined),
}));

import { SESSION_STATUS, ROOT_TASK_ID } from "@grackle-ai/common";
import { taskStore, sessionStore, escalationStore } from "@grackle-ai/database";
import { readLastTextEntry } from "../log-writer.js";
import { routeEscalation } from "../notification-router.js";
import { createEscalationAutoSubscriber } from "./escalation-auto.js";
import type { GrackleEvent } from "../event-bus.js";
import type { Disposable, PluginContext } from "../subscriber-types.js";

// ── Helpers ─────────────────────────────────────────────────

interface MockTask {
  id: string;
  parentTaskId: string;
  title: string;
  workspaceId: string;
}

interface MockSession {
  id: string;
  status: string;
  logPath: string;
}

function makeTask(overrides: Partial<MockTask> = {}): MockTask {
  return {
    id: "task-001",
    parentTaskId: "",
    title: "Test task",
    workspaceId: "ws1",
    ...overrides,
  };
}

function makeSession(overrides: Partial<MockSession> = {}): MockSession {
  return {
    id: "session-001",
    status: SESSION_STATUS.IDLE,
    logPath: "/tmp/test.log",
    ...overrides,
  };
}

/** Wait for queued microtasks to flush. */
async function flush(): Promise<void> {
  await new Promise<void>((r) => { setTimeout(r, 10); });
}

// ── Tests ───────────────────────────────────────────────────

describe("createEscalationAutoSubscriber", () => {
  let ctx: PluginContext;
  let capturedHandler: (event: GrackleEvent) => void;
  let disposable: Disposable;
  let unsubscribeFn: ReturnType<typeof vi.fn>;

  function fireTaskUpdated(taskId: string): void {
    capturedHandler({
      id: "evt-1",
      type: "task.updated",
      timestamp: new Date().toISOString(),
      payload: { taskId },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();

    unsubscribeFn = vi.fn();
    ctx = {
      subscribe: vi.fn((fn: (event: GrackleEvent) => void) => {
        capturedHandler = fn;
        return unsubscribeFn;
      }),
      emit: vi.fn(),
    };

    disposable = createEscalationAutoSubscriber(ctx);
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

  it("fires escalation when parentless non-ROOT task goes IDLE", async () => {
    const task = makeTask();
    const session = makeSession();
    vi.mocked(taskStore.getTask).mockReturnValue(task as never);
    vi.mocked(sessionStore.getLatestSessionForTask).mockReturnValue(session as never);

    fireTaskUpdated("task-001");
    await flush();

    expect(escalationStore.createEscalation).toHaveBeenCalledWith(
      expect.any(String), // ULID
      "ws1",
      "task-001",
      "Test task",
      expect.any(String),
      "auto",
      "normal",
      expect.any(String),
    );
    expect(routeEscalation).toHaveBeenCalled();
  });

  it("does NOT fire for child tasks (has parentTaskId)", async () => {
    const task = makeTask({ parentTaskId: "parent-001" });
    const session = makeSession();
    vi.mocked(taskStore.getTask).mockReturnValue(task as never);
    vi.mocked(sessionStore.getLatestSessionForTask).mockReturnValue(session as never);

    fireTaskUpdated("task-001");
    await flush();

    expect(escalationStore.createEscalation).not.toHaveBeenCalled();
  });

  it("does NOT fire for ROOT_TASK_ID", async () => {
    const task = makeTask({ id: ROOT_TASK_ID, parentTaskId: "" });
    const session = makeSession();
    vi.mocked(taskStore.getTask).mockReturnValue(task as never);
    vi.mocked(sessionStore.getLatestSessionForTask).mockReturnValue(session as never);

    fireTaskUpdated(ROOT_TASK_ID);
    await flush();

    expect(escalationStore.createEscalation).not.toHaveBeenCalled();
  });

  it("does NOT fire for non-IDLE statuses", async () => {
    const task = makeTask();
    const session = makeSession({ status: SESSION_STATUS.RUNNING });
    vi.mocked(taskStore.getTask).mockReturnValue(task as never);
    vi.mocked(sessionStore.getLatestSessionForTask).mockReturnValue(session as never);

    fireTaskUpdated("task-001");
    await flush();

    expect(escalationStore.createEscalation).not.toHaveBeenCalled();
  });

  it("deduplicates: same task+session pair only fires once", async () => {
    const task = makeTask();
    const session = makeSession();
    vi.mocked(taskStore.getTask).mockReturnValue(task as never);
    vi.mocked(sessionStore.getLatestSessionForTask).mockReturnValue(session as never);

    fireTaskUpdated("task-001");
    await flush();
    fireTaskUpdated("task-001");
    await flush();

    expect(escalationStore.createEscalation).toHaveBeenCalledTimes(1);
  });

  it("includes task title and last text message in escalation", async () => {
    const task = makeTask({ title: "Fix the auth bug" });
    const session = makeSession();
    vi.mocked(taskStore.getTask).mockReturnValue(task as never);
    vi.mocked(sessionStore.getLatestSessionForTask).mockReturnValue(session as never);
    vi.mocked(readLastTextEntry).mockReturnValue({ content: "Should I use JWT or cookies?" } as never);

    fireTaskUpdated("task-001");
    await flush();

    expect(escalationStore.createEscalation).toHaveBeenCalledWith(
      expect.any(String),
      "ws1",
      "task-001",
      "Fix the auth bug",
      "Should I use JWT or cookies?",
      "auto",
      "normal",
      expect.any(String),
    );
  });

  it("uses empty message when no last text entry exists", async () => {
    const task = makeTask();
    const session = makeSession();
    vi.mocked(taskStore.getTask).mockReturnValue(task as never);
    vi.mocked(sessionStore.getLatestSessionForTask).mockReturnValue(session as never);
    vi.mocked(readLastTextEntry).mockReturnValue(undefined as never);

    fireTaskUpdated("task-001");
    await flush();

    expect(escalationStore.createEscalation).toHaveBeenCalledWith(
      expect.any(String),
      "ws1",
      "task-001",
      "Test task",
      "",
      "auto",
      "normal",
      expect.any(String),
    );
  });
});
