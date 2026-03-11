import { describe, it, expect, vi, afterEach } from "vitest";

// Mock dependencies before importing
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
}));

import { itemType, CodexRuntime } from "./codex.js";
import { resolveMcpServers } from "./runtime-utils.js";
import { existsSync, readFileSync } from "node:fs";

describe("itemType", () => {
  it("extracts the type field", () => {
    expect(itemType({ type: "command_execution" })).toBe("command_execution");
    expect(itemType({ type: "file_change" })).toBe("file_change");
    expect(itemType({ type: "agent_message" })).toBe("agent_message");
  });

  it("returns 'unknown' for missing type", () => {
    expect(itemType({})).toBe("unknown");
  });

  it("returns 'unknown' for undefined type", () => {
    expect(itemType({ type: undefined })).toBe("unknown");
  });
});

describe("resolveMcpServers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(existsSync).mockReturnValue(false);
  });

  it("loads servers and disallowed tools from config", () => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "/tmp/mcp.json");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        mcpServers: {
          myServer: { command: "node", args: ["s.js"], tools: ["tool_a", "tool_b"] },
        },
        disallowedTools: ["mcp__myServer__tool_b"],
      }),
    );

    const result = resolveMcpServers();
    expect(result.servers).toBeDefined();

    // tool_b should be filtered out
    const serverConfig = result.servers!.myServer as Record<string, unknown>;
    expect(serverConfig.tools).toEqual(["tool_a"]);
    expect(result.disallowedTools).toEqual(["mcp__myServer__tool_b"]);
  });

  it("removes server entirely when all tools are blocked", () => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "/tmp/mcp.json");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        mcpServers: {
          blocked: { command: "node", args: [], tools: ["only_tool"] },
        },
        disallowedTools: ["mcp__blocked__only_tool"],
      }),
    );

    const result = resolveMcpServers();
    // Server should be removed entirely since it has no remaining tools
    expect(result.servers?.blocked).toBeUndefined();
  });

  it("merges spawn servers with config file servers", () => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "/tmp/mcp.json");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        mcpServers: { configServer: { command: "a" } },
      }),
    );

    const result = resolveMcpServers({ spawnServer: { command: "b" } });
    expect(result.servers).toBeDefined();
    expect(result.servers!.configServer).toBeDefined();
    expect(result.servers!.spawnServer).toBeDefined();
  });

  it("auto-injects grackle server when script exists", () => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "");
    vi.mocked(existsSync).mockImplementation((p) => {
      return String(p) === "/app/mcp-grackle/index.js";
    });

    const result = resolveMcpServers();
    expect(result.servers).toBeDefined();
    expect(result.servers!.grackle).toEqual({
      command: "node",
      args: ["/app/mcp-grackle/index.js"],
      tools: ["post_finding", "create_subtask", "get_task_context", "update_task_status"],
    });
  });

  it("returns undefined servers when no config and script not present", () => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "");
    vi.mocked(existsSync).mockReturnValue(false);

    const result = resolveMcpServers();
    expect(result.servers).toBeUndefined();
    expect(result.disallowedTools).toEqual([]);
  });

  it("handles malformed config gracefully", () => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "/tmp/bad.json");
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/tmp/bad.json");
    vi.mocked(readFileSync).mockReturnValue("not json");

    const result = resolveMcpServers();
    expect(result.servers).toBeUndefined();
    expect(result.disallowedTools).toEqual([]);
  });
});

describe("CodexRuntime structural", () => {
  it("has name 'codex'", () => {
    const runtime = new CodexRuntime();
    expect(runtime.name).toBe("codex");
  });

  it("spawn returns a session with correct properties", () => {
    const runtime = new CodexRuntime();
    const session = runtime.spawn({
      sessionId: "cdx-1",
      prompt: "test",
      model: "codex-mini",
      maxTurns: 10,
    });
    expect(session.id).toBe("cdx-1");
    expect(session.runtimeName).toBe("codex");
    expect(session.status).toBe("running");
  });

  it("resume sets runtimeSessionId from options", () => {
    const runtime = new CodexRuntime();
    const session = runtime.resume({
      sessionId: "cdx-resume",
      runtimeSessionId: "thread-abc",
    });
    expect(session.id).toBe("cdx-resume");
    expect(session.runtimeSessionId).toBe("thread-abc");
  });
});
