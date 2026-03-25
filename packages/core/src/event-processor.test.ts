import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { powerline } from "@grackle-ai/common";

// ── Mock all heavy dependencies before importing ──────────────
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

vi.mock("./event-bus.js", () => ({
  emit: vi.fn(),
}));

vi.mock("./transcript.js", () => ({
  writeTranscript: vi.fn(),
}));

// Import AFTER mocks
import { openDatabase, initDatabase, sqlite as _sqlite, sessionStore, taskStore, workspaceStore, findingStore } from "@grackle-ai/database";
openDatabase(":memory:");
initDatabase();
const sqlite = _sqlite!;
import { processEventStream } from "./event-processor.js";
import * as processorRegistry from "./processor-registry.js";
import { emit } from "./event-bus.js";
import * as logWriter from "./log-writer.js";
import { logger } from "./logger.js";

/** Apply the minimal schema needed for tests. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      repo_url      TEXT NOT NULL DEFAULT '',
      environment_id TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'active',
      use_worktrees INTEGER NOT NULL DEFAULT 1,
      working_directory TEXT NOT NULL DEFAULT '',
      default_persona_id TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT REFERENCES workspaces(id),
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'pending',
      branch        TEXT NOT NULL DEFAULT '',
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
      default_persona_id TEXT NOT NULL DEFAULT '',
      workpad   TEXT NOT NULL DEFAULT '',
      schedule_id TEXT NOT NULL DEFAULT ''
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
      task_id       TEXT NOT NULL DEFAULT '',
      persona_id    TEXT NOT NULL DEFAULT '',
      parent_session_id TEXT NOT NULL DEFAULT '',
      pipe_mode         TEXT NOT NULL DEFAULT '',
      input_tokens      INTEGER NOT NULL DEFAULT 0,
      output_tokens     INTEGER NOT NULL DEFAULT 0,
      cost_usd          REAL NOT NULL DEFAULT 0,
      end_reason        TEXT
    );

    CREATE TABLE IF NOT EXISTS findings (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL,
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

/** Helper to wait for processEventStream to complete by polling session status
 *  or detecting the finally block has run (endSession called). */
function waitForProcessing(
  events: powerline.AgentEvent[],
  options: { sessionId: string; logPath: string; workspaceId?: string; taskId?: string },
): Promise<void> {
  const endSessionCallsBefore = vi.mocked(logWriter.endSession).mock.calls.length;
  return new Promise<void>((resolve, reject) => {
    const interval = setInterval(() => {
      const s = sessionStore.getSession(options.sessionId);
      // Resolve when session reaches terminal status
      if (s && ["stopped", "suspended"].includes(s.status)) {
        clearInterval(interval);
        setTimeout(resolve, 50);
        return;
      }
      // Also resolve when the finally block has run (stream ended without terminal status)
      if (vi.mocked(logWriter.endSession).mock.calls.length > endSessionCallsBefore) {
        clearInterval(interval);
        setTimeout(resolve, 50);
      }
    }, 20);

    processEventStream(eventStream(events), {
      ...options,
    });
  });
}

describe("event-processor SUBTASK_CREATE handling", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    vi.clearAllMocks();

    workspaceStore.createWorkspace("proj1", "Test Project", "desc", "", "env1");
  });

  it("creates a subtask when SUBTASK_CREATE event is received", async () => {
    // Create a decomposable parent task
    taskStore.createTask("parent1", "proj1", "Parent Task", "desc", [], "test-workspace", "", true);
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
      workspaceId: "proj1",
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

    // Verify emit was called with task.created
    expect(emit).toHaveBeenCalledWith(
      "task.created",
      expect.objectContaining({ taskId: expect.any(String), workspaceId: "proj1" }),
    );
  });

  it("resolves local_id dependencies between sibling subtasks", async () => {
    taskStore.createTask("parent1", "proj1", "Parent Task", "desc", [], "test-workspace", "", true);
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
      workspaceId: "proj1",
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
    taskStore.createTask("parent1", "proj1", "Leaf Task", "desc", [], "test-workspace", "", false);
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
      workspaceId: "proj1",
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
      workspaceId: "proj1",
      // no taskId
    });

    // No tasks should be created (only the parent we never made)
    const allTasks = taskStore.listTasks("proj1");
    expect(allTasks).toHaveLength(0);
  });

  it("rejects subtask with unresolvable depends_on local_id", async () => {
    taskStore.createTask("parent1", "proj1", "Parent Task", "desc", [], "test-workspace", "", true);
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
      workspaceId: "proj1",
      taskId: "parent1",
    });

    // Subtask should NOT be created
    const children = taskStore.getChildren("parent1");
    expect(children).toHaveLength(0);

    // Should log error (caught by the internal catch block)
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "parent1" }),
      "Failed to create subtask",
    );
  });

  it("rejects subtask when any depends_on local_id is unresolvable, even if others resolve", async () => {
    taskStore.createTask("parent1", "proj1", "Parent Task", "desc", [], "test-workspace", "", true);
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
        depends_on: ["research", "nonexistent"],
      }),
    });

    await waitForProcessing([event1, event2], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      workspaceId: "proj1",
      taskId: "parent1",
    });

    // Only the first subtask should be created; the second is rejected
    const children = taskStore.getChildren("parent1");
    expect(children).toHaveLength(1);
    expect(children[0].title).toBe("Research");
  });

  it("continues processing events after a subtask is rejected for unresolvable depends_on", async () => {
    taskStore.createTask("parent1", "proj1", "Parent Task", "desc", [], "test-workspace", "", true);
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const badEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "subtask_create",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        title: "Bad Subtask",
        description: "Has unresolvable dep",
        local_id: "bad",
        depends_on: ["nonexistent"],
      }),
    });

    const goodEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "subtask_create",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        title: "Good Subtask",
        description: "No deps",
        local_id: "good",
        depends_on: [],
      }),
    });

    await waitForProcessing([badEvent, goodEvent], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      workspaceId: "proj1",
      taskId: "parent1",
    });

    // Only the good subtask should be created
    const children = taskStore.getChildren("parent1");
    expect(children).toHaveLength(1);
    expect(children[0].title).toBe("Good Subtask");
  });

  it("does not register local_id for a rejected subtask, causing dependents to also fail", async () => {
    taskStore.createTask("parent1", "proj1", "Parent Task", "desc", [], "test-workspace", "", true);
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    // First subtask has unresolvable dep — rejected, its local_id "a" is never registered
    const event1 = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "subtask_create",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        title: "First",
        description: "Depends on ghost",
        local_id: "a",
        depends_on: ["ghost"],
      }),
    });

    // Second subtask depends on "a" which was never registered — also rejected
    const event2 = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "subtask_create",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        title: "Second",
        description: "Depends on first",
        local_id: "b",
        depends_on: ["a"],
      }),
    });

    await waitForProcessing([event1, event2], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      workspaceId: "proj1",
      taskId: "parent1",
    });

    // Neither subtask should be created
    const children = taskStore.getChildren("parent1");
    expect(children).toHaveLength(0);
  });

  it("rejects subtask with empty title or description", async () => {
    taskStore.createTask("parent1", "proj1", "Parent Task", "desc", [], "test-workspace", "", true);
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
      workspaceId: "proj1",
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
    taskStore.createTask("parent1", "proj1", "Parent Task", "desc", [], "test-workspace", "", true);
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
      workspaceId: "proj1",
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
    taskStore.createTask("parent1", "proj1", "Parent Task", "desc", [], "test-workspace", "", true);
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
      workspaceId: "proj1",
      taskId: "parent1",
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "parent1" }),
      "Failed to create subtask",
    );

    // Session should still complete normally (mapped to stopped + completed end reason)
    const session = sessionStore.getSession("sess1");
    expect(session?.status).toBe("stopped");
  });
});

describe("stream error handling", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    vi.clearAllMocks();

    workspaceStore.createWorkspace("proj1", "Test Project", "desc", "", "env1");
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

    await new Promise<void>((resolve) => {
      processEventStream(
        throwingStream([waitingEvent], new Error("transport closed")),
        { sessionId: "sess1", logPath: "/tmp/log" },
      );
      const interval = setInterval(() => {
        const s = sessionStore.getSession("sess1");
        if (s && ["stopped", "suspended"].includes(s.status)) {
          clearInterval(interval);
          setTimeout(resolve, 50);
        }
      }, 20);
    });

    const session = sessionStore.getSession("sess1");
    expect(session?.status).toBe("suspended");
    expect(session?.suspendedAt).toBeTruthy();
    expect(session?.endedAt).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess1" }),
      "Stream lost — suspending session for recovery",
    );
  });

  it("marks session suspended when stream errors during running", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const textEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "text",
      timestamp: new Date().toISOString(),
      content: "some output",
    });

    await new Promise<void>((resolve) => {
      processEventStream(
        throwingStream([textEvent], new Error("connection reset")),
        { sessionId: "sess1", logPath: "/tmp/log" },
      );
      const interval = setInterval(() => {
        const s = sessionStore.getSession("sess1");
        if (s && ["stopped", "suspended"].includes(s.status)) {
          clearInterval(interval);
          setTimeout(resolve, 50);
        }
      }, 20);
    });

    const session = sessionStore.getSession("sess1");
    expect(session?.status).toBe("suspended");
    expect(session?.suspendedAt).toBeTruthy();
    expect(session?.endedAt).toBeNull();
  });

  it("task broadcast fires when session suspends via idle disconnect", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", [], "test-workspace");

    // Simulate task in_progress
    taskStore.updateTaskStatus("task1", "working");

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
          workspaceId: "proj1",
          taskId: "task1",
        },
      );
      // Poll for session to reach terminal status
      const interval = setInterval(() => {
        const s = sessionStore.getSession("sess1");
        if (s && ["stopped", "suspended"].includes(s.status)) {
          clearInterval(interval);
          setTimeout(resolve, 50);
        }
      }, 20);
    });

    const session = sessionStore.getSession("sess1");
    expect(session?.status).toBe("suspended");

    // Verify task.updated was emitted so the frontend can re-fetch computed status
    expect(emit).toHaveBeenCalledWith(
      "task.updated",
      expect.objectContaining({ taskId: "task1", workspaceId: "proj1" }),
    );
  });
});

describe("event-processor runtime_session_id handling", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    vi.clearAllMocks();
  });

  it("persists runtimeSessionId when runtime_session_id event is received", async () => {
    sessionStore.createSession("sess1", "env1", "stub", "hello", "stub-model", "/tmp/log");

    const rtIdEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "runtime_session_id",
      timestamp: new Date().toISOString(),
      content: "stub-abc-123",
    });

    // Need a terminal event to end the stream so waitForProcessing resolves
    const doneEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    });

    await waitForProcessing([rtIdEvent, doneEvent], {
      sessionId: "sess1",
      logPath: "/tmp/log",
    });

    const session = sessionStore.getSession("sess1");
    expect(session?.runtimeSessionId).toBe("stub-abc-123");
  });

  it("does not overwrite runtimeSessionId for unrelated event types", async () => {
    sessionStore.createSession("sess1", "env1", "stub", "hello", "stub-model", "/tmp/log");

    const textEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "text",
      timestamp: new Date().toISOString(),
      content: "some output",
    });

    const doneEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    });

    await waitForProcessing([textEvent, doneEvent], {
      sessionId: "sess1",
      logPath: "/tmp/log",
    });

    // runtimeSessionId should still be null (never set)
    const session = sessionStore.getSession("sess1");
    expect(session?.runtimeSessionId).toBeNull();
  });
});

describe("task status broadcast on terminal events", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    vi.clearAllMocks();

    workspaceStore.createWorkspace("proj1", "Test Project", "desc", "", "env1");
  });

  it("broadcasts task_updated when session completes with a task", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", [], "test-workspace");
    taskStore.updateTaskStatus("task1", "working");

    const completedEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    });

    await waitForProcessing([completedEvent], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      workspaceId: "proj1",
      taskId: "task1",
    });

    // Verify task.updated was emitted on terminal session event
    expect(emit).toHaveBeenCalledWith(
      "task.updated",
      expect.objectContaining({ taskId: "task1", workspaceId: "proj1" }),
    );
  });

  it("broadcasts task_updated for both terminal and non-terminal session events", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", [], "test-workspace");
    taskStore.updateTaskStatus("task1", "working");

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
      workspaceId: "proj1",
      taskId: "task1",
    });

    // All status changes (waiting_input, running, completed) should broadcast
    // so the frontend re-fetches and gets the computed task status
    const taskUpdatedCalls = (emit as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "task.updated");
    expect(taskUpdatedCalls.length).toBe(3);
  });

  it("does not broadcast task_updated when no task is associated", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const completedEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    });

    await waitForProcessing([completedEvent], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      // no taskId
    });

    // No task_updated broadcasts should have been made
    const taskUpdatedCalls = (emit as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === "task.updated");
    expect(taskUpdatedCalls.length).toBe(0);
  });

  it("writes server-enriched workpad on killed session when task has no workpad", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", [], "test-workspace");
    taskStore.updateTaskStatus("task1", "working");

    const killedEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "killed",
    });

    await waitForProcessing([killedEvent], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      workspaceId: "proj1",
      taskId: "task1",
    });

    const task = taskStore.getTask("task1");
    expect(task!.workpad).toBeTruthy();
    const workpad = JSON.parse(task!.workpad);
    expect(workpad.status).toBe("killed");
    expect(workpad.summary).toContain("abnormally");
    expect(workpad.extra.sessionId).toBe("sess1");
  });

  it("does not overwrite existing workpad on abnormal exit", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", [], "test-workspace");
    taskStore.updateTaskStatus("task1", "working");
    taskStore.setWorkpad("task1", JSON.stringify({ status: "in progress", summary: "Already working" }));

    const failedEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "failed",
    });

    await waitForProcessing([failedEvent], {
      sessionId: "sess1",
      logPath: "/tmp/log",
      workspaceId: "proj1",
      taskId: "task1",
    });

    const task = taskStore.getTask("task1");
    const workpad = JSON.parse(task!.workpad);
    expect(workpad.summary).toBe("Already working");
  });
});

describe("late-binding", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    vi.clearAllMocks();

    workspaceStore.createWorkspace("proj1", "Test Project", "desc", "", "env1");
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

  /** Helper to poll until a session reaches a terminal status or processing ends. */
  function waitForSessionTerminal(sessionId: string): Promise<void> {
    const endSessionCallsBefore = vi.mocked(logWriter.endSession).mock.calls.length;
    return new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        const s = sessionStore.getSession(sessionId);
        if (s && ["stopped", "suspended"].includes(s.status)) {
          clearInterval(interval);
          setTimeout(resolve, 50);
          return;
        }
        if (vi.mocked(logWriter.endSession).mock.calls.length > endSessionCallsBefore) {
          clearInterval(interval);
          setTimeout(resolve, 50);
        }
      }, 20);
    });
  }

  it("processes finding events after late-bind", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", [], "test-workspace");

    const { stream, push, end } = controllableStream();
    processEventStream(stream, {
      sessionId: "sess1",
      logPath: "/tmp/log",
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

    await waitForSessionTerminal("sess1");

    // Verify finding was stored
    const findings = findingStore.queryFindings("proj1");
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe("Test Finding");
    expect(findings[0].workspaceId).toBe("proj1");
  });

  it("processes subtask events after late-bind", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Parent Task", "desc", [], "test-workspace", "", true);

    const { stream, push, end } = controllableStream();
    processEventStream(stream, {
      sessionId: "sess1",
      logPath: "/tmp/log",
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

    await waitForSessionTerminal("sess1");

    const children = taskStore.getChildren("task1");
    expect(children).toHaveLength(1);
    expect(children[0].title).toBe("Sub Task");
  });

  it("broadcasts task_updated after late-bind on terminal events", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", [], "test-workspace");
    taskStore.updateTaskStatus("task1", "working");

    const { stream, push, end } = controllableStream();
    processEventStream(stream, {
      sessionId: "sess1",
      logPath: "/tmp/log",
    });

    await new Promise((r) => setTimeout(r, 50));

    // Late-bind
    processorRegistry.lateBind("sess1", "task1", "proj1");

    // Emit completed — should trigger task_updated broadcast
    push(create(powerline.AgentEventSchema, {
      sessionId: "sess1",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    }));
    end();

    await waitForSessionTerminal("sess1");

    expect(emit).toHaveBeenCalledWith(
      "task.updated",
      expect.objectContaining({ taskId: "task1", workspaceId: "proj1" }),
    );
  });

  it("replays pre-association finding events from log on late-bind", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", [], "test-workspace");

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
    processEventStream(stream, {
      sessionId: "sess1",
      logPath: "/tmp/log",
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

    await waitForSessionTerminal("sess1");
  });

  it("replay does not re-publish events to streamHub", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task1", "proj1", "Test Task", "desc", [], "test-workspace");

    vi.mocked(logWriter.readLog).mockReturnValue([
      {
        session_id: "sess1",
        type: "finding",
        timestamp: new Date().toISOString(),
        content: JSON.stringify({ title: "Replay Finding", content: "test", category: "info" }),
      },
    ]);

    const { stream, push, end } = controllableStream();
    processEventStream(stream, {
      sessionId: "sess1",
      logPath: "/tmp/log",
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

    await waitForSessionTerminal("sess1");
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

describe("event-processor usage event handling", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    vi.clearAllMocks();
  });

  it("accumulates token usage from a usage event", async () => {
    sessionStore.createSession("sess-usage", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const usageEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-usage",
      type: "usage",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({ input_tokens: 1000, output_tokens: 50, cost_usd: 0.005 }),
    });

    const statusEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-usage",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    });

    await waitForProcessing([usageEvent, statusEvent], {
      sessionId: "sess-usage",
      logPath: "/tmp/log",
    });

    const session = sessionStore.getSession("sess-usage");
    expect(session?.inputTokens).toBe(1000);
    expect(session?.outputTokens).toBe(50);
    expect(session?.costUsd).toBeCloseTo(0.005);
  });

  it("accumulates multiple usage events", async () => {
    sessionStore.createSession("sess-multi", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const usage1 = create(powerline.AgentEventSchema, {
      sessionId: "sess-multi",
      type: "usage",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({ input_tokens: 500, output_tokens: 25, cost_usd: 0.003 }),
    });

    const usage2 = create(powerline.AgentEventSchema, {
      sessionId: "sess-multi",
      type: "usage",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({ input_tokens: 300, output_tokens: 75, cost_usd: 0.007 }),
    });

    const statusEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-multi",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    });

    await waitForProcessing([usage1, usage2, statusEvent], {
      sessionId: "sess-multi",
      logPath: "/tmp/log",
    });

    const session = sessionStore.getSession("sess-multi");
    expect(session?.inputTokens).toBe(800);
    expect(session?.outputTokens).toBe(100);
    expect(session?.costUsd).toBeCloseTo(0.010);
  });

  it("handles malformed usage event content gracefully", async () => {
    sessionStore.createSession("sess-bad", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const badEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-bad",
      type: "usage",
      timestamp: new Date().toISOString(),
      content: "not valid json",
    });

    const statusEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-bad",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    });

    // Should not throw — malformed content is logged and skipped
    await waitForProcessing([badEvent, statusEvent], {
      sessionId: "sess-bad",
      logPath: "/tmp/log",
    });

    const session = sessionStore.getSession("sess-bad");
    expect(session?.inputTokens).toBe(0);
    expect(session?.outputTokens).toBe(0);
    expect(session?.costUsd).toBe(0);
  });
});
