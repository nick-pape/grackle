import { describe, test, expect, vi, beforeEach } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";
import type { AuthContext } from "@grackle-ai/auth";
import { logsTools } from "./logs.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";

type GrackleClient = Client<typeof grackle.Grackle>;

/** Helper to find a tool definition by name. */
const getTool = (name: string) => logsTools.find((t) => t.name === name)!;

/** Create a mock Grackle client with methods used by logs_get. */
function createMockClient(): GrackleClient {
  return {
    getSession: vi.fn(),
    streamSession: vi.fn(),
  } as unknown as GrackleClient;
}

/** Helper to configure getSession to return a session with the given logPath. */
function mockSessionWithLogPath(mockClient: GrackleClient, sessionId: string, logPath: string): void {
  (mockClient.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: sessionId,
    logPath,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("logs_get", () => {
  /** Should return isError when the session ID is not found. */
  test("session not found returns isError", async () => {
    const mockClient = createMockClient();
    (mockClient.getSession as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConnectError("Session not found: no-such", Code.NotFound),
    );

    const result = await getTool("logs_get").handler(
      { sessionId: "no-such" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(parsed.error).toBe("Session not found");
    expect(parsed.code).toBe("NOT_FOUND");
  });

  /** Should return isError when the session has no logPath. */
  test("session with no logPath returns isError", async () => {
    const mockClient = createMockClient();
    (mockClient.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "s1",
      logPath: "",
    });

    const result = await getTool("logs_get").handler(
      { sessionId: "s1" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(parsed.error).toBe("Session has no log path");
  });

  // ── Tail mode ─────────────────────────────────────────────────────────

  /** Should stream events in tail mode and return them. */
  test("tail mode collects streamed events", async () => {
    const mockClient = createMockClient();
    mockSessionWithLogPath(mockClient, "s1", "/logs/s1");

    const mockStream = (async function* () {
      yield { type: 1, timestamp: "2026-01-01T00:00:00Z", content: "output line" };
      yield { type: 2, timestamp: "2026-01-01T00:00:01Z", content: "more output" };
    })();
    (mockClient.streamSession as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);

    const result = await getTool("logs_get").handler(
      { sessionId: "s1", tail: true, timeoutSeconds: 10 },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(parsed.events).toHaveLength(2);
    expect(typeof parsed.events[0].type).toBe("string");
    expect(parsed.events[0].content).toBe("output line");
    expect(parsed.timedOut).toBe(false);
  });

  // ── Transcript mode ───────────────────────────────────────────────────

  /** Should read transcript.md and return its content. */
  test("transcript mode returns file content", async () => {
    const mockClient = createMockClient();
    mockSessionWithLogPath(mockClient, "s1", "/logs/s1");

    const mockReadFile = readFile as ReturnType<typeof vi.fn>;
    mockReadFile.mockResolvedValue("# Session Transcript\n\nHello world");

    const result = await getTool("logs_get").handler(
      { sessionId: "s1", transcript: true },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(parsed.sessionId).toBe("s1");
    expect(parsed.transcript).toContain("Hello world");
  });

  /** Should return isError when transcript file is not found. */
  test("transcript mode file not found returns isError", async () => {
    const mockClient = createMockClient();
    mockSessionWithLogPath(mockClient, "s1", "/logs/s1");

    const mockReadFile = readFile as ReturnType<typeof vi.fn>;
    const enoent = new Error("ENOENT: no such file or directory");
    (enoent as NodeJS.ErrnoException).code = "ENOENT";
    mockReadFile.mockRejectedValue(enoent);

    const result = await getTool("logs_get").handler(
      { sessionId: "s1", transcript: true },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(parsed.error).toBe("Transcript file not found");
    expect(parsed.code).toBe("NOT_FOUND");
  });

  // ── Default mode (stream.jsonl) ───────────────────────────────────────

  /** Should read stream.jsonl and parse each line as JSON. */
  test("default mode reads and parses stream.jsonl", async () => {
    const mockClient = createMockClient();
    mockSessionWithLogPath(mockClient, "s1", "/logs/s1");

    const mockReadFile = readFile as ReturnType<typeof vi.fn>;
    const jsonlContent = [
      JSON.stringify({ type: "output", content: "line 1" }),
      JSON.stringify({ type: "output", content: "line 2" }),
    ].join("\n");
    mockReadFile.mockResolvedValue(jsonlContent);

    const result = await getTool("logs_get").handler(
      { sessionId: "s1" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(parsed.sessionId).toBe("s1");
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0].content).toBe("line 1");
  });

  /** Should return isError with NOT_FOUND code when stream.jsonl is missing (ENOENT). */
  test("default mode ENOENT returns isError with NOT_FOUND", async () => {
    const mockClient = createMockClient();
    mockSessionWithLogPath(mockClient, "s1", "/logs/s1");

    const mockReadFile = readFile as ReturnType<typeof vi.fn>;
    const enoent = new Error("ENOENT: no such file or directory");
    (enoent as NodeJS.ErrnoException).code = "ENOENT";
    mockReadFile.mockRejectedValue(enoent);

    const result = await getTool("logs_get").handler(
      { sessionId: "s1" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(parsed.error).toBe("Log file not found");
    expect(parsed.code).toBe("NOT_FOUND");
  });

  /** Should return isError with INTERNAL code for non-ENOENT errors in default mode. */
  test("default mode other error returns isError with INTERNAL", async () => {
    const mockClient = createMockClient();
    mockSessionWithLogPath(mockClient, "s1", "/logs/s1");

    const mockReadFile = readFile as ReturnType<typeof vi.fn>;
    const permError = new Error("EACCES: permission denied");
    (permError as NodeJS.ErrnoException).code = "EACCES";
    mockReadFile.mockRejectedValue(permError);

    const result = await getTool("logs_get").handler(
      { sessionId: "s1" },
      mockClient,
    );
    const parsed = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(parsed.error).toContain("Failed to read log file");
    expect(parsed.code).toBe("INTERNAL");
  });

  // ── Scoped auth ancestry enforcement ─────────────────────────

  /** Should reject when scoped auth and session's task is not a descendant. */
  test("rejects when scoped auth and session task is not a descendant", async () => {
    const scopedAuth: AuthContext = {
      type: "scoped",
      taskId: "parent-task",
      workspaceId: "proj-1",
      personaId: "p-1",
      taskSessionId: "sess-1",
    };
    const mockClient = createMockClient();
    (mockClient.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "s1",
      taskId: "unrelated-task",
      logPath: "/logs/s1",
    });
    (mockClient as unknown as { getTask: ReturnType<typeof vi.fn> }).getTask = vi.fn().mockResolvedValue({
      id: "unrelated-task",
      parentTaskId: "",
    });

    const result = await getTool("logs_get").handler(
      { sessionId: "s1" },
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
      workspaceId: "proj-1",
      personaId: "p-1",
      taskSessionId: "sess-1",
    };
    const mockClient = createMockClient();
    (mockClient.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "s1",
      taskId: "child-task",
      logPath: "/logs/s1",
    });
    (mockClient as unknown as { getTask: ReturnType<typeof vi.fn> }).getTask = vi.fn().mockResolvedValue({
      id: "child-task",
      parentTaskId: "parent-task",
    });

    const mockReadFile = readFile as ReturnType<typeof vi.fn>;
    const jsonlContent = JSON.stringify({ type: "output", content: "line 1" });
    mockReadFile.mockResolvedValue(jsonlContent);

    const result = await getTool("logs_get").handler(
      { sessionId: "s1" },
      mockClient,
      scopedAuth,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.sessionId).toBe("s1");
  });

  /** Should reject when scoped auth and session has no taskId (taskless session). */
  test("rejects when scoped auth and session has empty taskId", async () => {
    const scopedAuth: AuthContext = {
      type: "scoped",
      taskId: "parent-task",
      workspaceId: "proj-1",
      personaId: "p-1",
      taskSessionId: "sess-1",
    };
    const mockClient = createMockClient();
    (mockClient.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "s1",
      taskId: "",
      logPath: "/logs/s1",
    });

    const result = await getTool("logs_get").handler(
      { sessionId: "s1" },
      mockClient,
      scopedAuth,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("PERMISSION_DENIED");
  });

  /** Should not check ancestry for non-scoped auth. */
  test("passes for non-scoped auth without ancestry check", async () => {
    const apiKeyAuth: AuthContext = { type: "api-key" };
    const mockClient = createMockClient();
    mockSessionWithLogPath(mockClient, "s1", "/logs/s1");

    const mockReadFile = readFile as ReturnType<typeof vi.fn>;
    const jsonlContent = JSON.stringify({ type: "output", content: "line 1" });
    mockReadFile.mockResolvedValue(jsonlContent);

    const result = await getTool("logs_get").handler(
      { sessionId: "s1" },
      mockClient,
      apiKeyAuth,
    );

    expect(result.isError).toBeUndefined();
    // getTask should never have been called — no ancestry check for full-access auth
    expect((mockClient as unknown as { getTask: ReturnType<typeof vi.fn> }).getTask).toBeUndefined();
  });
});
