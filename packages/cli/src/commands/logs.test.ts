import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Command } from "commander";

const mockGetSession = vi.fn();
vi.mock("../client.js", () => ({
  createGrackleClients: () => ({
    core: {
      getSession: mockGetSession,
    },
  }),
}));

vi.mock("@grackle-ai/common", () => ({
  eventTypeToString: (t: string) => t,
}));

describe("registerLogCommands", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
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
});
