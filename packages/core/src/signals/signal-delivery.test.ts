import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { setupTestDatabase } from "@grackle-ai/test-utils";

// ── Mock dependencies ────────────────────────────────────────

// NOTE: @grackle-ai/database is NOT mocked — real stores run against
// an in-memory SQLite database initialized by setupTestDatabase().

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../log-writer.js", () => ({
  initLog: vi.fn(),
  ensureLogInitialized: vi.fn(),
  writeEvent: vi.fn(),
  endSession: vi.fn(),
  readLog: vi.fn(() => []),
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

vi.mock("../reanimate-agent.js", () => ({
  reanimateAgent: vi.fn(),
}));

import {
  sessionStore,
  querySessionActions,
  envRegistry,
  workspaceStore,
  taskStore,
} from "@grackle-ai/database";
import * as adapterManager from "../adapter-manager.js";
import * as streamHub from "../stream-hub.js";
import { reanimateAgent } from "../reanimate-agent.js";
import { logger } from "../logger.js";
import { grackle } from "@grackle-ai/common";
import { deliverSignalToTask, sendInputToSession } from "./signal-delivery.js";

// ── Test DB ───────────────────────────────────────────────────

const testDb = setupTestDatabase();
afterAll(() => testDb.cleanup());

// ── Helpers ──────────────────────────────────────────────────

function insertBaseEntities(): void {
  envRegistry.addEnvironment("env-1", "Test Env", "local", "{}");
  workspaceStore.createWorkspace("ws-1", "Test Workspace", "", "");
}

function insertTask(id: string): void {
  taskStore.createTask(id, "ws-1", "Test Task", "", [], "ws-1");
}

function insertSession(
  id: string,
  taskId: string,
  status: string,
  opts?: { endReason?: string; runtimeSessionId?: string },
): void {
  sessionStore.createSession(id, "env-1", "stub", "", "claude", "/tmp/log", taskId);
  if (status !== "pending") {
    sessionStore.updateSession(
      id,
      status as never,
      opts?.runtimeSessionId,
      undefined,
      opts?.endReason as never,
    );
  }
}

function makeMockConnection(dispatchInputMock = vi.fn().mockResolvedValue(undefined)) {
  return {
    client: {},
    environmentId: "env-1",
    port: 7433,
    transport: { dispatchInput: dispatchInputMock },
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("deliverSignalToTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testDb.truncateAll();
    insertBaseEntities();
  });

  it("delivers to IDLE session via sendInput (bypassing IDLE guard)", async () => {
    insertTask("task-child");
    insertSession("sess-1", "task-child", "idle");

    const mockConn = makeMockConnection();
    vi.spyOn(adapterManager, "getConnection").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockConn as any,
    );

    const result = await deliverSignalToTask("task-child", "sigchld", "[SIGCHLD] test");

    expect(result).toBe(true);
    expect(mockConn.transport.dispatchInput).toHaveBeenCalledOnce();
    expect(adapterManager.getConnection).toHaveBeenCalledWith("env-1");

    // Verify the event published to streamHub uses EVENT_TYPE_SIGNAL, not USER_INPUT
    expect(streamHub.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: grackle.EventType.SIGNAL,
        content: "[SIGCHLD] test",
      }),
    );
  });

  it("delivers to RUNNING session via sendInput (bypassing IDLE guard)", async () => {
    insertTask("task-parent");
    insertSession("sess-2", "task-parent", "running");

    const mockConn = makeMockConnection();
    vi.spyOn(adapterManager, "getConnection").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockConn as any,
    );

    const result = await deliverSignalToTask("task-parent", "sigchld", "[SIGCHLD] test");

    expect(result).toBe(true);
    expect(mockConn.transport.dispatchInput).toHaveBeenCalledOnce();
  });

  it("reanimates dead session, waits for IDLE, then delivers", async () => {
    insertTask("task-parent");
    // Session must have runtimeSessionId set and endReason != "completed"/"terminated"
    // for the reanimate path to be triggered
    insertSession("sess-dead", "task-parent", "stopped", {
      runtimeSessionId: "rt-dead",
      endReason: "killed",
    });

    // After reanimate, getSession returns IDLE — use spy to simulate status change
    // since reanimateAgent is mocked and doesn't actually update the DB
    vi.spyOn(sessionStore, "getSession").mockReturnValue({
      id: "sess-dead",
      environmentId: "env-1",
      status: "idle",
      runtime: "stub",
      runtimeSessionId: null,
      prompt: "",
      model: "claude",
      logPath: "/tmp/log",
      turns: 3,
      startedAt: new Date().toISOString(),
      suspendedAt: null,
      endedAt: null,
      error: null,
      taskId: "task-parent",
      personaId: "",
      endReason: null,
      parentSessionId: "",
      pipeMode: "",
      inputTokens: 0,
      outputTokens: 0,
      costMillicents: 0,
      sigtermSentAt: null,
    } as never);

    const mockConn = makeMockConnection();
    vi.spyOn(adapterManager, "getConnection").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockConn as any,
    );

    const result = await deliverSignalToTask("task-parent", "sigchld", "[SIGCHLD] test");

    expect(reanimateAgent).toHaveBeenCalledWith("sess-dead");
    expect(result).toBe(true);
    expect(mockConn.transport.dispatchInput).toHaveBeenCalledOnce();
  });

  it("returns false when no sessions exist (logs warning)", async () => {
    insertTask("task-orphan");

    const result = await deliverSignalToTask("task-orphan", "sigchld", "[SIGCHLD] test");

    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-orphan", signalType: "sigchld" }),
      expect.stringContaining("No session exists"),
    );
  });

  it("returns false when reanimate fails (logs error)", async () => {
    insertTask("task-parent");
    insertSession("sess-fail", "task-parent", "stopped", {
      runtimeSessionId: "rt-fail",
      endReason: "killed",
    });

    vi.mocked(reanimateAgent).mockImplementation(() => {
      throw new Error("Environment not connected");
    });

    const result = await deliverSignalToTask("task-parent", "sigchld", "[SIGCHLD] test");

    expect(result).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ signalType: "sigchld" }),
      expect.stringContaining("Failed to reanimate"),
    );
  });
});

describe("sendInputToSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testDb.truncateAll();
    insertBaseEntities();
  });

  it("delivers signal to session via adapter connection", async () => {
    insertSession("sess-1", "", "idle");

    const mockConn = makeMockConnection();
    vi.spyOn(adapterManager, "getConnection").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockConn as any,
    );

    const result = await sendInputToSession("sess-1", "env-1", "[SIGTERM] stop", "sigterm");

    expect(result).toBe(true);
    expect(mockConn.transport.dispatchInput).toHaveBeenCalledOnce();
    expect(streamHub.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: grackle.EventType.SIGNAL,
        content: "[SIGTERM] stop",
      }),
    );
    // The injected signal is also recorded to the durable session-action log
    const actions = querySessionActions({ sessionId: "sess-1" });
    expect(actions).toContainEqual(
      expect.objectContaining({ sessionId: "sess-1", type: "signal", content: "[SIGTERM] stop" }),
    );
  });

  it("returns false when environment not connected", async () => {
    vi.spyOn(adapterManager, "getConnection").mockReturnValue(undefined);

    const result = await sendInputToSession("sess-1", "env-1", "[SIGTERM] stop", "sigterm");

    expect(result).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess-1", signalType: "sigterm" }),
      expect.stringContaining("not connected"),
    );
  });
});
