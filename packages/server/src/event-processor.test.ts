import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { powerline } from "@grackle-ai/common";

// ── Mock all heavy dependencies before importing ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./log-writer.js", () => ({
  initLog: vi.fn(),
  writeEvent: vi.fn(),
  endSession: vi.fn(),
  readLog: vi.fn().mockReturnValue([]),
}));

vi.mock("./stream-hub.js", () => ({
  publish: vi.fn(),
}));

vi.mock("./ws-broadcast.js", () => ({
  broadcast: vi.fn(),
}));

vi.mock("./transcript.js", () => ({
  writeTranscript: vi.fn(),
}));

// Import AFTER mocks
import { processEventStream } from "./event-processor.js";
import * as sessionStore from "./session-store.js";
import * as taskStore from "./task-store.js";
import * as projectStore from "./project-store.js";
import * as processorRegistry from "./processor-registry.js";
import * as findingStore from "./finding-store.js";
import { broadcast } from "./ws-broadcast.js";
import * as logWriter from "./log-writer.js";
import { logger } from "./logger.js";
import { sqlite } from "./test-db.js";

/** Apply the minimal schema needed for tests. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      repo_url      TEXT NOT NULL DEFAULT '',
      default_env_id TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'active',
      use_worktrees INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id),
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'pending',
      branch        TEXT NOT NULL DEFAULT '',
      env_id        TEXT NOT NULL DEFAULT '',
      session_id    TEXT NOT NULL DEFAULT '',
      depends_on    TEXT NOT NULL DEFAULT '[]',
      assigned_at   TEXT,
      started_at    TEXT,
      completed_at  TEXT,
      review_notes  TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      sort_order    INTEGER NOT NULL DEFAULT 0,
      parent_task_id TEXT NOT NULL DEFAULT '',
      depth         INTEGER NOT NULL DEFAULT 0,
      can_decompose INTEGER NOT NULL DEFAULT 0,
      persona_id    TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      env_id        TEXT NOT NULL DEFAULT '',
      runtime       TEXT NOT NULL DEFAULT '',
      runtime_session_id TEXT,
      prompt        TEXT NOT NULL DEFAULT '',
      model         TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'pending',
      log_path      TEXT,
      turns         INTEGER NOT NULL DEFAULT 0,
      started_at    TEXT NOT NULL DEFAULT (datetime('now')),
      suspended_at  TEXT,
      ended_at      TEXT,
      error         TEXT,
      task_id       TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS findings (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL,
      task_id       TEXT NOT NULL DEFAULT '',
      session_id    TEXT NOT NULL DEFAULT '',
      category      TEXT NOT NULL DEFAULT 'general',
      title         TEXT NOT NULL,
      content       TEXT NOT NULL DEFAULT '',
      tags          TEXT NOT NULL DEFAULT '[]',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/** Create an async iterable from an array of AgentEvent messages. */
async function* eventStream(events: powerline.AgentEvent[]): AsyncIterable<powerline.AgentEvent> {
  for (const event of events) {
    yield event;
  }
}

/** Helper to wait for processEventStream to complete via onComplete callback. */
function waitForProcessing(
  events: powerline.AgentEvent[],
  options: { sessionId: string; logPath: string; projectId?: string; taskId?: string },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    processEventStream(eventStream(events), {
      ...options,
      onComplete: resolve,
      onError: reject,
    });
  });
}

describe("event-processor SUBTASK_CREATE handling", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS projects");
    applySchema();
    vi.clearAllMocks();

    projectStore.createProject("proj1", "Test Project", "desc", "", "env1");
  });

  it("creates a subtask when SUBTASK_CREATE event is received", async () => {
    // Create a decomposable parent task
    taskStore.createTask("parent1", "proj1", "Parent Task", "desc", "env1", [], "test-project", "", true);
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const subtaskEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "subtask_create",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        title: "Design API",
        description: "Design REST endpoints",
        local_id: "design",
        depends_on: [],
        can_decompose: false,
      }),
    });

    await waitForProcessing([subtaskEvent], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      projectId: "proj1",
      taskId: "parent1",
    });

    // Verify subtask was created
    const children = taskStore.getChildren("parent1");
    expect(children).toHaveLength(1);
    expect(children[0].title).toBe("Design API");
    expect(children[0].description).toBe("Design REST endpoints");
    expect(children[0].parentTaskId).toBe("parent1");
    expect(children[0].depth).toBe(1);
    expect(children[0].canDecompose).toBe(false);

    // Verify broadcast was called with task_created
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "task_created" }),
    );
  });

  it("resolves local_id dependencies between sibling subtasks", async () => {
    taskStore.createTask("parent1", "proj1", "Parent Task", "desc", "env1", [], "test-project", "", true);
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const event1 = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "subtask_create",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        title: "Research",
        description: "Do research",
        local_id: "research",
        depends_on: [],
      }),
    });

    const event2 = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "subtask_create",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        title: "Implement",
        description: "Do implementation",
        local_id: "impl",
        depends_on: ["research"],
      }),
    });

    await waitForProcessing([event1, event2], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      projectId: "proj1",
      taskId: "parent1",
    });

    const children = taskStore.getChildren("parent1");
    expect(children).toHaveLength(2);

    const research = children.find(c => c.title === "Research")!;
    const impl = children.find(c => c.title === "Implement")!;

    // The impl task should depend on the real ID of the research task
    const implDeps = JSON.parse(impl.dependsOn);
    expect(implDeps).toContain(research.id);
  });

  it("skips subtask creation when parent task cannot decompose", async () => {
    taskStore.createTask("parent1", "proj1", "Leaf Task", "desc", "env1", [], "test-project", "", false);
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const subtaskEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "subtask_create",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        title: "Should Not Create",
        description: "This should be rejected",
      }),
    });

    await waitForProcessing([subtaskEvent], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      projectId: "proj1",
      taskId: "parent1",
    });

    const children = taskStore.getChildren("parent1");
    expect(children).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "parent1" }),
      "Subtask creation failed: parent task cannot decompose",
    );
  });

  it("skips subtask creation when taskId is not provided", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const subtaskEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "subtask_create",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        title: "No Parent",
        description: "Should be ignored",
      }),
    });

    await waitForProcessing([subtaskEvent], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      projectId: "proj1",
      // no taskId
    });

    // No tasks should be created (only the parent we never made)
    const allTasks = taskStore.listTasks("proj1");
    expect(allTasks).toHaveLength(0);
  });

  it("warns on unknown local_id in depends_on but still creates the subtask", async () => {
    taskStore.createTask("parent1", "proj1", "Parent Task", "desc", "env1", [], "test-project", "", true);
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const subtaskEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "subtask_create",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        title: "Has Bad Dep",
        description: "Depends on nonexistent",
        depends_on: ["nonexistent_id"],
      }),
    });

    await waitForProcessing([subtaskEvent], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      projectId: "proj1",
      taskId: "parent1",
    });

    // Subtask should still be created, but with no resolved deps
    const children = taskStore.getChildren("parent1");
    expect(children).toHaveLength(1);
    expect(JSON.parse(children[0].dependsOn)).toEqual([]);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ localDep: "nonexistent_id" }),
      "Subtask dependency local_id not found, skipping",
    );
  });

  it("rejects subtask with empty title or description", async () => {
    taskStore.createTask("parent1", "proj1", "Parent Task", "desc", "env1", [], "test-project", "", true);
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const subtaskEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "subtask_create",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        title: "",
        description: "Has no title",
      }),
    });

    await waitForProcessing([subtaskEvent], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      projectId: "proj1",
      taskId: "parent1",
    });

    const children = taskStore.getChildren("parent1");
    expect(children).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "parent1" }),
      "Subtask creation failed: invalid title or description",
    );
  });

  it("detects duplicate local_id and keeps existing mapping", async () => {
    taskStore.createTask("parent1", "proj1", "Parent Task", "desc", "env1", [], "test-project", "", true);
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const event1 = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "subtask_create",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        title: "First",
        description: "First subtask",
        local_id: "dupe",
      }),
    });

    const event2 = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "subtask_create",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        title: "Second",
        description: "Second subtask with same local_id",
        local_id: "dupe",
      }),
    });

    const event3 = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "subtask_create",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        title: "Third",
        description: "Depends on dupe",
        depends_on: ["dupe"],
      }),
    });

    await waitForProcessing([event1, event2, event3], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      projectId: "proj1",
      taskId: "parent1",
    });

    const children = taskStore.getChildren("parent1");
    expect(children).toHaveLength(3);

    // The third task should depend on the FIRST task (existing mapping kept)
    const first = children.find(c => c.title === "First")!;
    const third = children.find(c => c.title === "Third")!;
    const thirdDeps = JSON.parse(third.dependsOn);
    expect(thirdDeps).toContain(first.id);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ localId: "dupe" }),
      "Duplicate subtask local_id encountered; keeping existing mapping",
    );
  });

  it("does not crash the stream on malformed SUBTASK_CREATE content", async () => {
    taskStore.createTask("parent1", "proj1", "Parent Task", "desc", "env1", [], "test-project", "", true);
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const badEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "subtask_create",
      timestamp: new Date().toISOString(),
      content: "not valid json",
    });

    const goodEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    });

    // Should not throw — bad event is caught, good event still processed
    await waitForProcessing([badEvent, goodEvent], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      projectId: "proj1",
      taskId: "parent1",
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "parent1" }),
      "Failed to create subtask",
    );

    // Session should still complete normally
    const session = sessionStore.getSession("sess1");
    expect(session?.status).toBe("completed");
  });
});

describe("stream error handling", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS projects");
    applySchema();
    vi.clearAllMocks();

    projectStore.createProject("proj1", "Test Project", "desc", "", "env1");
  });

  /** Create an async iterable that yields events, then throws an error. */
  async function* throwingStream(
    events: powerline.AgentEvent[],
    error: Error,
  ): AsyncIterable<powerline.AgentEvent> {
    for (const event of events) {
      yield event;
    }
    throw error;
  }

  it("marks session completed when stream errors during waiting_input", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const waitingEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "waiting_input",
    });

    let onErrorCalled = false;
    let onCompleteCalled = false;

    await new Promise<void>((resolve) => {
      processEventStream(
        throwingStream([waitingEvent], new Error("transport closed")),
        {
          sessionId: "sess1",
          logPath: "/tmp/log",
          onComplete: () => {
            onCompleteCalled = true;
            resolve();
          },
          onError: () => {
            onErrorCalled = true;
          },
        },
      );
    });

    const session = sessionStore.getSession("sess1");
    expect(session?.status).toBe("completed");
    expect(onErrorCalled).toBe(false);
    expect(onCompleteCalled).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess1" }),
      "Stream ended while session idle — marking completed",
    );
  });

  it("marks session failed when stream errors during running", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const textEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "text",
      timestamp: new Date().toISOString(),
      content: "some output",
    });

    let onErrorCalled = false;

    await new Promise<void>((resolve) => {
      processEventStream(
        throwingStream([textEvent], new Error("connection reset")),
        {
          sessionId: "sess1",
          logPath: "/tmp/log",
          onComplete: resolve,
          onError: () => {
            onErrorCalled = true;
          },
        },
      );
    });

    const session = sessionStore.getSession("sess1");
    expect(session?.status).toBe("failed");
    expect(onErrorCalled).toBe(true);
  });

  it("task moves to review when session completes via idle disconnect", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", "env1", [], "test-project");

    // Simulate task in_progress
    taskStore.setTaskSession("task1", "sess1");
    taskStore.markTaskStarted("task1");

    const waitingEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "waiting_input",
    });

    await new Promise<void>((resolve) => {
      processEventStream(
        throwingStream([waitingEvent], new Error("transport closed")),
        {
          sessionId: "sess1",
          logPath: "/tmp/log",
          projectId: "proj1",
          taskId: "task1",
          onComplete: () => {
            // Replicate the onComplete logic from ws-bridge.ts (updated guard)
            const t = taskStore.getTask("task1");
            if (t && (t.status === "in_progress" || t.status === "waiting_input")) {
              const sess = sessionStore.getSession("sess1");
              if (sess?.status === "completed") {
                taskStore.markTaskCompleted("task1", "review");
              } else if (sess?.status === "failed") {
                taskStore.markTaskCompleted("task1", "failed");
              }
            }
            resolve();
          },
        },
      );
    });

    const task = taskStore.getTask("task1");
    expect(task?.status).toBe("review");

    const session = sessionStore.getSession("sess1");
    expect(session?.status).toBe("completed");
  });
});

describe("task status sync with waiting_input", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS projects");
    applySchema();
    vi.clearAllMocks();

    projectStore.createProject("proj1", "Test Project", "desc", "", "env1");
  });

  it("sets task status to waiting_input when session receives waiting_input event", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", "env1", [], "test-project");
    taskStore.setTaskSession("task1", "sess1");
    taskStore.markTaskStarted("task1");

    const waitingEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "waiting_input",
    });

    const completedEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    });

    await waitForProcessing([waitingEvent, completedEvent], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      projectId: "proj1",
      taskId: "task1",
    });

    // Verify the task DB row was actually updated to waiting_input
    // (completed event ends the session but doesn't change task status — that's the caller's onComplete job)
    const task = taskStore.getTask("task1");
    expect(task?.status).toBe("waiting_input");

    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task_updated",
        payload: expect.objectContaining({ taskId: "task1", projectId: "proj1" }),
      }),
    );
  });

  it("reverts task from waiting_input to in_progress on running event", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", "env1", [], "test-project");
    taskStore.setTaskSession("task1", "sess1");
    taskStore.markTaskStarted("task1");

    const waitingEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "waiting_input",
    });

    const runningEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "running",
    });

    const completedEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    });

    await waitForProcessing([waitingEvent, runningEvent, completedEvent], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      projectId: "proj1",
      taskId: "task1",
    });

    // Task should have reverted to in_progress after the running event
    const task = taskStore.getTask("task1");
    expect(task?.status).toBe("in_progress");

    // Two task_updated broadcasts: one for waiting_input, one for in_progress
    const taskUpdatedCalls = (broadcast as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => (c[0] as { type: string }).type === "task_updated");
    expect(taskUpdatedCalls.length).toBe(2);
  });

  it("running event does not override non-waiting_input task status", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", "env1", [], "test-project");
    taskStore.setTaskSession("task1", "sess1");
    taskStore.markTaskStarted("task1");

    const runningEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "running",
    });

    const completedEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    });

    await waitForProcessing([runningEvent, completedEvent], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      projectId: "proj1",
      taskId: "task1",
    });

    // Task should remain in_progress (running does not override non-waiting_input status)
    const task = taskStore.getTask("task1");
    expect(task?.status).toBe("in_progress");

    // No task_updated broadcasts should have been made
    const taskUpdatedCalls = (broadcast as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => (c[0] as { type: string }).type === "task_updated");
    expect(taskUpdatedCalls.length).toBe(0);
  });

  it("task completes from waiting_input state via onComplete guard", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", "env1", [], "test-project");
    taskStore.setTaskSession("task1", "sess1");
    taskStore.markTaskStarted("task1");

    const waitingEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "waiting_input",
    });

    const completedEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    });

    await new Promise<void>((resolve) => {
      processEventStream(eventStream([waitingEvent, completedEvent]), {
        sessionId: "sess1",
        logPath: "/tmp/log",
        projectId: "proj1",
        taskId: "task1",
        onComplete: () => {
          // Replicate the onComplete logic with the updated guard
          const t = taskStore.getTask("task1");
          if (t && (t.status === "in_progress" || t.status === "waiting_input")) {
            const sess = sessionStore.getSession("sess1");
            if (sess?.status === "completed") {
              taskStore.markTaskCompleted("task1", "review");
            } else if (sess?.status === "failed") {
              taskStore.markTaskCompleted("task1", "failed");
            }
          }
          resolve();
        },
      });
    });

    const task = taskStore.getTask("task1");
    expect(task?.status).toBe("review");
  });
});

describe("late-binding", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS projects");
    applySchema();
    vi.clearAllMocks();

    projectStore.createProject("proj1", "Test Project", "desc", "", "env1");
    // Clean up any leftover processor registrations
    processorRegistry.unregister("sess1");
    // Reset readLog mock to return empty by default
    vi.mocked(logWriter.readLog).mockReturnValue([]);
  });

  /**
   * Create a controllable async iterable that yields events on demand.
   * Call push() to emit events and end() to close the stream.
   */
  function controllableStream(): {
    stream: AsyncIterable<powerline.AgentEvent>;
    push: (event: powerline.AgentEvent) => void;
    end: () => void;
  } {
    const queue: powerline.AgentEvent[] = [];
    let waiting: (() => void) | undefined;
    let done = false;

    const stream: AsyncIterable<powerline.AgentEvent> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<powerline.AgentEvent>> {
            while (queue.length === 0 && !done) {
              await new Promise<void>((resolve) => { waiting = resolve; });
            }
            if (queue.length > 0) {
              return { value: queue.shift()!, done: false };
            }
            return { value: undefined as unknown as powerline.AgentEvent, done: true };
          },
        };
      },
    };

    return {
      stream,
      push(event: powerline.AgentEvent) {
        queue.push(event);
        if (waiting) {
          waiting();
          waiting = undefined;
        }
      },
      end() {
        done = true;
        if (waiting) {
          waiting();
          waiting = undefined;
        }
      },
    };
  }

  it("processes finding events after late-bind", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", "env1", [], "test-project");

    const { stream, push, end } = controllableStream();
    const completed = new Promise<void>((resolve) => {
      processEventStream(stream, {
        sessionId: "sess1",
        logPath: "/tmp/log",
        onComplete: resolve,
      });
    });

    // Wait for stream to start processing
    await new Promise((r) => setTimeout(r, 50));

    // Late-bind the session to the task
    processorRegistry.lateBind("sess1", "task1", "proj1");

    // Now emit a finding event — should be processed with task context
    push(create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "finding",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({ title: "Test Finding", content: "Found something", category: "bug" }),
    }));

    // End the stream
    push(create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    }));
    end();

    await completed;

    // Verify finding was stored
    const findings = findingStore.queryFindings("proj1");
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe("Test Finding");
    expect(findings[0].projectId).toBe("proj1");
  });

  it("processes subtask events after late-bind", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Parent Task", "desc", "env1", [], "test-project", "", true);

    const { stream, push, end } = controllableStream();
    const completed = new Promise<void>((resolve) => {
      processEventStream(stream, {
        sessionId: "sess1",
        logPath: "/tmp/log",
        onComplete: resolve,
      });
    });

    await new Promise((r) => setTimeout(r, 50));

    // Late-bind
    processorRegistry.lateBind("sess1", "task1", "proj1");

    // Emit subtask creation event
    push(create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "subtask_create",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({ title: "Sub Task", description: "A subtask" }),
    }));

    push(create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    }));
    end();

    await completed;

    const children = taskStore.getChildren("task1");
    expect(children).toHaveLength(1);
    expect(children[0].title).toBe("Sub Task");
  });

  it("syncs task status after late-bind", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", "env1", [], "test-project");
    taskStore.markTaskStarted("task1");

    const { stream, push, end } = controllableStream();
    const completed = new Promise<void>((resolve) => {
      processEventStream(stream, {
        sessionId: "sess1",
        logPath: "/tmp/log",
        onComplete: resolve,
      });
    });

    await new Promise((r) => setTimeout(r, 50));

    // Late-bind
    processorRegistry.lateBind("sess1", "task1", "proj1");

    // Emit waiting_input — should sync task status
    push(create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "waiting_input",
    }));

    // Give it a tick to process
    await new Promise((r) => setTimeout(r, 50));

    const task = taskStore.getTask("task1");
    expect(task?.status).toBe("waiting_input");

    push(create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    }));
    end();

    await completed;
  });

  it("fires onComplete callback set by late-bind (task → review)", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", "env1", [], "test-project");
    taskStore.markTaskStarted("task1");

    const { stream, push, end } = controllableStream();
    const completed = new Promise<void>((resolve) => {
      processEventStream(stream, {
        sessionId: "sess1",
        logPath: "/tmp/log",
        // No onComplete initially — it will be set by lateBind
      });
      // We need to detect completion differently since no onComplete was set.
      // The lateBind onComplete will be called in finally. We'll poll.
      const interval = setInterval(() => {
        const s = sessionStore.getSession("sess1");
        if (s && ["completed", "failed", "killed"].includes(s.status)) {
          clearInterval(interval);
          // Give the finally block time to run
          setTimeout(resolve, 50);
        }
      }, 20);
    });

    await new Promise((r) => setTimeout(r, 50));

    // Late-bind with onComplete that moves task to review
    const onComplete = (): void => {
      const t = taskStore.getTask("task1");
      if (t && (t.status === "in_progress" || t.status === "waiting_input")) {
        const sess = sessionStore.getSession("sess1");
        if (sess?.status === "completed") {
          taskStore.markTaskCompleted("task1", "review");
        }
      }
    };
    processorRegistry.lateBind("sess1", "task1", "proj1", onComplete);

    push(create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    }));
    end();

    await completed;

    const task = taskStore.getTask("task1");
    expect(task?.status).toBe("review");
  });

  it("replays pre-association finding events from log on late-bind", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", "env1", [], "test-project");

    // Mock readLog to return a pre-existing finding event
    vi.mocked(logWriter.readLog).mockReturnValue([
      {
        session_id: "sess1",
        type: "finding",
        timestamp: new Date().toISOString(),
        content: JSON.stringify({ title: "Pre-bind Finding", content: "Found before bind", category: "info" }),
      },
    ]);

    const { stream, push, end } = controllableStream();
    const completed = new Promise<void>((resolve) => {
      processEventStream(stream, {
        sessionId: "sess1",
        logPath: "/tmp/log",
        onComplete: resolve,
      });
    });

    await new Promise((r) => setTimeout(r, 50));

    // Late-bind — should trigger replay
    processorRegistry.lateBind("sess1", "task1", "proj1");

    // Give replay time to run
    await new Promise((r) => setTimeout(r, 50));

    // Verify the pre-bind finding was stored
    const findings = findingStore.queryFindings("proj1");
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe("Pre-bind Finding");

    push(create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    }));
    end();

    await completed;
  });

  it("replay does not re-publish events to streamHub", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", "env1", [], "test-project");

    vi.mocked(logWriter.readLog).mockReturnValue([
      {
        session_id: "sess1",
        type: "finding",
        timestamp: new Date().toISOString(),
        content: JSON.stringify({ title: "Replay Finding", content: "test", category: "info" }),
      },
    ]);

    const { stream, push, end } = controllableStream();
    const completed = new Promise<void>((resolve) => {
      processEventStream(stream, {
        sessionId: "sess1",
        logPath: "/tmp/log",
        onComplete: resolve,
      });
    });

    await new Promise((r) => setTimeout(r, 50));

    // Clear publish mock to only track replay calls
    const { publish } = await import("./stream-hub.js");
    vi.mocked(publish).mockClear();

    processorRegistry.lateBind("sess1", "task1", "proj1");
    await new Promise((r) => setTimeout(r, 50));

    // streamHub.publish should NOT have been called by replay
    // (broadcast for finding_posted IS expected, but streamHub.publish is not)
    expect(publish).not.toHaveBeenCalled();

    push(create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    }));
    end();

    await completed;
  });

  it("processor is unregistered after stream ends", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    await waitForProcessing([], {
      sessionId: "sess1",
      logPath: "/tmp/log",
    });

    expect(processorRegistry.get("sess1")).toBeUndefined();
  });

  it("processor is registered during stream processing", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const { stream, push, end } = controllableStream();
    processEventStream(stream, {
      sessionId: "sess1",
      logPath: "/tmp/log",
    });

    await new Promise((r) => setTimeout(r, 50));

    // Should be registered while stream is active
    expect(processorRegistry.get("sess1")).toBeDefined();
    expect(processorRegistry.get("sess1")?.sessionId).toBe("sess1");

    push(create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    }));
    end();

    // Wait for cleanup
    await new Promise((r) => setTimeout(r, 100));
    expect(processorRegistry.get("sess1")).toBeUndefined();
  });
});
