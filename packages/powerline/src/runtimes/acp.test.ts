import { describe, it, expect, vi } from "vitest";

// Mock dependencies before importing
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
  readdirSync: vi.fn(() => []),
}));

import { mapSessionUpdate, autoApprovePermission, AcpRuntime } from "./acp.js";
import { convertMcpServers } from "./runtime-utils.js";

// ─── mapSessionUpdate ───────────────────────────────────────

describe("mapSessionUpdate", () => {
  it("maps agent_message_chunk with text content to a text event", () => {
    const update = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hello world" },
    };
    const events = mapSessionUpdate(update);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("text");
    expect(events[0].content).toBe("Hello world");
    expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(events[0].raw).toBe(update);
  });

  it("skips agent_message_chunk with non-text content", () => {
    const update = {
      sessionUpdate: "agent_message_chunk",
      content: { type: "image", url: "https://example.com/img.png" },
    };
    expect(mapSessionUpdate(update)).toHaveLength(0);
  });

  it("maps agent_thought_chunk to a text event with [thinking] prefix", () => {
    const update = {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "Let me think about this..." },
    };
    const events = mapSessionUpdate(update);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("text");
    expect(events[0].content).toBe("[thinking] Let me think about this...");
  });

  it("maps tool_call to a tool_use event", () => {
    const update = {
      sessionUpdate: "tool_call",
      toolCallId: "tc-1",
      title: "read_file",
      status: "pending",
      rawInput: { path: "/src/index.ts" },
    };
    const events = mapSessionUpdate(update);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_use");
    const parsed = JSON.parse(events[0].content);
    expect(parsed.tool).toBe("read_file");
    expect(parsed.args).toEqual({ path: "/src/index.ts" });
  });

  it("maps tool_call_update (completed) to a tool_result event", () => {
    const update = {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-1",
      status: "completed",
      rawOutput: { content: "file contents here" },
    };
    const events = mapSessionUpdate(update);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_result");
    expect(JSON.parse(events[0].content)).toEqual({ content: "file contents here" });
  });

  it("maps tool_call_update (completed) with string content fallback", () => {
    const update = {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-2",
      status: "completed",
      rawOutput: null,
      content: "plain text output",
    };
    const events = mapSessionUpdate(update);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_result");
    expect(events[0].content).toBe("plain text output");
  });

  it("maps tool_call_update (failed) to a tool_result event with error", () => {
    const update = {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-3",
      status: "failed",
      rawOutput: { error: "Permission denied" },
    };
    const events = mapSessionUpdate(update);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_result");
    expect(events[0].content).toBe("Permission denied");
  });

  it("maps tool_call_update (failed) with fallback error message", () => {
    const update = {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-4",
      status: "failed",
    };
    const events = mapSessionUpdate(update);
    expect(events).toHaveLength(1);
    expect(events[0].content).toBe("Tool call failed");
  });

  it("skips tool_call_update with in_progress status", () => {
    const update = {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-5",
      status: "in_progress",
    };
    expect(mapSessionUpdate(update)).toHaveLength(0);
  });

  it("skips tool_call_update with pending status", () => {
    const update = {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-6",
      status: "pending",
    };
    expect(mapSessionUpdate(update)).toHaveLength(0);
  });

  it("maps plan to a system event with formatted entries", () => {
    const update = {
      sessionUpdate: "plan",
      entries: [
        { content: "Read the file", status: "completed", priority: "high" },
        { content: "Write tests", status: "in_progress", priority: "medium" },
        { content: "Deploy", status: "pending", priority: "low" },
      ],
    };
    const events = mapSessionUpdate(update);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("system");
    expect(events[0].content).toBe(
      "[completed] Read the file\n[in_progress] Write tests\n[pending] Deploy",
    );
  });

  it("skips plan with empty entries", () => {
    const update = { sessionUpdate: "plan", entries: [] };
    expect(mapSessionUpdate(update)).toHaveLength(0);
  });

  it("skips unrecognized update types", () => {
    expect(mapSessionUpdate({ sessionUpdate: "usage_update" })).toHaveLength(0);
    expect(mapSessionUpdate({ sessionUpdate: "config_option_update" })).toHaveLength(0);
    expect(mapSessionUpdate({ sessionUpdate: "session_info_update" })).toHaveLength(0);
  });
});

// ─── autoApprovePermission ──────────────────────────────────

describe("autoApprovePermission", () => {
  it("selects allow_once option when available", () => {
    const result = autoApprovePermission({
      options: [
        { optionId: "deny-1", kind: "deny" },
        { optionId: "allow-1", kind: "allow_once" },
        { optionId: "allow-2", kind: "allow_always" },
      ],
    });
    expect(result.outcome.outcome).toBe("selected");
    expect(result.outcome.optionId).toBe("allow-1");
  });

  it("selects allow_always option when allow_once is not available", () => {
    const result = autoApprovePermission({
      options: [
        { optionId: "deny-1", kind: "deny" },
        { optionId: "allow-2", kind: "allow_always" },
      ],
    });
    expect(result.outcome.outcome).toBe("selected");
    expect(result.outcome.optionId).toBe("allow-2");
  });

  it("falls back to first option when no allow option exists", () => {
    const result = autoApprovePermission({
      options: [
        { optionId: "deny-1", kind: "deny" },
        { optionId: "deny-2", kind: "deny_always" },
      ],
    });
    expect(result.outcome.outcome).toBe("selected");
    expect(result.outcome.optionId).toBe("deny-1");
  });

  it("handles single option", () => {
    const result = autoApprovePermission({
      options: [{ optionId: "only-1", kind: "allow_once" }],
    });
    expect(result.outcome.optionId).toBe("only-1");
  });
});

// ─── convertMcpServers ──────────────────────────────────────

describe("convertMcpServers", () => {
  it("converts Grackle format to ACP format", () => {
    const servers = {
      grackle: { command: "node", args: ["mcp.js"], env: { FOO: "bar" } },
    };
    const result = convertMcpServers(servers);
    expect(result).toEqual([
      { name: "grackle", transport: "stdio", command: "node", args: ["mcp.js"], env: { FOO: "bar" } },
    ]);
  });

  it("handles multiple servers", () => {
    const servers = {
      server1: { command: "cmd1", args: ["a"] },
      server2: { command: "cmd2", args: ["b", "c"] },
    };
    const result = convertMcpServers(servers);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("server1");
    expect(result[1].name).toBe("server2");
    expect(result[0].transport).toBe("stdio");
    expect(result[1].transport).toBe("stdio");
  });

  it("returns empty array for undefined input", () => {
    expect(convertMcpServers(undefined)).toEqual([]);
  });

  it("returns empty array for empty object", () => {
    expect(convertMcpServers({})).toEqual([]);
  });

  it("preserves extra fields from config", () => {
    const servers = {
      myServer: { command: "node", args: [], tools: ["tool_a", "tool_b"], customField: 42 },
    };
    const result = convertMcpServers(servers);
    expect(result[0]).toEqual({
      name: "myServer",
      transport: "stdio",
      command: "node",
      args: [],
      tools: ["tool_a", "tool_b"],
      customField: 42,
    });
  });

  it("detects HTTP transport from type field", () => {
    const servers = {
      grackle: {
        type: "http",
        url: "http://localhost:7435/mcp",
        headers: { Authorization: "Bearer tok123" },
        tools: ["*"],
      },
    };
    const result = convertMcpServers(servers);
    expect(result).toHaveLength(1);
    expect(result[0].transport).toBe("http");
    expect(result[0].url).toBe("http://localhost:7435/mcp");
    expect(result[0].name).toBe("grackle");
  });

  it("detects HTTP transport from url field without explicit type", () => {
    const servers = {
      remote: { url: "http://example.com/mcp" },
    };
    const result = convertMcpServers(servers);
    expect(result[0].transport).toBe("http");
  });

  it("skips non-object config values", () => {
    const servers = {
      good: { command: "node", args: [] },
      bad: "not an object" as unknown,
      worse: null as unknown,
    } as Record<string, unknown>;
    const result = convertMcpServers(servers);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("good");
  });

  it("handles mixed stdio and HTTP servers", () => {
    const servers = {
      local: { command: "node", args: ["mcp.js"] },
      remote: { type: "http", url: "http://example.com/mcp" },
    };
    const result = convertMcpServers(servers);
    expect(result).toHaveLength(2);
    expect(result[0].transport).toBe("stdio");
    expect(result[1].transport).toBe("http");
  });
});

// ─── AcpRuntime structural ──────────────────────────────────

describe("AcpRuntime structural", () => {
  it("has the configured name", () => {
    const runtime = new AcpRuntime({ name: "codex-acp", command: "codex", args: ["--acp"] });
    expect(runtime.name).toBe("codex-acp");
  });

  it("spawn returns a session with correct properties", () => {
    const runtime = new AcpRuntime({ name: "copilot-acp", command: "copilot", args: ["--acp"] });
    const session = runtime.spawn({
      sessionId: "acp-1",
      prompt: "test prompt",
      model: "gpt-4",
      maxTurns: 10,
    });
    expect(session.id).toBe("acp-1");
    expect(session.runtimeName).toBe("copilot-acp");
    expect(session.status).toBe("running");
  });

  it("resume sets runtimeSessionId from options", () => {
    const runtime = new AcpRuntime({ name: "claude-code-acp", command: "claude", args: ["--acp"] });
    const session = runtime.resume({
      sessionId: "acp-resume",
      runtimeSessionId: "acp-session-abc",
    });
    expect(session.id).toBe("acp-resume");
    expect(session.runtimeSessionId).toBe("acp-session-abc");
  });

  it("supports custom env in config", () => {
    const runtime = new AcpRuntime({
      name: "custom-acp",
      command: "my-agent",
      args: ["--acp", "--verbose"],
      env: { CUSTOM_KEY: "value" },
    });
    expect(runtime.name).toBe("custom-acp");
    const session = runtime.spawn({
      sessionId: "custom-1",
      prompt: "hello",
      model: "",
      maxTurns: 5,
    });
    expect(session.runtimeName).toBe("custom-acp");
  });
});
