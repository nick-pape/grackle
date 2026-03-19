import { describe, test, expect, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import type { AuthContext } from "../auth-context.js";
import { sessionTools } from "./session.js";

type GrackleClient = Client<typeof grackle.Grackle>;

/** Helper to find a tool definition by name. */
const getTool = (name: string) => sessionTools.find((t) => t.name === name)!;

/** Create a mock Grackle client with all session-related methods stubbed. */
function createMockClient(): GrackleClient {
  return {
    spawnAgent: vi.fn(),
    resumeAgent: vi.fn(),
    listSessions: vi.fn(),
    getSession: vi.fn(),
    killAgent: vi.fn(),
    streamSession: vi.fn(),
    sendInput: vi.fn(),
  } as unknown as GrackleClient;
}

describe("session_spawn", () => {
  /** Should call spawnAgent with provided args and return the session. */
  test("happy path returns spawned session", async () => {
    const mockClient = createMockClient();
    (mockClient.spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "session-1",
      environmentId: "env-1",
      status: "running",
    });

    const result = await getTool("session_spawn").handler(
      {
        environmentId: "env-1",
        prompt: "Fix the bug",
        model: "claude-sonnet-4-20250514",
        maxTurns: 10,
      },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.id).toBe("session-1");
    expect(parsed.status).toBe("running");
    expect(result.isError).toBeUndefined();
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.spawnAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("env not found", Code.NotFound),
    );

    const result = await getTool("session_spawn").handler(
      { environmentId: "env-missing", prompt: "test" },
      mockClient,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("NOT_FOUND");
  });
});

describe("session_resume", () => {
  /** Should call resumeAgent with the session ID. */
  test("happy path returns resumed session", async () => {
    const mockClient = createMockClient();
    (mockClient.resumeAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "session-2",
      status: "running",
    });

    const result = await getTool("session_resume").handler(
      { sessionId: "session-2" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.id).toBe("session-2");
    expect(mockClient.resumeAgent).toHaveBeenCalledWith({ sessionId: "session-2" });
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.resumeAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("not found", Code.NotFound),
    );

    const result = await getTool("session_resume").handler(
      { sessionId: "no-such" },
      mockClient,
    );

    expect(result.isError).toBe(true);
  });
});

describe("session_status", () => {
  const allSessions = [
    { id: "s1", environmentId: "env-1", runtime: "cc", status: "pending", prompt: "p1", model: "m1", turns: 0, startedAt: "t1", taskId: "" },
    { id: "s2", environmentId: "env-1", runtime: "cc", status: "running", prompt: "p2", model: "m1", turns: 3, startedAt: "t2", taskId: "" },
    { id: "s3", environmentId: "env-1", runtime: "cc", status: "idle", prompt: "p3", model: "m1", turns: 1, startedAt: "t3", taskId: "" },
    { id: "s4", environmentId: "env-1", runtime: "cc", status: "completed", prompt: "p4", model: "m1", turns: 5, startedAt: "t4", taskId: "" },
    { id: "s5", environmentId: "env-1", runtime: "cc", status: "failed", prompt: "p5", model: "m1", turns: 2, startedAt: "t5", taskId: "" },
    { id: "s6", environmentId: "env-1", runtime: "cc", status: "interrupted", prompt: "p6", model: "m1", turns: 1, startedAt: "t6", taskId: "" },
  ];

  /** Should filter to only active sessions when all=false (default). */
  test("default (all=false) filters to active sessions only", async () => {
    const mockClient = createMockClient();
    (mockClient.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: allSessions,
    });

    const result = await getTool("session_status").handler(
      { all: false },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveLength(3);
    const statuses = parsed.map((s: { status: string }) => s.status);
    expect(statuses).toEqual(["pending", "running", "idle"]);
  });

  /** Should return all sessions when all=true. */
  test("all=true returns every session", async () => {
    const mockClient = createMockClient();
    (mockClient.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: allSessions,
    });

    const result = await getTool("session_status").handler(
      { all: true },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveLength(6);
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.listSessions as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("unavailable", Code.Unavailable),
    );

    const result = await getTool("session_status").handler({}, mockClient);

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("UNAVAILABLE");
  });
});

describe("session_kill", () => {
  /** Should call killAgent with the session ID. */
  test("happy path returns success", async () => {
    const mockClient = createMockClient();
    (mockClient.killAgent as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await getTool("session_kill").handler(
      { sessionId: "session-99" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(mockClient.killAgent).toHaveBeenCalledWith({ id: "session-99" });
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.killAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("not found", Code.NotFound),
    );

    const result = await getTool("session_kill").handler(
      { sessionId: "no-such" },
      mockClient,
    );

    expect(result.isError).toBe(true);
  });
});

describe("session_attach", () => {
  /** Should collect streamed events and convert type via eventTypeToString. */
  test("happy path collects events with string type", async () => {
    const mockClient = createMockClient();
    const mockStream = (async function* () {
      yield { type: 1, timestamp: "2026-01-01T00:00:00Z", content: "hello" };
      yield { type: 2, timestamp: "2026-01-01T00:00:01Z", content: "world" };
    })();
    (mockClient.streamSession as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);

    const result = await getTool("session_attach").handler(
      { sessionId: "s1", timeoutSeconds: 30 },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.events).toHaveLength(2);
    expect(typeof parsed.events[0].type).toBe("string");
    expect(parsed.events[0].content).toBe("hello");
    expect(parsed.timedOut).toBe(false);
    expect(result.isError).toBeUndefined();
  });

  /** Should break early when maxEvents limit is reached. */
  test("maxEvents limits collected events", async () => {
    const mockClient = createMockClient();
    const mockStream = (async function* () {
      yield { type: 1, timestamp: "t1", content: "a" };
      yield { type: 1, timestamp: "t2", content: "b" };
      yield { type: 1, timestamp: "t3", content: "c" };
    })();
    (mockClient.streamSession as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);

    const result = await getTool("session_attach").handler(
      { sessionId: "s1", timeoutSeconds: 30, maxEvents: 2 },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[1].content).toBe("b");
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    const mockStream = (async function* () {
      throw new ConnectError("not found", Code.NotFound);
    })();
    (mockClient.streamSession as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);

    const result = await getTool("session_attach").handler(
      { sessionId: "no-such", timeoutSeconds: 5 },
      mockClient,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("NOT_FOUND");
  });
});

describe("session_send_input", () => {
  /** Should call sendInput with session ID and text. */
  test("happy path returns success", async () => {
    const mockClient = createMockClient();
    (mockClient.sendInput as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await getTool("session_send_input").handler(
      { sessionId: "s1", text: "yes" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(mockClient.sendInput).toHaveBeenCalledWith({
      sessionId: "s1",
      text: "yes",
    });
  });

  /** Should return a structured error on ConnectError. */
  test("ConnectError returns isError result", async () => {
    const mockClient = createMockClient();
    (mockClient.sendInput as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("precondition", Code.FailedPrecondition),
    );

    const result = await getTool("session_send_input").handler(
      { sessionId: "s1", text: "yes" },
      mockClient,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("FAILED_PRECONDITION");
  });

  /** Should reject when scoped auth and session's task is not a descendant. */
  test("rejects when scoped auth and session task is not a descendant", async () => {
    const scopedAuth: AuthContext = {
      type: "scoped",
      taskId: "parent-task",
      projectId: "proj-1",
      personaId: "p-1",
      taskSessionId: "sess-1",
    };
    const mockClient = createMockClient();
    (mockClient.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "s1",
      taskId: "unrelated-task",
    });
    (mockClient as unknown as { getTask: ReturnType<typeof vi.fn> }).getTask = vi.fn().mockResolvedValue({
      id: "unrelated-task",
      parentTaskId: "",
    });

    const result = await getTool("session_send_input").handler(
      { sessionId: "s1", text: "yes" },
      mockClient,
      scopedAuth,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("PERMISSION_DENIED");
  });

  /** Should pass when scoped auth and session's task is a descendant. */
  test("passes when scoped auth and session task is a descendant", async () => {
    const scopedAuth: AuthContext = {
      type: "scoped",
      taskId: "parent-task",
      projectId: "proj-1",
      personaId: "p-1",
      taskSessionId: "sess-1",
    };
    const mockClient = createMockClient();
    (mockClient.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "s1",
      taskId: "child-task",
    });
    (mockClient as unknown as { getTask: ReturnType<typeof vi.fn> }).getTask = vi.fn().mockResolvedValue({
      id: "child-task",
      parentTaskId: "parent-task",
    });
    (mockClient.sendInput as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await getTool("session_send_input").handler(
      { sessionId: "s1", text: "yes" },
      mockClient,
      scopedAuth,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  /** Should return NOT_FOUND when scoped auth and session does not exist. */
  test("returns NOT_FOUND when scoped auth and session not found", async () => {
    const scopedAuth: AuthContext = {
      type: "scoped",
      taskId: "parent-task",
      projectId: "proj-1",
      personaId: "p-1",
      taskSessionId: "sess-1",
    };
    const mockClient = createMockClient();
    (mockClient.getSession as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("Session not found", Code.NotFound),
    );

    const result = await getTool("session_send_input").handler(
      { sessionId: "nonexistent", text: "yes" },
      mockClient,
      scopedAuth,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("NOT_FOUND");
  });
});
