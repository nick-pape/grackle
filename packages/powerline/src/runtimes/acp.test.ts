import { describe, it, expect, vi, afterEach } from "vitest";
import type { AgentEvent } from "./runtime.js";

// Mock dependencies before importing
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
  readdirSync: vi.fn(() => []),
}));

import { mapSessionUpdate, autoApprovePermission, selectEnvVarAuthMethod, AcpRuntime } from "./acp.js";
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

// ─── selectEnvVarAuthMethod ─────────────────────────────────

describe("selectEnvVarAuthMethod", () => {
  it("returns methodId when required env var is set", () => {
    const methods = [
      { id: "GithubToken", type: "env_var", vars: [{ name: "GITHUB_TOKEN" }] },
    ];
    expect(selectEnvVarAuthMethod(methods, { GITHUB_TOKEN: "ghp_test" })).toBe("GithubToken");
  });

  it("returns undefined when required env var is missing", () => {
    const methods = [
      { id: "GithubToken", type: "env_var", vars: [{ name: "GITHUB_TOKEN" }] },
    ];
    expect(selectEnvVarAuthMethod(methods, {})).toBeUndefined();
  });

  it("skips non-env_var methods", () => {
    const methods = [
      { id: "claude-login", type: "terminal" },
      { id: "gateway" },
    ];
    expect(selectEnvVarAuthMethod(methods, { ANTHROPIC_API_KEY: "sk-test" })).toBeUndefined();
  });

  it("picks the first method whose vars are all set", () => {
    const methods = [
      { id: "A", type: "env_var", vars: [{ name: "MISSING_VAR" }] },
      { id: "B", type: "env_var", vars: [{ name: "GITHUB_TOKEN" }] },
    ];
    expect(selectEnvVarAuthMethod(methods, { GITHUB_TOKEN: "ghp_test" })).toBe("B");
  });

  it("returns undefined for empty methods", () => {
    expect(selectEnvVarAuthMethod([], { GITHUB_TOKEN: "ghp_test" })).toBeUndefined();
  });

  it("treats optional vars as satisfied when missing", () => {
    const methods = [
      { id: "M", type: "env_var", vars: [{ name: "REQUIRED" }, { name: "OPTIONAL", optional: true }] },
    ];
    expect(selectEnvVarAuthMethod(methods, { REQUIRED: "val" })).toBe("M");
  });
});

// ─── convertMcpServers ──────────────────────────────────────

describe("convertMcpServers", () => {
  it("converts stdio servers to ACP format with array env", () => {
    const servers = {
      grackle: { command: "node", args: ["mcp.js"], env: { FOO: "bar" } },
    };
    const result = convertMcpServers(servers);
    expect(result).toEqual([{
      name: "grackle",
      type: "stdio",
      command: "node",
      args: ["mcp.js"],
      env: [{ name: "FOO", value: "bar" }],
    }]);
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
    expect(result[0].type).toBe("stdio");
    expect(result[1].type).toBe("stdio");
  });

  it("returns empty array for undefined input", () => {
    expect(convertMcpServers(undefined)).toEqual([]);
  });

  it("returns empty array for empty object", () => {
    expect(convertMcpServers({})).toEqual([]);
  });

  it("defaults args and env to empty arrays for stdio", () => {
    const servers = { myServer: { command: "node" } };
    const result = convertMcpServers(servers);
    expect(result[0].args).toEqual([]);
    expect(result[0].env).toEqual([]);
  });

  it("converts HTTP headers object to array of {name, value}", () => {
    const servers = {
      grackle: {
        type: "http",
        url: "http://localhost:7435/mcp",
        headers: { Authorization: "Bearer tok123" },
      },
    };
    const result = convertMcpServers(servers);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("http");
    expect(result[0].url).toBe("http://localhost:7435/mcp");
    expect(result[0].name).toBe("grackle");
    expect(result[0].headers).toEqual([{ name: "Authorization", value: "Bearer tok123" }]);
  });

  it("detects HTTP transport from url field without explicit type", () => {
    const servers = {
      remote: { url: "http://example.com/mcp" },
    };
    const result = convertMcpServers(servers);
    expect(result[0].type).toBe("http");
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
    expect(result[0].type).toBe("stdio");
    expect(result[1].type).toBe("http");
  });

  it("passes through env/headers that are already arrays", () => {
    const servers = {
      s: { command: "x", args: [], env: [{ name: "A", value: "1" }] },
    };
    const result = convertMcpServers(servers);
    expect(result[0].env).toEqual([{ name: "A", value: "1" }]);
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

describe("AcpRuntime — runtime_session_id emission", () => {
  // Note: getAcpSdk() uses a lazy dynamic import that vitest cannot intercept for
  // pure-ESM packages + child-process spawning. Tests use vi.spyOn on setupSdk()
  // at the instance level to inject mock state and verify event propagation.

  const config = { name: "test-acp", command: "echo", args: ["--acp"] };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits runtime_session_id for a new session with the ACP-assigned session ID", async () => {
    const runtime = new AcpRuntime(config);
    const session = runtime.spawn({ sessionId: "acp-new", prompt: "hi", model: "test", maxTurns: 0 });

    vi.spyOn(session as any, "setupSdk").mockImplementation(async function(this: unknown) {
      const ts = () => new Date().toISOString();
      // Simulate the new-session path: connection.newSession() returns an ID
      (this as any).acpSessionId = "acp-session-new-123";
      (this as any).runtimeSessionId = "acp-session-new-123";
      (this as any).eventQueue.push({ type: "runtime_session_id", timestamp: ts(), content: (this as any).runtimeSessionId });
      // Set a minimal connection so runInitialQuery() and kill() don't throw
      (this as any).connection = { prompt: async () => {}, cancel: async () => {} };
    });

    const events: AgentEvent[] = [];
    for await (const event of session.stream()) {
      events.push(event);
      if (event.type === "status" && event.content === "waiting_input") { session.kill(); break; }
      if (event.type === "status" && event.content === "failed") break;
    }

    const rtIdEvent = events.find((e) => e.type === "runtime_session_id");
    expect(rtIdEvent, "Expected runtime_session_id event in stream").toBeDefined();
    expect(rtIdEvent!.content).toBe("acp-session-new-123");
    expect(rtIdEvent!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("emits runtime_session_id for a resumed session with the resume session ID", async () => {
    const runtime = new AcpRuntime(config);
    const session = runtime.resume({ sessionId: "acp-resumed", runtimeSessionId: "acp-old-session-456" });

    vi.spyOn(session as any, "setupSdk").mockImplementation(async function(this: unknown) {
      const ts = () => new Date().toISOString();
      // Simulate the resume path: acpSessionId = resumeSessionId
      (this as any).acpSessionId = (this as any).resumeSessionId;
      (this as any).runtimeSessionId = (this as any).resumeSessionId;
      (this as any).eventQueue.push({ type: "runtime_session_id", timestamp: ts(), content: (this as any).runtimeSessionId });
    });

    const events: AgentEvent[] = [];
    for await (const event of session.stream()) {
      events.push(event);
      if (event.type === "status" && event.content === "waiting_input") { session.kill(); break; }
      if (event.type === "status" && event.content === "failed") break;
    }

    const rtIdEvent = events.find((e) => e.type === "runtime_session_id");
    expect(rtIdEvent, "Expected runtime_session_id event in stream").toBeDefined();
    expect(rtIdEvent!.content).toBe("acp-old-session-456");
  });
});
