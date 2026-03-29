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
  readLastTextEntry: vi.fn(() => undefined),
}));

vi.mock("../event-bus.js", () => {
  const subscribers: Array<(event: unknown) => void> = [];
  return {
    emit: vi.fn(),
    subscribe: vi.fn((fn: (event: unknown) => void) => {
      subscribers.push(fn);
      return () => {
        const idx = subscribers.indexOf(fn);
        if (idx >= 0) { subscribers.splice(idx, 1); }
      };
    }),
    _testFire: (event: unknown) => {
      for (const fn of subscribers) { fn(event); }
    },
    _testReset: () => { subscribers.length = 0; },
  };
});

vi.mock("../notification-router.js", () => ({
  routeEscalation: vi.fn().mockResolvedValue(undefined),
}));

import { SESSION_STATUS, ROOT_TASK_ID } from "@grackle-ai/common";
import { taskStore, sessionStore, escalationStore } from "@grackle-ai/database";
import { readLastTextEntry } from "../log-writer.js";
import { routeEscalation } from "../notification-router.js";
import { initEscalationAutoSubscriber, _resetForTesting } from "./escalation-auto.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eventBusMock = await import("../event-bus.js") as any;

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

function fireTaskUpdated(taskId: string): void {
  eventBusMock._testFire({
    id: "evt-1",
    type: "task.updated",
    timestamp: new Date().toISOString(),
    payload: { taskId },
  });
}

/** Wait for queued microtasks to flush. */
async function flush(): Promise<void> {
  await new Promise<void>((r) => { setTimeout(r, 10); });
}

// ── Tests ───────────────────────────────────────────────────

describe("escalation-auto subscriber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    eventBusMock._testReset();
    initEscalationAutoSubscriber();
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
