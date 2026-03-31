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

import { sessionStore } from "@grackle-ai/database";
import * as adapterManager from "../adapter-manager.js";
import * as streamHub from "../stream-hub.js";
import { reanimateAgent } from "../reanimate-agent.js";
import { logger } from "../logger.js";
import { grackle } from "@grackle-ai/common";
import { deliverSignalToTask, sendInputToSession } from "./signal-delivery.js";

// ── Helpers ──────────────────────────────────────────────────

function makeMockConnection(sendInputMock = vi.fn().mockResolvedValue({})) {
  return {
    client: { sendInput: sendInputMock },
    environmentId: "env-1",
    port: 7433,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("deliverSignalToTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delivers to IDLE session via sendInput (bypassing IDLE guard)", async () => {
    vi.spyOn(sessionStore, "getActiveSessionsForTask").mockReturnValue([
      {
        id: "sess-1",
        environmentId: "env-1",
        status: "idle",
        runtime: "stub",
        runtimeSessionId: "rt-1",
        prompt: "",
        model: "claude",
        logPath: "/tmp/log",
        turns: 0,
        startedAt: new Date().toISOString(),
        suspendedAt: null,
        endedAt: null,
        error: null,
        taskId: "task-child",
        personaId: null,
      },
    ]);

    vi.spyOn(sessionStore, "getSession").mockReturnValue({
      id: "sess-1",
      environmentId: "env-1",
      status: "idle",
      runtime: "stub",
      runtimeSessionId: "rt-1",
      prompt: "",
      model: "claude",
      logPath: "/tmp/log",
      turns: 0,
      startedAt: new Date().toISOString(),
      suspendedAt: null,
      endedAt: null,
      error: null,
      taskId: "task-child",
      personaId: null,
    });

    const mockConn = makeMockConnection();
    vi.spyOn(adapterManager, "getConnection").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockConn as any,
    );

    const result = await deliverSignalToTask("task-child", "sigchld", "[SIGCHLD] test");

    expect(result).toBe(true);
    expect(mockConn.client.sendInput).toHaveBeenCalledOnce();
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
    vi.spyOn(sessionStore, "getActiveSessionsForTask").mockReturnValue([
      {
        id: "sess-2",
        environmentId: "env-1",
        status: "running",
        runtime: "stub",
        runtimeSessionId: "rt-2",
        prompt: "",
        model: "claude",
        logPath: "/tmp/log",
        turns: 0,
        startedAt: new Date().toISOString(),
        suspendedAt: null,
        endedAt: null,
        error: null,
        taskId: "task-parent",
        personaId: null,
      },
    ]);

    vi.spyOn(sessionStore, "getSession").mockReturnValue({
      id: "sess-2",
      environmentId: "env-1",
      status: "running",
      runtime: "stub",
      runtimeSessionId: "rt-2",
      prompt: "",
      model: "claude",
      logPath: "/tmp/log",
      turns: 0,
      startedAt: new Date().toISOString(),
      suspendedAt: null,
      endedAt: null,
      error: null,
      taskId: "task-parent",
      personaId: null,
    });

    const mockConn = makeMockConnection();
    vi.spyOn(adapterManager, "getConnection").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockConn as any,
    );

    const result = await deliverSignalToTask("task-parent", "sigchld", "[SIGCHLD] test");

    expect(result).toBe(true);
    expect(mockConn.client.sendInput).toHaveBeenCalledOnce();
  });

  it("reanimates dead session, waits for IDLE, then delivers", async () => {
    vi.spyOn(sessionStore, "getActiveSessionsForTask").mockReturnValue([]);
    vi.spyOn(sessionStore, "getLatestSessionForTask").mockReturnValue({
      id: "sess-dead",
      environmentId: "env-1",
      status: "completed",
      runtime: "stub",
      runtimeSessionId: "rt-dead",
      prompt: "",
      model: "claude",
      logPath: "/tmp/log",
      turns: 3,
      startedAt: new Date().toISOString(),
      suspendedAt: null,
      endedAt: new Date().toISOString(),
      error: null,
      taskId: "task-parent",
      personaId: null,
    });

    // After reanimate, getSession returns IDLE
    vi.spyOn(sessionStore, "getSession").mockReturnValue({
      id: "sess-dead",
      environmentId: "env-1",
      status: "idle",
      runtime: "stub",
      runtimeSessionId: "rt-dead",
      prompt: "",
      model: "claude",
      logPath: "/tmp/log",
      turns: 3,
      startedAt: new Date().toISOString(),
      suspendedAt: null,
      endedAt: null,
      error: null,
      taskId: "task-parent",
      personaId: null,
    });

    const mockConn = makeMockConnection();
    vi.spyOn(adapterManager, "getConnection").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockConn as any,
    );

    const result = await deliverSignalToTask("task-parent", "sigchld", "[SIGCHLD] test");

    expect(reanimateAgent).toHaveBeenCalledWith("sess-dead");
    expect(result).toBe(true);
    expect(mockConn.client.sendInput).toHaveBeenCalledOnce();
  });

  it("returns false when no sessions exist (logs warning)", async () => {
    vi.spyOn(sessionStore, "getActiveSessionsForTask").mockReturnValue([]);
    vi.spyOn(sessionStore, "getLatestSessionForTask").mockReturnValue(undefined);

    const result = await deliverSignalToTask("task-orphan", "sigchld", "[SIGCHLD] test");

    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-orphan", signalType: "sigchld" }),
      expect.stringContaining("No session exists"),
    );
  });

  it("returns false when reanimate fails (logs error)", async () => {
    vi.spyOn(sessionStore, "getActiveSessionsForTask").mockReturnValue([]);
    vi.spyOn(sessionStore, "getLatestSessionForTask").mockReturnValue({
      id: "sess-fail",
      environmentId: "env-1",
      status: "failed",
      runtime: "stub",
      runtimeSessionId: "rt-fail",
      prompt: "",
      model: "claude",
      logPath: "/tmp/log",
      turns: 1,
      startedAt: new Date().toISOString(),
      suspendedAt: null,
      endedAt: new Date().toISOString(),
      error: "boom",
      taskId: "task-parent",
      personaId: null,
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
  });

  it("delivers signal to session via adapter connection", async () => {
    vi.spyOn(sessionStore, "getSession").mockReturnValue({
      id: "sess-1",
      environmentId: "env-1",
      status: "idle",
      runtime: "stub",
      runtimeSessionId: "rt-1",
      prompt: "",
      model: "claude",
      logPath: "/tmp/log",
      turns: 0,
      startedAt: new Date().toISOString(),
      suspendedAt: null,
      endedAt: null,
      error: null,
      taskId: "",
      personaId: null,
    });

    const mockConn = makeMockConnection();
    vi.spyOn(adapterManager, "getConnection").mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockConn as any,
    );

    const result = await sendInputToSession("sess-1", "env-1", "[SIGTERM] stop", "sigterm");

    expect(result).toBe(true);
    expect(mockConn.client.sendInput).toHaveBeenCalledOnce();
    expect(streamHub.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: grackle.EventType.SIGNAL,
        content: "[SIGTERM] stop",
      }),
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
