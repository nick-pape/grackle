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

    CREATE TABLE IF NOT EXISTS session_actions (
      seq           TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL,
      type          TEXT NOT NULL,
      content       TEXT NOT NULL,
      raw           TEXT NOT NULL DEFAULT '',
      timestamp     TEXT NOT NULL,
      tool_call_id  TEXT NOT NULL DEFAULT '',
      turn_id       TEXT NOT NULL DEFAULT '',
      diagnostic    INTEGER NOT NULL DEFAULT 0
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

describe("subagent child sessions (#1075)", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    vi.clearAllMocks();
    workspaceStore.createWorkspace("proj1", "Test Project", "desc", "", "env1");
  });

  /** Build a tool_use AgentEvent carrying `{tool, args}` JSON content. */
  function toolUse(
    sessionId: string,
    tool: string,
    args: unknown,
    toolCallId: string,
  ): powerline.AgentEvent {
    return create(powerline.AgentEventSchema, {
      sessionId,
      type: "tool_use",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({ tool, args }),
      toolCallId,
    });
  }

  /** Build a tool_result AgentEvent. */
  function toolResult(
    sessionId: string,
    content: string,
    toolCallId: string,
    toolError = false,
  ): powerline.AgentEvent {
    return create(powerline.AgentEventSchema, {
      sessionId,
      type: "tool_result",
      timestamp: new Date().toISOString(),
      content,
      toolCallId,
      toolError,
    });
  }

  /** Build a terminal status event so waitForProcessing resolves. */
  function statusCompleted(sessionId: string): powerline.AgentEvent {
    return create(powerline.AgentEventSchema, {
      sessionId,
      type: "status",
      timestamp: new Date().toISOString(),
      content: "completed",
    });
  }

  it("materializes a linked child session for a Claude Agent delegation", async () => {
    sessionStore.createSession("p1", "env1", "claude-code", "test", "sonnet", "/tmp/p1", "task1");
    const childId = "sub_p1_tc1";

    await waitForProcessing(
      [
        toolUse("p1", "Agent", { subagent_type: "Explore", prompt: "find the bug" }, "tc1"),
        toolResult("p1", "I found it in foo.ts", "tc1"),
        statusCompleted("p1"),
      ],
      { sessionId: "p1", logPath: "/tmp/p1", taskId: "task1" },
    );

    const child = sessionStore.getSession(childId);
    expect(child).toBeDefined();
    expect(child?.parentSessionId).toBe("p1");
    // Attached to the parent SESSION, not the task (avoids polluting task-scoped
    // queries used for status/signal routing).
    expect(child?.taskId).toBe("");
    // Inherits the parent's env to satisfy the sessions.env_id FK (the subagent
    // ran in the parent's environment); the `subagent` runtime keeps it out of
    // env/lifecycle queries. NOTE: this in-memory test schema does not enforce
    // FKs — the live/integration run is the real FK guard.
    expect(child?.environmentId).toBe("env1");
    expect(child?.runtime).toBe("subagent");
    expect(child?.status).toBe("stopped");
    expect(child?.endReason).toBe("completed");

    const actions = querySessionActions({ sessionId: childId });
    const contents = actions.map((a) => a.content);
    expect(contents).toContain("find the bug");
    expect(contents).toContain("I found it in foo.ts");
  });

  it("marks the child errored when the delegation result is an error", async () => {
    sessionStore.createSession("p2", "env1", "claude-code", "test", "sonnet", "/tmp/p2", "task1");

    await waitForProcessing(
      [
        toolUse("p2", "Agent", { subagent_type: "Plan", prompt: "plan it" }, "tcE"),
        toolResult("p2", "subagent crashed", "tcE", true),
        statusCompleted("p2"),
      ],
      { sessionId: "p2", logPath: "/tmp/p2", taskId: "task1" },
    );

    const child = sessionStore.getSession("sub_p2_tcE");
    expect(child?.status).toBe("stopped");
    expect(child?.endReason).toBe("interrupted");
  });

  it("does not create a child for an ordinary tool with a prompt but no delegation id", async () => {
    sessionStore.createSession("p3", "env1", "claude-code", "test", "sonnet", "/tmp/p3", "task1");

    await waitForProcessing(
      [
        toolUse("p3", "search", { prompt: "a query" }, "tcS"),
        toolResult("p3", "results", "tcS"),
        statusCompleted("p3"),
      ],
      { sessionId: "p3", logPath: "/tmp/p3", taskId: "task1" },
    );

    expect(sessionStore.getSession("sub_p3_tcS")).toBeUndefined();
  });

  it("dedupes a re-emitted delegation tool_use onto one child (idempotent floor)", async () => {
    sessionStore.createSession("p4", "env1", "claude-code", "test", "sonnet", "/tmp/p4", "task1");

    await waitForProcessing(
      [
        toolUse("p4", "Agent", { subagent_type: "Explore", prompt: "look" }, "tcD"),
        toolUse("p4", "Agent", { subagent_type: "Explore", prompt: "look" }, "tcD"),
        statusCompleted("p4"),
      ],
      { sessionId: "p4", logPath: "/tmp/p4", taskId: "task1" },
    );

    const childId = "sub_p4_tcD";
    expect(sessionStore.getSession(childId)).toBeDefined();
    const prompts = querySessionActions({ sessionId: childId }).filter((a) => a.content === "look");
    expect(prompts).toHaveLength(1);
  });

  it("dedupes Copilot read_agent polls onto one child by agent_id and appends activity", async () => {
    sessionStore.createSession("p5", "env1", "copilot", "test", "sonnet", "/tmp/p5", "task1");

    await waitForProcessing(
      [
        toolUse("p5", "read_agent", { agent_id: "ag-7" }, "poll1"),
        toolResult("p5", "Agent running. agent_id: ag-7\n\nworking...", "poll1"),
        toolUse("p5", "read_agent", { agent_id: "ag-7" }, "poll2"),
        toolResult("p5", "Agent completed. agent_id: ag-7\n\nall done", "poll2"),
        statusCompleted("p5"),
      ],
      { sessionId: "p5", logPath: "/tmp/p5", taskId: "task1" },
    );

    const childId = "sub_p5_ag-7";
    const child = sessionStore.getSession(childId);
    expect(child).toBeDefined();
    expect(child?.status).toBe("stopped");
    expect(child?.endReason).toBe("completed");
    // Two distinct child records must NOT exist — both polls share agent_id ag-7.
    const allSubs = sessionStore.listSessionsByParent("p5");
    expect(allSubs).toHaveLength(1);
    // The terminal poll result is recorded exactly once (closeChildSession records
    // it; the append path is skipped for terminal polls — no duplication).
    const completedEntries = querySessionActions({ sessionId: childId }).filter((a) =>
      a.content.includes("all done"),
    );
    expect(completedEntries).toHaveLength(1);
  });

  it("keeps the child out of task-scoped queries (status/signal routing unaffected)", async () => {
    sessionStore.createSession("p6", "env1", "claude-code", "test", "sonnet", "/tmp/p6", "task1");

    await waitForProcessing(
      [
        toolUse("p6", "Agent", { subagent_type: "Explore", prompt: "look" }, "tc6"),
        toolResult("p6", "found it", "tc6"),
        statusCompleted("p6"),
      ],
      { sessionId: "p6", logPath: "/tmp/p6", taskId: "task1" },
    );

    const childId = "sub_p6_tc6";
    expect(sessionStore.getSession(childId)).toBeDefined();
    // The virtual child must NOT appear in any task-scoped query: the "latest
    // session" pointer (UI + signal routing) and the task session list must
    // resolve to the real parent, never the env-less child.
    expect(sessionStore.getLatestSessionForTask("task1")?.id).toBe("p6");
    const taskSessions = sessionStore.listSessionsForTask("task1");
    expect(taskSessions.map((s) => s.id)).toEqual(["p6"]);
    expect(sessionStore.getActiveSessionsForTask("task1").map((s) => s.id)).not.toContain(childId);
    // The child inherits the parent's env but must NOT be picked by env-scoped
    // lifecycle queries (reanimate/recovery) — it's a virtual subagent runtime.
    expect(sessionStore.getActiveForEnv("env1")?.id).not.toBe(childId);
    expect(sessionStore.listByEnv("env1").map((s) => s.id)).not.toContain(childId);
    // But it remains reachable via its parent session (navigation edge).
    expect(sessionStore.listSessionsByParent("p6").map((s) => s.id)).toEqual([childId]);
  });

  it("does not count subagent children toward environment concurrency", () => {
    // A real running session + a running subagent child in the same env.
    sessionStore.createSession("real1", "env1", "claude-code", "p", "sonnet", "/tmp/r1", "task1");
    sessionStore.updateSessionStatus("real1", "running");
    sessionStore.createSession(
      "sub_real1_x",
      "env1", // inherits parent's env
      "subagent",
      "p",
      "stub",
      "",
      "",
      "",
      "real1",
      "",
    );
    sessionStore.updateSessionStatus("sub_real1_x", "running");

    // Only the real session consumes a dispatch slot.
    expect(sessionStore.countActiveForEnvironment("env1")).toBe(1);
    expect(sessionStore.countActiveGlobal()).toBe(1);
  });

  it("interrupts an open child when the parent stream ends without a tool_result", async () => {
    sessionStore.createSession("p7", "env1", "claude-code", "test", "sonnet", "/tmp/p7", "task1");

    // Delegation tool_use with NO paired tool_result, then the stream ends.
    await waitForProcessing(
      [toolUse("p7", "Agent", { subagent_type: "Explore", prompt: "go" }, "tc7")],
      { sessionId: "p7", logPath: "/tmp/p7", taskId: "task1" },
    );

    const child = sessionStore.getSession("sub_p7_tc7");
    expect(child).toBeDefined();
    expect(child?.status).toBe("stopped");
    expect(child?.endReason).toBe("interrupted");
  });

  it("detects delegation from the real AHP-mapped tool_use content shape", async () => {
    // Captured verbatim from a live run: after the AHP round-trip the tool_use
    // content carries tool_name/display_name/invocation_message alongside the
    // original {tool, args}. This locks the content-shape contract the parser
    // reads (parsed.tool / parsed.args).
    sessionStore.createSession("p9", "env1", "stub", "test", "stub", "/tmp/p9", "task1");
    const realContent =
      '{"tool":"Agent","tool_name":"Agent","display_name":"Agent","invocation_message":"Running Agent","args":{"subagent_type":"Explore","description":"find the failing test root cause","prompt":"Search for why the auth test fails and report the root cause."}}';
    const evt = create(powerline.AgentEventSchema, {
      sessionId: "p9",
      type: "tool_use",
      timestamp: new Date().toISOString(),
      content: realContent,
      toolCallId: "toolu_scenario_1",
    });

    await waitForProcessing(
      [
        evt,
        toolResult("p9", '{"is_ok":true,"content":"done"}', "toolu_scenario_1"),
        statusCompleted("p9"),
      ],
      { sessionId: "p9", logPath: "/tmp/p9", taskId: "task1" },
    );

    const child = sessionStore.getSession("sub_p9_toolu_scenario_1");
    expect(child).toBeDefined();
    expect(child?.endReason).toBe("completed");
    const contents = querySessionActions({ sessionId: "sub_p9_toolu_scenario_1" }).map(
      (a) => a.content,
    );
    expect(contents).toContain("Search for why the auth test fails and report the root cause.");
    expect(contents).toContain("done");
  });

  it("detects a Copilot delegation from the real AHP-mapped task content shape", async () => {
    // Captured verbatim from a live Copilot-shaped run through the real pipeline:
    // the `task` args (agent_type/name/agent_id/mode/prompt) survive the AHP
    // round-trip under `args`, alongside tool_name/display_name/invocation_message.
    sessionStore.createSession("pcp", "env1", "copilot", "test", "gpt-4o", "/tmp/pcp", "task1");
    const realContent =
      '{"tool":"task","tool_name":"task","display_name":"task","invocation_message":"Running task","args":{"agent_type":"explore","name":"find-tests","agent_id":"ag-cp1","mode":"background","prompt":"Find all test files."}}';
    const spawn = create(powerline.AgentEventSchema, {
      sessionId: "pcp",
      type: "tool_use",
      timestamp: new Date().toISOString(),
      content: realContent,
      toolCallId: "tc-spawn",
    });

    await waitForProcessing(
      [
        spawn,
        toolResult("pcp", "Agent started in background with agent_id: ag-cp1", "tc-spawn"),
        toolUse("pcp", "read_agent", { agent_id: "ag-cp1" }, "tc-poll"),
        toolResult("pcp", "Agent completed. agent_id: ag-cp1\n\nFound 42 test files.", "tc-poll"),
        statusCompleted("pcp"),
      ],
      { sessionId: "pcp", logPath: "/tmp/pcp", taskId: "task1" },
    );

    // Identity = agent_id, so spawn + poll converge on ONE child.
    const children = sessionStore.listSessionsByParent("pcp");
    expect(children.map((s) => s.id)).toEqual(["sub_pcp_ag-cp1"]);
    expect(children[0]?.endReason).toBe("completed");
    const contents = querySessionActions({ sessionId: "sub_pcp_ag-cp1" }).map((a) => a.content);
    expect(contents).toContain("Find all test files.");
    expect(contents.some((c) => c.includes("Found 42 test files."))).toBe(true);
  });

  it("does not materialize a child for Codex-style tools (no native subagent tool)", async () => {
    // Codex delegates via Grackle MCP tools, not a native subagent tool, so its
    // tool calls must never be mistaken for delegations.
    sessionStore.createSession("pcx", "env1", "codex", "test", "gpt-5.5", "/tmp/pcx", "task1");

    await waitForProcessing(
      [
        toolUse("pcx", "shell", { command: "ls -la" }, "tc-sh"),
        toolResult("pcx", "file listing", "tc-sh"),
        statusCompleted("pcx"),
      ],
      { sessionId: "pcx", logPath: "/tmp/pcx", taskId: "task1" },
    );

    expect(sessionStore.listSessionsByParent("pcx")).toHaveLength(0);
  });

  it("unwraps JSON-wrapped tool results into clean floor text", async () => {
    sessionStore.createSession("p8", "env1", "claude-code", "test", "sonnet", "/tmp/p8", "task1");

    await waitForProcessing(
      [
        toolUse("p8", "Agent", { subagent_type: "Explore", prompt: "look" }, "tc8"),
        toolResult("p8", '{"is_ok":true,"content":"clean summary text"}', "tc8"),
        statusCompleted("p8"),
      ],
      { sessionId: "p8", logPath: "/tmp/p8", taskId: "task1" },
    );

    const contents = querySessionActions({ sessionId: "sub_p8_tc8" }).map((a) => a.content);
    expect(contents).toContain("clean summary text");
    expect(contents.some((c) => c.includes("is_ok"))).toBe(false);
  });

  it("is idempotent across a parent stream restart (reanimate) — no duplicate child", async () => {
    sessionStore.createSession("p10", "env1", "claude-code", "test", "sonnet", "/tmp/p10", "task1");
    const childId = "sub_p10_tcR";
    const delegation = [
      toolUse("p10", "Agent", { subagent_type: "Explore", prompt: "investigate" }, "tcR"),
      toolResult("p10", "first result", "tcR"),
      statusCompleted("p10"),
    ];

    // First stream run materializes + closes the child.
    await waitForProcessing(delegation, { sessionId: "p10", logPath: "/tmp/p10", taskId: "task1" });
    // Stream restarts (e.g. reanimate): the same events replay through a fresh
    // delegationByToolCall map. ensureChildSession must dedupe on the existing child.
    await waitForProcessing(delegation, { sessionId: "p10", logPath: "/tmp/p10", taskId: "task1" });

    expect(sessionStore.listSessionsByParent("p10").map((s) => s.id)).toEqual([childId]);
    const actions = querySessionActions({ sessionId: childId });
    // Neither the prompt floor nor the result floor may be duplicated by the
    // replayed tool_use / tool_result (closeChildSession is a no-op once terminal).
    expect(actions.filter((a) => a.content === "investigate")).toHaveLength(1);
    expect(actions.filter((a) => a.content === "first result")).toHaveLength(1);
  });

  it("does NOT interrupt a background spawn child when the parent stream ends", async () => {
    sessionStore.createSession("pb1", "env1", "copilot", "test", "gpt-4o", "/tmp/pb1", "task1");

    // Background spawn: the tool_result is just a handle. No terminal poll, then
    // the stream ends. The subagent runs independently, so it must stay running.
    await waitForProcessing(
      [
        toolUse(
          "pb1",
          "task",
          { agent_type: "worker", name: "bg", agent_id: "bg-1", mode: "background", prompt: "go" },
          "spawnB",
        ),
        toolResult("pb1", "Agent started in background with agent_id: bg-1", "spawnB"),
        statusCompleted("pb1"),
      ],
      { sessionId: "pb1", logPath: "/tmp/pb1", taskId: "task1" },
    );

    const child = sessionStore.getSession("sub_pb1_bg-1");
    expect(child).toBeDefined();
    expect(child?.status).toBe("running");
    expect(child?.endReason).toBeNull();
  });

  it("does NOT interrupt a child after a non-terminal poll when the parent stream ends", async () => {
    sessionStore.createSession("pb2", "env1", "copilot", "test", "gpt-4o", "/tmp/pb2", "task1");

    // A read_agent poll reports "running" (non-terminal), then the parent stream
    // ends. The poll already paired, so the child must not be interrupted.
    await waitForProcessing(
      [
        toolUse("pb2", "read_agent", { agent_id: "p-2" }, "pollB"),
        toolResult("pb2", "Agent running. agent_id: p-2\n\nworking", "pollB"),
        statusCompleted("pb2"),
      ],
      { sessionId: "pb2", logPath: "/tmp/pb2", taskId: "task1" },
    );

    const child = sessionStore.getSession("sub_pb2_p-2");
    expect(child).toBeDefined();
    expect(child?.status).toBe("running");
  });

  it("DOES interrupt a synchronous spawn child whose result never arrives", async () => {
    sessionStore.createSession("pb3", "env1", "claude-code", "test", "sonnet", "/tmp/pb3", "task1");

    // Synchronous Claude Agent: no tool_result, stream ends → child interrupted
    // (the subagent died with the parent; this is the genuinely-unpaired case).
    await waitForProcessing(
      [toolUse("pb3", "Agent", { subagent_type: "Explore", prompt: "go" }, "syncB")],
      { sessionId: "pb3", logPath: "/tmp/pb3", taskId: "task1" },
    );

    const child = sessionStore.getSession("sub_pb3_syncB");
    expect(child?.status).toBe("stopped");
    expect(child?.endReason).toBe("interrupted");
  });

  it("converges a Copilot task spawn and its read_agent polls onto one child via agent_id", async () => {
    sessionStore.createSession("p11", "env1", "copilot", "test", "gpt-4o", "/tmp/p11", "task1");

    await waitForProcessing(
      [
        // Spawn carries agent_id; identity = agent_id.
        toolUse(
          "p11",
          "task",
          { agent_type: "worker", name: "reviewer", agent_id: "ag-99", prompt: "review the diff" },
          "spawn1",
        ),
        toolResult("p11", "Agent started in background with agent_id: ag-99", "spawn1"),
        // Poll references the same agent_id → same child id.
        toolUse("p11", "read_agent", { agent_id: "ag-99" }, "poll1"),
        toolResult("p11", "Agent completed. agent_id: ag-99\n\nLGTM", "poll1"),
        statusCompleted("p11"),
      ],
      { sessionId: "p11", logPath: "/tmp/p11", taskId: "task1" },
    );

    // Both spawn and poll resolve to one child keyed on agent_id.
    const children = sessionStore.listSessionsByParent("p11");
    expect(children.map((s) => s.id)).toEqual(["sub_p11_ag-99"]);
    expect(children[0]?.status).toBe("stopped");
    expect(children[0]?.endReason).toBe("completed");
  });
});
