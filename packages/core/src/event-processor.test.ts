import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { powerline, grackle } from "@grackle-ai/common";
import type { ServerActionEnvelope } from "@grackle-ai/adapter-sdk";

/** Wrap an AgentEvent as a ServerActionEnvelope with no mapped actions. */
function envelope(event: powerline.AgentEvent): ServerActionEnvelope {
  return { event, actions: [] };
}

// ── Mock all heavy dependencies before importing ──────────────
vi.mock("./trace-context.js", () => ({
  getTraceId: vi.fn(),
  runWithTrace: vi.fn((traceId: string, fn: () => unknown) => fn()),
}));

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./log-writer.js", () => ({
  initLog: vi.fn(),
  ensureLogInitialized: vi.fn(),
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

vi.mock("./telemetry.js", () => ({
  emitDiagnostic: vi.fn(),
}));

// Import AFTER mocks
import {
  openDatabase,
  initDatabase,
  sqlite as _sqlite,
  sessionStore,
  taskStore,
  workspaceStore,
  querySessionActions,
} from "@grackle-ai/database";
openDatabase(":memory:");
initDatabase();
const sqlite = _sqlite!;
import { processEventStream, publishWidgetEvent } from "./event-processor.js";
import * as processorRegistry from "./processor-registry.js";
import { emit } from "./event-bus.js";
import * as logWriter from "./log-writer.js";
import { logger } from "./logger.js";
import { runWithTrace } from "./trace-context.js";
import { emitDiagnostic } from "./telemetry.js";

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
      token_budget  INTEGER NOT NULL DEFAULT 0,
      cost_budget_millicents INTEGER NOT NULL DEFAULT 0,
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
      inject_knowledge INTEGER NOT NULL DEFAULT 1,
      default_persona_id TEXT NOT NULL DEFAULT '',
      workpad   TEXT NOT NULL DEFAULT '',
      schedule_id TEXT NOT NULL DEFAULT '',
      token_budget  INTEGER NOT NULL DEFAULT 0,
      cost_budget_millicents INTEGER NOT NULL DEFAULT 0
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
      cost_millicents   INTEGER NOT NULL DEFAULT 0,
      end_reason        TEXT,
      sigterm_sent_at   TEXT
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

/** Create an async iterable of envelopes from an array of AgentEvent messages. */
async function* eventStream(events: powerline.AgentEvent[]): AsyncIterable<ServerActionEnvelope> {
  for (const event of events) {
    yield envelope(event);
  }
}

/** Helper to wait for processEventStream to complete by polling session status
 *  or detecting the finally block has run (endSession called). */
function waitForProcessing(
  events: powerline.AgentEvent[],
  options: {
    sessionId: string;
    logPath: string;
    workspaceId?: string;
    taskId?: string;
    traceId?: string;
  },
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

  /** Create an async iterable of envelopes that yields events, then throws an error. */
  async function* throwingStream(
    events: powerline.AgentEvent[],
    error: Error,
  ): AsyncIterable<ServerActionEnvelope> {
    for (const event of events) {
      yield envelope(event);
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
      processEventStream(throwingStream([waitingEvent], new Error("transport closed")), {
        sessionId: "sess1",
        logPath: "/tmp/log",
      });
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
      processEventStream(throwingStream([textEvent], new Error("connection reset")), {
        sessionId: "sess1",
        logPath: "/tmp/log",
      });
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
      processEventStream(throwingStream([waitingEvent], new Error("transport closed")), {
        sessionId: "sess1",
        logPath: "/tmp/log",
        workspaceId: "proj1",
        taskId: "task1",
      });
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
    const taskUpdatedCalls = (emit as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === "task.updated",
    );
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
    const taskUpdatedCalls = (emit as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === "task.updated",
    );
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
    taskStore.setWorkpad(
      "task1",
      JSON.stringify({ status: "in progress", summary: "Already working" }),
    );

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
    stream: AsyncIterable<ServerActionEnvelope>;
    push: (event: powerline.AgentEvent) => void;
    end: () => void;
  } {
    const queue: ServerActionEnvelope[] = [];
    let waiting: (() => void) | undefined;
    let done = false;

    const stream: AsyncIterable<ServerActionEnvelope> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<ServerActionEnvelope>> {
            while (queue.length === 0 && !done) {
              await new Promise<void>((resolve) => {
                waiting = resolve;
              });
            }
            if (queue.length > 0) {
              return { value: queue.shift()!, done: false };
            }
            return { value: undefined as unknown as ServerActionEnvelope, done: true };
          },
        };
      },
    };

    return {
      stream,
      push(event: powerline.AgentEvent) {
        queue.push(envelope(event));
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
    push(
      create(powerline.AgentEventSchema, {
        sessionId: "sess1",
        type: "status",
        timestamp: new Date().toISOString(),
        content: "completed",
      }),
    );
    end();

    await waitForSessionTerminal("sess1");

    expect(emit).toHaveBeenCalledWith(
      "task.updated",
      expect.objectContaining({ taskId: "task1", workspaceId: "proj1" }),
    );
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

    push(
      create(powerline.AgentEventSchema, {
        sessionId: "sess1",
        type: "status",
        timestamp: new Date().toISOString(),
        content: "completed",
      }),
    );
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
      content: JSON.stringify({ input_tokens: 1000, output_tokens: 50, cost_millicents: 500 }),
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
    expect(session?.costMillicents).toBe(500);
  });

  it("accumulates multiple usage events", async () => {
    sessionStore.createSession("sess-multi", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const usage1 = create(powerline.AgentEventSchema, {
      sessionId: "sess-multi",
      type: "usage",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({ input_tokens: 500, output_tokens: 25, cost_millicents: 300 }),
    });

    const usage2 = create(powerline.AgentEventSchema, {
      sessionId: "sess-multi",
      type: "usage",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({ input_tokens: 300, output_tokens: 75, cost_millicents: 700 }),
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
    expect(session?.costMillicents).toBe(1000);
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
    expect(session?.costMillicents).toBe(0);
  });
});

describe("budget-exceeded end reason on killed/terminated", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    vi.clearAllMocks();

    workspaceStore.createWorkspace("proj1", "Test Project", "desc", "", "env1");
  });

  /**
   * Create an async iterable that yields events, calling a hook after
   * the first event to mutate processor context before the terminal event.
   */
  async function* eventsWithHook(
    events: powerline.AgentEvent[],
    afterFirst: () => void,
  ): AsyncIterable<ServerActionEnvelope> {
    for (let i = 0; i < events.length; i++) {
      if (i === 1) {
        afterFirst();
      }
      yield envelope(events[i]);
    }
  }

  function waitForProcessingWithHook(
    events: powerline.AgentEvent[],
    options: { sessionId: string; logPath: string; workspaceId?: string; taskId?: string },
    afterFirst: () => void,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const endSessionCallsBefore = vi.mocked(logWriter.endSession).mock.calls.length;
      const interval = setInterval(() => {
        const s = sessionStore.getSession(options.sessionId);
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

      processEventStream(eventsWithHook(events, afterFirst), options);
    });
  }

  it("records BUDGET_EXCEEDED when killed after budget SIGTERM", async () => {
    sessionStore.createSession("sess-bk", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task-bk", "proj1", "Budget Task", "", [], "test-workspace");

    const runningEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-bk",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "running",
    });
    const killedEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-bk",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "killed",
    });

    await waitForProcessingWithHook(
      [runningEvent, killedEvent],
      { sessionId: "sess-bk", logPath: "/tmp/log", workspaceId: "proj1", taskId: "task-bk" },
      () => {
        // Simulate budget SIGTERM having been sent before the kill
        const ctx = processorRegistry.get("sess-bk");
        ctx!.budgetSigtermSent = true;
      },
    );

    const session = sessionStore.getSession("sess-bk");
    expect(session?.status).toBe("stopped");
    expect(session?.endReason).toBe("budget_exceeded");
  });

  it("records BUDGET_EXCEEDED when terminated after budget SIGTERM", async () => {
    sessionStore.createSession("sess-bt", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    taskStore.createTask("task-bt", "proj1", "Budget Task", "", [], "test-workspace");

    const runningEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-bt",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "running",
    });
    const terminatedEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-bt",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "terminated",
    });

    await waitForProcessingWithHook(
      [runningEvent, terminatedEvent],
      { sessionId: "sess-bt", logPath: "/tmp/log", workspaceId: "proj1", taskId: "task-bt" },
      () => {
        const ctx = processorRegistry.get("sess-bt");
        ctx!.budgetSigtermSent = true;
      },
    );

    const session = sessionStore.getSession("sess-bt");
    expect(session?.status).toBe("stopped");
    expect(session?.endReason).toBe("budget_exceeded");
  });

  it("records KILLED (not BUDGET_EXCEEDED) when killed without budget SIGTERM", async () => {
    sessionStore.createSession("sess-nk", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const killedEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-nk",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "killed",
    });

    await waitForProcessing([killedEvent], {
      sessionId: "sess-nk",
      logPath: "/tmp/log",
    });

    const session = sessionStore.getSession("sess-nk");
    expect(session?.status).toBe("stopped");
    expect(session?.endReason).toBe("killed");
  });
});

describe("event-processor traceId propagation", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    vi.clearAllMocks();
  });

  it("calls runWithTrace when traceId is provided in options", async () => {
    sessionStore.createSession("sess-trace", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const statusEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-trace",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    });

    await waitForProcessing([statusEvent], {
      sessionId: "sess-trace",
      logPath: "/tmp/log",
      traceId: "trace-xyz",
    });

    expect(runWithTrace).toHaveBeenCalledWith("trace-xyz", expect.any(Function));
  });

  it("does not call runWithTrace when traceId is omitted", async () => {
    sessionStore.createSession("sess-notrace", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const statusEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-notrace",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    });

    await waitForProcessing([statusEvent], {
      sessionId: "sess-notrace",
      logPath: "/tmp/log",
    });

    expect(runWithTrace).not.toHaveBeenCalled();
  });
});

describe("publishWidgetEvent (MCP Apps widget broker, #1238)", () => {
  const widgetPayload = {
    resourceUri: "ui://grackle/hello-widget",
    toolName: "show_hello_widget",
    html: '<!doctype html><html><body><div class="card">Grackle</div></body></html>',
    csp: { resourceDomains: ["http://127.0.0.1:7435"], connectDomains: ["http://127.0.0.1:7435"] },
    toolInput: { message: "hi" },
    toolResult: { content: [{ type: "text", text: "ok" }] },
  };

  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    vi.clearAllMocks();
    // writeEvent returns a promise (the impl chains .catch on it).
    vi.mocked(logWriter.writeEvent).mockResolvedValue(undefined as never);
  });

  it("builds a WIDGET event, persists it to the session log, and broadcasts it", async () => {
    sessionStore.createSession(
      "sess-w",
      "env1",
      "claude-code",
      "test",
      "sonnet",
      "/tmp/widget-log",
    );
    const { publish } = await import("./stream-hub.js");

    publishWidgetEvent("sess-w", widgetPayload);

    // Persisted to the session's log (so it replays on reload).
    expect(logWriter.ensureLogInitialized).toHaveBeenCalledWith("/tmp/widget-log");
    expect(logWriter.writeEvent).toHaveBeenCalledTimes(1);
    const [logPath, persisted] = vi.mocked(logWriter.writeEvent).mock.calls[0];
    expect(logPath).toBe("/tmp/widget-log");
    expect(persisted.type).toBe(grackle.EventType.WIDGET);

    // Broadcast live with the same event.
    expect(publish).toHaveBeenCalledTimes(1);
    const broadcast = vi.mocked(publish).mock.calls[0][0];
    expect(broadcast.sessionId).toBe("sess-w");
    expect(broadcast.type).toBe(grackle.EventType.WIDGET);

    // content is the payload as JSON, round-trips 1:1 to McpAppWidget props.
    expect(JSON.parse(broadcast.content)).toEqual(widgetPayload);
  });

  it("broadcasts even when the session has no log path (skips persistence)", async () => {
    sessionStore.createSession("sess-nolog", "env1", "claude-code", "test", "sonnet", "");
    const { publish } = await import("./stream-hub.js");

    publishWidgetEvent("sess-nolog", widgetPayload);

    expect(logWriter.writeEvent).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("broadcasts a self-contained event even for an unknown session", async () => {
    const { publish } = await import("./stream-hub.js");

    publishWidgetEvent("does-not-exist", widgetPayload);

    expect(logWriter.writeEvent).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledTimes(1);
  });
});

describe("event-processor session-action log (AHP HR1a)", () => {
  /** Recreate the session_actions table (baseline-equivalent) for this block. */
  function applySessionActionsSchema(): void {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS session_actions (
        seq         TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        type        TEXT NOT NULL,
        content     TEXT NOT NULL,
        raw         TEXT NOT NULL DEFAULT '',
        timestamp   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session_actions_session ON session_actions(session_id, seq);
    `);
  }

  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    applySchema();
    applySessionActionsSchema();
    sqlite.exec("DELETE FROM session_actions");
    vi.clearAllMocks();
  });

  it("persists each event to the durable log with a monotonic, ascending serverSeq (replay order)", async () => {
    sessionStore.createSession("sess-actions", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    const mk = (content: string): powerline.AgentEvent =>
      create(powerline.AgentEventSchema, {
        sessionId: "sess-actions",
        type: "text",
        timestamp: new Date().toISOString(),
        content,
        raw: "",
      });

    await waitForProcessing([mk("a"), mk("b"), mk("c")], {
      sessionId: "sess-actions",
      logPath: "/tmp/log",
    });

    const rows = querySessionActions({ sessionId: "sess-actions" });
    expect(rows.map((r) => r.content)).toEqual(["a", "b", "c"]);
    expect(rows.map((r) => r.type)).toEqual(["text", "text", "text"]);

    const seqs = rows.map((r) => r.seq);
    expect(new Set(seqs).size).toBe(3);
    // ULIDs sort lexicographically; persistence order must be strictly increasing.
    for (let i = 0; i < seqs.length - 1; i++) {
      expect(seqs[i] < seqs[i + 1]).toBe(true);
    }
  });

  it("scopes the log per session", async () => {
    sessionStore.createSession("sess-x", "env1", "claude-code", "test", "sonnet", "/tmp/x");
    sessionStore.createSession("sess-y", "env1", "claude-code", "test", "sonnet", "/tmp/y");
    const mk = (sessionId: string, content: string): powerline.AgentEvent =>
      create(powerline.AgentEventSchema, {
        sessionId,
        type: "text",
        timestamp: new Date().toISOString(),
        content,
        raw: "",
      });

    await waitForProcessing([mk("sess-x", "x1")], { sessionId: "sess-x", logPath: "/tmp/x" });
    await waitForProcessing([mk("sess-y", "y1")], { sessionId: "sess-y", logPath: "/tmp/y" });

    expect(querySessionActions({ sessionId: "sess-x" }).map((r) => r.content)).toEqual(["x1"]);
    expect(querySessionActions({ sessionId: "sess-y" }).map((r) => r.content)).toEqual(["y1"]);
  });

  it("records widget render events (not just PowerLine-stream events)", () => {
    sessionStore.createSession("sess-widget", "env1", "claude-code", "test", "sonnet", "/tmp/wlog");
    publishWidgetEvent("sess-widget", {
      resourceUri: "ui://demo",
      toolName: "render",
      html: "<div/>",
    });
    const rows = querySessionActions({ sessionId: "sess-widget" });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("widget");
  });

  it("does not break event processing or live delivery when persisting an action fails", async () => {
    sessionStore.createSession("sess-fail", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    // Simulate a DB outage for the action log: the INSERT will throw.
    sqlite.exec("DROP TABLE session_actions");

    const completedEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-fail",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
      raw: "",
    });

    await waitForProcessing([completedEvent], { sessionId: "sess-fail", logPath: "/tmp/log" });

    // Processing still reached a terminal state despite the persist failure.
    expect(sessionStore.getSession("sess-fail")!.status).toBe("stopped");
    // Live delivery (log + stream-hub) was unaffected.
    expect(logWriter.writeEvent).toHaveBeenCalled();
    const { publish } = await import("./stream-hub.js");
    expect(publish).toHaveBeenCalled();
    // The failure was logged, not thrown.
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess-fail" }),
      "Failed to persist session action",
    );
  });
});

describe("event-processor tool_call_id (AHP HR3)", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    applySchema();
    vi.clearAllMocks();
  });

  it("threads AgentEvent.toolCallId onto the published SessionEvent", async () => {
    sessionStore.createSession("sess-tc", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    const toolUse = create(powerline.AgentEventSchema, {
      sessionId: "sess-tc",
      type: "tool_use",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({ tool: "Bash", args: {} }),
      raw: JSON.stringify({ id: "toolu_x" }),
      toolCallId: "toolu_x",
    });

    await waitForProcessing([toolUse], { sessionId: "sess-tc", logPath: "/tmp/log" });

    const { publish } = await import("./stream-hub.js");
    const published = vi
      .mocked(publish)
      .mock.calls.map((c) => c[0])
      .find((e) => e.type === grackle.EventType.TOOL_USE);
    expect(published?.toolCallId).toBe("toolu_x");
  });
});

describe("event-processor diagnostic flag + OTLP tee (AHP HR7)", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    applySchema();
    vi.clearAllMocks();
  });

  it("threads AgentEvent.diagnostic onto the published SessionEvent and tees it to OTLP", async () => {
    sessionStore.createSession("sess-diag", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    const diagnosticEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-diag",
      type: "system",
      timestamp: new Date().toISOString(),
      content: "Starting claude-code runtime...",
      diagnostic: true,
    });

    await waitForProcessing([diagnosticEvent], { sessionId: "sess-diag", logPath: "/tmp/log" });

    const { publish } = await import("./stream-hub.js");
    const published = vi
      .mocked(publish)
      .mock.calls.map((c) => c[0])
      .find((e) => e.type === grackle.EventType.SYSTEM);
    expect(published?.diagnostic).toBe(true);

    // The diagnostic is tee'd to the additive OTLP sink with the same event.
    expect(emitDiagnostic).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitDiagnostic).mock.calls[0][0].diagnostic).toBe(true);
    expect(vi.mocked(emitDiagnostic).mock.calls[0][0].content).toBe(
      "Starting claude-code runtime...",
    );
  });

  it("does not tee a non-diagnostic event to OTLP and leaves diagnostic false", async () => {
    sessionStore.createSession("sess-sub", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    const textEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-sub",
      type: "text",
      timestamp: new Date().toISOString(),
      content: "substantive output",
    });

    await waitForProcessing([textEvent], { sessionId: "sess-sub", logPath: "/tmp/log" });

    const { publish } = await import("./stream-hub.js");
    const published = vi
      .mocked(publish)
      .mock.calls.map((c) => c[0])
      .find((e) => e.type === grackle.EventType.TEXT);
    expect(published?.diagnostic).toBe(false);
    expect(emitDiagnostic).not.toHaveBeenCalled();
  });
});

describe("turn_id threading (AHP HR2)", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    vi.clearAllMocks();
  });

  it("threads turn_id from AgentEvent through to the SessionEvent written to the log", async () => {
    sessionStore.createSession(
      "sess-turn",
      "env1",
      "stub",
      "test prompt",
      "stub-model",
      "/tmp/turn-log",
    );

    const turnStartedEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-turn",
      type: "turn_started",
      timestamp: new Date().toISOString(),
      content: "test prompt",
      turnId: "test-turn-id-abc",
    });

    // A liveness status event with no turnId should be written with empty turn_id.
    const doneEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-turn",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "waiting_input",
    });

    await waitForProcessing([turnStartedEvent, doneEvent], {
      sessionId: "sess-turn",
      logPath: "/tmp/turn-log",
    });

    const writeEventCalls = vi.mocked(logWriter.writeEvent).mock.calls;

    const turnStartedSessionEvent = writeEventCalls.find(
      ([, ev]) => ev.type === grackle.EventType.TURN_STARTED,
    )?.[1];
    expect(turnStartedSessionEvent?.turnId).toBe("test-turn-id-abc");

    const statusSessionEvent = writeEventCalls.find(
      ([, ev]) => ev.type === grackle.EventType.STATUS,
    )?.[1];
    expect(statusSessionEvent?.turnId).toBeFalsy();
  });
});

describe("sticky terminal session status (#1356)", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    vi.clearAllMocks();

    workspaceStore.createWorkspace("proj1", "Test Project", "desc", "", "env1");
  });

  /** Resolve once the whole stream has been consumed (endSession fires in the finally). */
  function waitForStreamEnd(events: powerline.AgentEvent[], sessionId: string): Promise<void> {
    const before = vi.mocked(logWriter.endSession).mock.calls.length;
    return new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 2000;
      const interval = setInterval(() => {
        if (vi.mocked(logWriter.endSession).mock.calls.length > before) {
          clearInterval(interval);
          setTimeout(resolve, 20);
        } else if (Date.now() > deadline) {
          clearInterval(interval);
          reject(new Error("stream did not complete in time"));
        }
      }, 20);
      processEventStream(eventStream(events), { sessionId, logPath: "/tmp/log" });
    });
  }

  it("keeps a killed session STOPPED when a trailing waiting_input arrives", async () => {
    sessionStore.createSession("sess-sticky", "env1", "claude-code", "test", "sonnet", "/tmp/log");

    const killedEvent = create(powerline.AgentEventSchema, {
      sessionId: "sess-sticky",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "killed",
    });
    // The runtime's SIGTERM abort can emit a synthetic waiting_input AFTER the
    // kill. Without the sticky-terminal guard this would flip the session back
    // to idle in the UI even though it was killed.
    const trailingWaiting = create(powerline.AgentEventSchema, {
      sessionId: "sess-sticky",
      type: "status",
      timestamp: new Date().toISOString(),
      content: "waiting_input",
    });

    await waitForStreamEnd([killedEvent, trailingWaiting], "sess-sticky");

    const session = sessionStore.getSession("sess-sticky");
    expect(session?.status).toBe("stopped");
    expect(session?.endReason).toBe("killed");
  });
});
