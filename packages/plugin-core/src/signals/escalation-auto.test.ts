import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { setupTestDatabase } from "@grackle-ai/test-utils/db";

// ── Mock dependencies ────────────────────────────────────────

// NOTE: @grackle-ai/database is NOT mocked — real stores run against
// an in-memory SQLite database initialized by setupTestDatabase().

vi.mock("@grackle-ai/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    readLastTextEntry: vi.fn(() => undefined),
    routeEscalation: vi.fn().mockResolvedValue(undefined),
  };
});

import { SESSION_STATUS, ROOT_TASK_ID } from "@grackle-ai/common";
import {
  taskStore,
  sessionStore,
  escalationStore,
  envRegistry,
  workspaceStore,
} from "@grackle-ai/database";
import { readLastTextEntry, routeEscalation } from "@grackle-ai/core";
import { createEscalationAutoSubscriber } from "./escalation-auto.js";
import type { GrackleEvent } from "@grackle-ai/core";
import type { Disposable, PluginContext } from "@grackle-ai/plugin-sdk";
import { createMockPluginContext } from "../test-utils/mock-plugin-context.js";

// ── Test DB ───────────────────────────────────────────────────

const testDb = setupTestDatabase();
afterAll(() => testDb.cleanup());

// ── Helpers ─────────────────────────────────────────────────

function insertBaseEntities(): void {
  envRegistry.addEnvironment("env-1", "Test Env", "local", "{}");
  workspaceStore.createWorkspace("ws1", "Test Workspace", "", "");
}

function insertTask(id: string, opts: { parentTaskId?: string; title?: string } = {}): void {
  const parentTaskId = opts.parentTaskId ?? "";
  if (parentTaskId) {
    // Ensure parent exists and has canDecompose
    const parent = taskStore.getTask(parentTaskId);
    if (!parent) {
      taskStore.createTask(parentTaskId, "ws1", "Parent", "", [], "ws1", "", true);
    }
  }
  taskStore.createTask(id, "ws1", opts.title ?? "Test task", "", [], "ws1", parentTaskId);
}

function insertSession(taskId: string, status: string): void {
  const sessionId = `sess-${taskId}`;
  sessionStore.createSession(sessionId, "env-1", "stub", "", "claude", "/tmp/test.log", taskId);
  if (status !== "pending") {
    sessionStore.updateSession(sessionId, status as never);
  }
}

/** Wait for queued microtasks to flush. */
async function flush(): Promise<void> {
  await new Promise<void>((r) => {
    setTimeout(r, 10);
  });
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
    testDb.truncateAll();
    insertBaseEntities();

    unsubscribeFn = vi.fn();
    ctx = createMockPluginContext({
      subscribe: vi.fn((fn: (event: GrackleEvent) => void) => {
        capturedHandler = fn;
        return unsubscribeFn;
      }),
    });

    vi.spyOn(escalationStore, "createEscalation");

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
    insertTask("task-001");
    insertSession("task-001", SESSION_STATUS.IDLE);

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
    insertTask("task-001", { parentTaskId: "parent-001" });
    insertSession("task-001", SESSION_STATUS.IDLE);

    fireTaskUpdated("task-001");
    await flush();

    expect(escalationStore.createEscalation).not.toHaveBeenCalled();
  });

  it("does NOT fire for ROOT_TASK_ID", async () => {
    insertTask(ROOT_TASK_ID);
    insertSession(ROOT_TASK_ID, SESSION_STATUS.IDLE);

    fireTaskUpdated(ROOT_TASK_ID);
    await flush();

    expect(escalationStore.createEscalation).not.toHaveBeenCalled();
  });

  it("does NOT fire for non-IDLE statuses", async () => {
    insertTask("task-001");
    insertSession("task-001", SESSION_STATUS.RUNNING);

    fireTaskUpdated("task-001");
    await flush();

    expect(escalationStore.createEscalation).not.toHaveBeenCalled();
  });

  it("deduplicates: same task+session pair only fires once", async () => {
    insertTask("task-001");
    insertSession("task-001", SESSION_STATUS.IDLE);

    fireTaskUpdated("task-001");
    await flush();
    fireTaskUpdated("task-001");
    await flush();

    expect(escalationStore.createEscalation).toHaveBeenCalledTimes(1);
  });

  it("includes task title and last text message in escalation", async () => {
    insertTask("task-001", { title: "Fix the auth bug" });
    insertSession("task-001", SESSION_STATUS.IDLE);
    vi.mocked(readLastTextEntry).mockReturnValue({
      content: "Should I use JWT or cookies?",
    } as never);

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
    insertTask("task-001");
    insertSession("task-001", SESSION_STATUS.IDLE);
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
