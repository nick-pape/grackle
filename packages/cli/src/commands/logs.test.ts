import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Command } from "commander";
import { ConnectError, Code } from "@connectrpc/connect";

const mockGetSession = vi.fn();
const mockListSessions = vi.fn();
const mockStreamSession = vi.fn();

vi.mock("../client.js", () => ({
  createGrackleClients: () => ({
    core: {
      getSession: mockGetSession,
      listSessions: mockListSessions,
      streamSession: mockStreamSession,
    },
  }),
}));

vi.mock("@grackle-ai/common", () => ({
  eventTypeToString: (t: number) => `type-${t}`,
}));

describe("registerLogCommands", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as (code?: string | number | null) => never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("skips malformed JSONL lines without crashing", async () => {
    const validLine1 = JSON.stringify({
      timestamp: "2026-01-01T00:00:00Z",
      type: "info",
      content: "hello",
    });
    const validLine2 = JSON.stringify({
      timestamp: "2026-01-01T00:00:01Z",
      type: "info",
      content: "world",
    });
    const fileContent = [validLine1, "not valid json{{{", "", validLine2, "truncated"].join("\n");

    mockGetSession.mockResolvedValue({ id: "sess-1", logPath: "/fake/path" });

    vi.doMock("node:fs", () => ({
      readFileSync: () => fileContent,
      existsSync: () => true,
    }));

    const { registerLogCommands } = await import("./logs.js");
    const program = new Command();
    program.exitOverride();
    registerLogCommands(program);

    await program.parseAsync(["logs", "sess-1"], { from: "user" });

    const logged = logSpy.mock.calls.map((c) => c[0] as string);
    expect(logged).toHaveLength(2);
    expect(logged[0]).toContain("hello");
    expect(logged[1]).toContain("world");
  });

  it("prints valid JSONL lines", async () => {
    const line = JSON.stringify({
      timestamp: "2026-01-01T12:00:00Z",
      type: "output",
      content: "test content",
    });

    mockGetSession.mockResolvedValue({ id: "sess-1", logPath: "/fake" });

    vi.doMock("node:fs", () => ({
      readFileSync: () => line,
      existsSync: () => true,
    }));

    const { registerLogCommands } = await import("./logs.js");
    const program = new Command();
    program.exitOverride();
    registerLogCommands(program);

    await program.parseAsync(["logs", "sess-1"], { from: "user" });

    const logged = logSpy.mock.calls.map((c) => c[0] as string);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("test content");
  });

  it("exits when session is not found", async () => {
    mockGetSession.mockRejectedValue(new ConnectError("not found", Code.NotFound));
    mockListSessions.mockResolvedValue({ sessions: [] });

    vi.doMock("node:fs", () => ({
      readFileSync: () => "",
      existsSync: () => true,
    }));

    const { registerLogCommands } = await import("./logs.js");
    const program = new Command();
    program.exitOverride();
    registerLogCommands(program);

    await expect(program.parseAsync(["logs", "sess-missing"], { from: "user" })).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledWith("Session not found: sess-missing");
  });

  it("falls back to prefix match on NotFound", async () => {
    mockGetSession.mockRejectedValue(new ConnectError("not found", Code.NotFound));
    mockListSessions.mockResolvedValue({
      sessions: [{ id: "sess-abc-123", logPath: "/fake" }],
    });

    const line = JSON.stringify({
      timestamp: "2026-01-01T00:00:00Z",
      type: "info",
      content: "found-by-prefix",
    });

    vi.doMock("node:fs", () => ({
      readFileSync: () => line,
      existsSync: () => true,
    }));

    const { registerLogCommands } = await import("./logs.js");
    const program = new Command();
    program.exitOverride();
    registerLogCommands(program);

    await program.parseAsync(["logs", "sess-abc"], { from: "user" });

    const logged = logSpy.mock.calls.map((c) => c[0] as string);
    expect(logged[0]).toContain("found-by-prefix");
  });

  it("re-throws non-NotFound errors", async () => {
    mockGetSession.mockRejectedValue(new Error("network failure"));

    vi.doMock("node:fs", () => ({
      readFileSync: () => "",
      existsSync: () => true,
    }));

    const { registerLogCommands } = await import("./logs.js");
    const program = new Command();
    program.exitOverride();
    registerLogCommands(program);

    await expect(program.parseAsync(["logs", "sess-1"], { from: "user" })).rejects.toThrow(
      "network failure",
    );
  });

  it("exits when session has no logPath", async () => {
    mockGetSession.mockResolvedValue({ id: "sess-1", logPath: "" });

    vi.doMock("node:fs", () => ({
      readFileSync: () => "",
      existsSync: () => true,
    }));

    const { registerLogCommands } = await import("./logs.js");
    const program = new Command();
    program.exitOverride();
    registerLogCommands(program);

    await expect(program.parseAsync(["logs", "sess-1"], { from: "user" })).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledWith("No log path for session");
  });

  it("exits when JSONL file does not exist", async () => {
    mockGetSession.mockResolvedValue({ id: "sess-1", logPath: "/fake" });

    vi.doMock("node:fs", () => ({
      readFileSync: () => "",
      existsSync: () => false,
    }));

    const { registerLogCommands } = await import("./logs.js");
    const program = new Command();
    program.exitOverride();
    registerLogCommands(program);

    await expect(program.parseAsync(["logs", "sess-1"], { from: "user" })).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledWith("No log file found");
  });

  it("reads transcript when --transcript is passed and file exists", async () => {
    mockGetSession.mockResolvedValue({ id: "sess-1", logPath: "/fake" });

    vi.doMock("node:fs", () => ({
      readFileSync: () => "# Transcript\nHello world",
      existsSync: () => true,
    }));

    const { registerLogCommands } = await import("./logs.js");
    const program = new Command();
    program.exitOverride();
    registerLogCommands(program);

    await program.parseAsync(["logs", "sess-1", "--transcript"], { from: "user" });

    const logged = logSpy.mock.calls.map((c) => c[0] as string);
    expect(logged[0]).toContain("# Transcript");
  });

  it("shows error when transcript does not exist", async () => {
    mockGetSession.mockResolvedValue({ id: "sess-1", logPath: "/fake" });

    vi.doMock("node:fs", () => ({
      readFileSync: () => "",
      existsSync: () => false,
    }));

    const { registerLogCommands } = await import("./logs.js");
    const program = new Command();
    program.exitOverride();
    registerLogCommands(program);

    await program.parseAsync(["logs", "sess-1", "--transcript"], { from: "user" });

    expect(errorSpy).toHaveBeenCalledWith(
      "Transcript not yet generated (session may still be running)",
    );
  });

  it("streams live events with --tail", async () => {
    const events = [
      { timestamp: "2026-01-01T00:00:00Z", type: 1, content: "event-1" },
      { timestamp: "2026-01-01T00:00:01Z", type: 2, content: "event-2" },
    ];

    mockStreamSession.mockReturnValue(
      (async function* (): AsyncGenerator<(typeof events)[0]> {
        for (const e of events) {
          yield e;
        }
      })(),
    );

    const { registerLogCommands } = await import("./logs.js");
    const program = new Command();
    program.exitOverride();
    registerLogCommands(program);

    await program.parseAsync(["logs", "sess-1", "--tail"], { from: "user" });

    const logged = logSpy.mock.calls.map((c) => c[0] as string);
    expect(logged[0]).toContain("Streaming session sess-1");
    expect(logged[1]).toContain("event-1");
    expect(logged[2]).toContain("event-2");
  });

  it("re-throws ConnectError with non-NotFound code", async () => {
    mockGetSession.mockRejectedValue(new ConnectError("permission denied", Code.PermissionDenied));

    vi.doMock("node:fs", () => ({
      readFileSync: () => "",
      existsSync: () => true,
    }));

    const { registerLogCommands } = await import("./logs.js");
    const program = new Command();
    program.exitOverride();
    registerLogCommands(program);

    await expect(program.parseAsync(["logs", "sess-1"], { from: "user" })).rejects.toThrow(
      "permission denied",
    );
  });
});
