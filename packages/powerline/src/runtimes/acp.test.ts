import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  const { PassThrough } = await import("node:stream");
  return {
    ...original,
    spawn: vi.fn(() => ({
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      pid: 12345,
      on: vi.fn(),
      kill: vi.fn(),
    })),
  };
});
vi.mock("./runtime-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./runtime-utils.js")>();
  return { ...original, resolveWorkingDirectory: vi.fn(async () => undefined) };
});
vi.mock("../runtime-installer.js", () => ({
  ensureRuntimeInstalled: vi.fn(async () => ""),
  importFromRuntime: vi.fn(async (_runtime: string, pkg: string) => import(pkg)),
  getRuntimeBinDirectory: vi.fn(() => ""),
  isDevMode: vi.fn(() => true),
}));

import { mapSessionUpdate, autoApprovePermission, selectEnvVarAuthMethod, AcpRuntime, _setAcpSdkForTesting } from "./acp.js";
import type { AcpSdkModule } from "./acp.js";
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
    expect(mapSessionUpdate({ sessionUpdate: "config_option_update" })).toHaveLength(0);
    expect(mapSessionUpdate({ sessionUpdate: "session_info_update" })).toHaveLength(0);
  });

  it("maps usage_update with USD cost to a usage event", () => {
    const events = mapSessionUpdate({
      sessionUpdate: "usage_update",
      used: 5000,
      size: 128000,
      cost: { amount: 0.05, currency: "USD" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("usage");
    const data = JSON.parse(events[0].content) as Record<string, number>;
    expect(data.cost_usd).toBe(0.05);
    expect(data.input_tokens).toBe(0);
    expect(data.output_tokens).toBe(0);
  });

  it("skips usage_update with non-USD currency", () => {
    const events = mapSessionUpdate({
      sessionUpdate: "usage_update",
      used: 5000,
      size: 128000,
      cost: { amount: 100, currency: "JPY" },
    });
    expect(events).toHaveLength(0);
  });

  it("skips usage_update with no cost", () => {
    const events = mapSessionUpdate({
      sessionUpdate: "usage_update",
      used: 5000,
      size: 128000,
    });
    expect(events).toHaveLength(0);
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

describe("AcpRuntime — system prompt via prompt prepend (no native SDK injection)", () => {
  it("buildInitialPrompt prepends systemContext to the prompt (default base class behavior)", () => {
    const runtime = new AcpRuntime({ name: "test-acp", command: "echo", args: ["--acp"] });
    const session = runtime.spawn({
      sessionId: "acp-sysprompt",
      prompt: "user task",
      model: "test",
      maxTurns: 0,
      systemContext: "system instructions",
    });
    const result = (session as any).buildInitialPrompt();
    expect(result).toContain("system instructions");
    expect(result).toContain("user task");
    expect(result.indexOf("system instructions")).toBeLessThan(result.indexOf("user task"));
  });

  it("buildInitialPrompt returns just the prompt when no systemContext", () => {
    const runtime = new AcpRuntime({ name: "test-acp", command: "echo", args: ["--acp"] });
    const session = runtime.spawn({
      sessionId: "acp-no-ctx",
      prompt: "just the prompt",
      model: "test",
      maxTurns: 0,
    });
    const result = (session as any).buildInitialPrompt();
    expect(result).toBe("just the prompt");
  });
});

describe("AcpRuntime — runtime_session_id emission", () => {
  // Uses the @internal _setAcpSdkForTesting hook to inject a mock SDK and
  // exercise the real setupSdk() code path end-to-end.

  const config = { name: "test-acp", command: "echo", args: ["--acp"] };

  beforeEach(() => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "");

    const mockSdk: AcpSdkModule = {
      ndJsonStream: vi.fn(() => ({})),
      PROTOCOL_VERSION: 1,
      ClientSideConnection: vi.fn(() => ({
        initialize: vi.fn(async () => ({ authMethods: [] })),
        newSession: vi.fn(async () => ({ sessionId: "acp-test-session-xyz" })),
        prompt: vi.fn(async () => {}),
        cancel: vi.fn(async () => {}),
      })) as unknown as AcpSdkModule["ClientSideConnection"],
    };

    _setAcpSdkForTesting(mockSdk);
  });

  afterEach(() => {
    _setAcpSdkForTesting(undefined);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("real setupSdk() emits runtime_session_id event with the ACP-assigned session ID", async () => {
    const runtime = new AcpRuntime(config);
    const session = runtime.spawn({ sessionId: "acp-new", prompt: "hi", model: "test", maxTurns: 1 });

    const events: AgentEvent[] = [];
    for await (const event of session.stream()) {
      events.push(event);
      if (event.type === "status" && event.content === "waiting_input") { session.kill(); break; }
      if (event.type === "status" && event.content === "failed") break;
    }

    const rtIdEvent = events.find((e) => e.type === "runtime_session_id");
    expect(rtIdEvent, `Expected runtime_session_id event. Got: ${JSON.stringify(events.map(e => e.type))}`).toBeDefined();
    expect(rtIdEvent!.content).toBe("acp-test-session-xyz");
    expect(rtIdEvent!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("real setupSdk() emits runtime_session_id for a resumed session with the resume ID", async () => {
    const runtime = new AcpRuntime(config);
    const session = runtime.resume({ sessionId: "acp-resumed", runtimeSessionId: "acp-old-session-456" });

    const events: AgentEvent[] = [];
    for await (const event of session.stream()) {
      events.push(event);
      if (event.type === "status" && event.content === "waiting_input") { session.kill(); break; }
      if (event.type === "status" && event.content === "failed") break;
    }

    const rtIdEvent = events.find((e) => e.type === "runtime_session_id");
    expect(rtIdEvent, `Expected runtime_session_id event. Got: ${JSON.stringify(events.map(e => e.type))}`).toBeDefined();
    expect(rtIdEvent!.content).toBe("acp-old-session-456");
  });
});

// ─── Multi-turn integration tests ──────────────────────────

/** Drain events from a stream iterator until a status event with the given content. */
async function drainUntilStatus(
  nextEvent: () => Promise<AgentEvent | undefined>,
  statusContent: string,
): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = [];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- loop until match
  while (true) {
    const event = await nextEvent();
    if (!event) {
      throw new Error(`Stream ended before status "${statusContent}"`);
    }
    collected.push(event);
    if (event.type === "status" && event.content === statusContent) {
      return collected;
    }
  }
}

describe("AcpRuntime — multi-turn", () => {
  const acpConfig = { name: "test-acp", command: "echo", args: ["--acp"] };
  let capturedHandlerFactory: (() => { sessionUpdate: (params: Record<string, unknown>) => void }) | undefined;
  let promptCallCount: number;
  let mockConnection: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "");
    capturedHandlerFactory = undefined;
    promptCallCount = 0;

    mockConnection = {
      initialize: vi.fn(async () => ({ authMethods: [] })),
      newSession: vi.fn(async () => ({ sessionId: "acp-mt-session" })),
      prompt: vi.fn(async () => {
        promptCallCount++;
        const turn = promptCallCount;
        // Invoke the captured handler factory to get the sessionUpdate callback,
        // then fire events for this turn.
        const handler = capturedHandlerFactory!();
        handler.sessionUpdate({
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `turn${turn} response` },
          },
        });
      }),
      cancel: vi.fn(async () => {}),
    };

    const mockSdk: AcpSdkModule = {
      ndJsonStream: vi.fn(() => ({})),
      PROTOCOL_VERSION: 1,
      ClientSideConnection: vi.fn((handlerFactory: () => Record<string, unknown>) => {
        capturedHandlerFactory = handlerFactory as typeof capturedHandlerFactory;
        return mockConnection;
      }) as unknown as AcpSdkModule["ClientSideConnection"],
    };

    _setAcpSdkForTesting(mockSdk);
  });

  afterEach(() => {
    _setAcpSdkForTesting(undefined);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** Spawn a session and return an iterator-based event consumer. */
  function spawnSession(prompt: string = "hello") {
    const runtime = new AcpRuntime(acpConfig);
    const session = runtime.spawn({
      sessionId: "acp-mt",
      prompt,
      model: "test",
      maxTurns: 0,
    });
    const streamIterator = session.stream()[Symbol.asyncIterator]();
    const nextEvent = async (): Promise<AgentEvent | undefined> => {
      const result = await streamIterator.next();
      return result.done ? undefined : result.value;
    };
    return { session, nextEvent };
  }

  it("follow-up events appear in stream after sendInput", async () => {
    const { session, nextEvent } = spawnSession();

    // Drain initial turn
    const turn1Events = await drainUntilStatus(nextEvent, "waiting_input");
    expect(turn1Events.some((e) => e.type === "text" && e.content === "turn1 response")).toBe(true);

    // Send follow-up
    session.sendInput("follow-up");
    await drainUntilStatus(nextEvent, "running");
    const turn2Events = await drainUntilStatus(nextEvent, "waiting_input");
    expect(turn2Events.some((e) => e.type === "text" && e.content === "turn2 response")).toBe(true);

    session.kill();
  });

  it("connection is reused across turns (newSession once, prompt per turn)", async () => {
    const { session, nextEvent } = spawnSession();
    await drainUntilStatus(nextEvent, "waiting_input");

    session.sendInput("second turn");
    await drainUntilStatus(nextEvent, "running");
    await drainUntilStatus(nextEvent, "waiting_input");

    expect(mockConnection.newSession).toHaveBeenCalledTimes(1);
    expect(promptCallCount).toBe(2); // once per turn

    session.kill();
  });

  it("tool events in follow-up turn", async () => {
    // Override prompt to fire tool events on the second call
    let localCallCount = 0;
    mockConnection.prompt.mockImplementation(async () => {
      localCallCount++;
      const handler = capturedHandlerFactory!();
      if (localCallCount === 1) {
        handler.sessionUpdate({
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "initial" } },
        });
      } else {
        handler.sessionUpdate({
          update: { sessionUpdate: "tool_call", toolCallId: "tc-mt", title: "read_file", status: "pending", rawInput: { path: "/tmp/test" } },
        });
        handler.sessionUpdate({
          update: { sessionUpdate: "tool_call_update", toolCallId: "tc-mt", status: "completed", rawOutput: { result: "file contents" } },
        });
      }
    });

    const { session, nextEvent } = spawnSession();
    await drainUntilStatus(nextEvent, "waiting_input");

    session.sendInput("read that file");
    await drainUntilStatus(nextEvent, "running");
    const turn2Events = await drainUntilStatus(nextEvent, "waiting_input");

    expect(turn2Events.some((e) => e.type === "tool_use")).toBe(true);
    expect(turn2Events.some((e) => e.type === "tool_result")).toBe(true);

    const toolUse = turn2Events.find((e) => e.type === "tool_use")!;
    const parsed = JSON.parse(toolUse.content);
    expect(parsed.tool).toBe("read_file");
    expect(parsed.args).toEqual({ path: "/tmp/test" });

    session.kill();
  });
});
