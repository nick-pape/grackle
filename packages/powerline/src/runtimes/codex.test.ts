import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { AgentEvent } from "./runtime.js";

// ─── Mocks ──────────────────────────────────────────────────

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
  readdirSync: vi.fn(() => []),
}));
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => { throw new Error("no git"); }),
  execFile: vi.fn(),
}));
vi.mock("node:util", () => ({
  promisify: vi.fn(() => vi.fn()),
}));
vi.mock("../worktree.js", () => ({
  ensureWorktree: vi.fn(),
}));
vi.mock("../runtime-installer.js", () => ({
  ensureRuntimeInstalled: vi.fn(async () => ""),
  importFromRuntime: vi.fn(async (_runtime: string, pkg: string) => import(pkg)),
  getRuntimeBinDirectory: vi.fn(() => ""),
  isDevMode: vi.fn(() => true),
}));

/** Creates an async iterable from an array of events. */
function asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index < items.length) {
            return { value: items[index++], done: false };
          }
          return { value: undefined as unknown as T, done: true };
        },
      };
    },
  };
}

// Mock the Codex SDK — must be set up before importing the module under test
let mockRunStreamedEvents: Array<Record<string, unknown>> = [];
const mockRunStreamed = vi.fn(async () => ({
  events: asyncIterableFrom(mockRunStreamedEvents),
  abort: vi.fn(),
}));
const mockStartThread = vi.fn(() => ({ runStreamed: mockRunStreamed }));
const mockResumeThread = vi.fn(() => ({ runStreamed: mockRunStreamed }));
const MockCodex = vi.fn(() => ({
  startThread: mockStartThread,
  resumeThread: mockResumeThread,
}));

vi.mock("@openai/codex-sdk", () => ({
  Codex: MockCodex,
}));

import { itemType, CodexRuntime } from "./codex.js";
import { resolveMcpServers } from "./runtime-utils.js";
import { existsSync, readFileSync } from "node:fs";

// ─── Helpers ────────────────────────────────────────────────

/** Collect events from a session stream until it reaches a terminal status (waiting_input or failed). */
async function collectEvents(session: { stream(): AsyncIterable<AgentEvent>; kill(): void }): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of session.stream()) {
    events.push(event);
    if (event.type === "status" && (event.content === "waiting_input" || event.content === "failed")) {
      session.kill();
      break;
    }
  }
  return events;
}

// ─── Tests ──────────────────────────────────────────────────

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

  it("returns undefined servers when no config and no brokerConfig", () => {
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

describe("CodexSession — native system prompt injection", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("GRACKLE_MCP_CONFIG", "");
    vi.mocked(existsSync).mockReturnValue(false);
    MockCodex.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes developer_instructions in config when systemContext is provided", async () => {
    mockRunStreamedEvents = [
      { type: "item.completed", item: { type: "agent_message", text: "done" } },
    ];
    const runtime = new CodexRuntime();
    const session = runtime.spawn({
      sessionId: "cdx-devins",
      prompt: "do work",
      model: "codex-mini",
      maxTurns: 1,
      systemContext: "You are a code reviewer.",
    });
    await collectEvents(session);

    expect(MockCodex).toHaveBeenCalledTimes(1);
    const codexOpts = MockCodex.mock.calls[0][0] as Record<string, unknown>;
    const config = codexOpts.config as Record<string, unknown>;
    expect(config).toBeDefined();
    expect(config.developer_instructions).toBe("You are a code reviewer.");
  });

  it("does not set developer_instructions when systemContext is absent", async () => {
    mockRunStreamedEvents = [
      { type: "item.completed", item: { type: "agent_message", text: "done" } },
    ];
    const runtime = new CodexRuntime();
    const session = runtime.spawn({
      sessionId: "cdx-nodevins",
      prompt: "do work",
      model: "codex-mini",
      maxTurns: 1,
    });
    await collectEvents(session);

    expect(MockCodex).toHaveBeenCalledTimes(1);
    const codexOpts = MockCodex.mock.calls[0][0] as Record<string, unknown>;
    const config = codexOpts.config as Record<string, unknown> | undefined;
    if (config) {
      expect(config.developer_instructions).toBeUndefined();
    }
  });

  it("buildInitialPrompt returns only the prompt (excludes systemContext)", () => {
    const runtime = new CodexRuntime();
    const session = runtime.spawn({
      sessionId: "cdx-prompt-only",
      prompt: "user task",
      model: "codex-mini",
      maxTurns: 0,
      systemContext: "system stuff",
    });
    const result = (session as any).buildInitialPrompt();
    expect(result).toBe("user task");
    expect(result).not.toContain("system stuff");
  });
});

describe("Codex streaming field extraction", () => {
  const runtime = new CodexRuntime();

  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("GRACKLE_MCP_CONFIG", "");
    vi.mocked(existsSync).mockReturnValue(false);
    mockRunStreamedEvents = [];
    MockCodex.mockClear();
    mockStartThread.mockClear();
    mockRunStreamed.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // UT-0: thread.started emits runtime_session_id event
  it("emits runtime_session_id event when thread.started is received", async () => {
    mockRunStreamedEvents = [
      { type: "thread.started", thread_id: "thread-xyz-123" },
      { type: "item.completed", item: { type: "agent_message", text: "done" } },
    ];

    const session = runtime.spawn({ sessionId: "ut0", prompt: "hi", model: "codex-mini", maxTurns: 1 });
    const events = await collectEvents(session);

    const rtIdEvent = events.find((e) => e.type === "runtime_session_id");
    expect(rtIdEvent).toBeDefined();
    expect(rtIdEvent!.content).toBe("thread-xyz-123");
    expect(rtIdEvent!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("emits runtime_session_id only once even on follow-up thread.started", async () => {
    mockRunStreamedEvents = [
      { type: "thread.started", thread_id: "thread-first" },
      { type: "thread.started", thread_id: "thread-second" },
      { type: "item.completed", item: { type: "agent_message", text: "done" } },
    ];

    const session = runtime.spawn({ sessionId: "ut0b", prompt: "hi", model: "codex-mini", maxTurns: 1 });
    const events = await collectEvents(session);

    const rtIdEvents = events.filter((e) => e.type === "runtime_session_id");
    expect(rtIdEvents).toHaveLength(1);
    expect(rtIdEvents[0].content).toBe("thread-first");
  });

  // UT-1: agent_message completed uses item.text (not item.content)
  it("extracts agent_message text from item.text", async () => {
    mockRunStreamedEvents = [
      {
        type: "item.completed",
        item: { type: "agent_message", text: "Hello from Codex!" },
      },
    ];

    const session = runtime.spawn({ sessionId: "ut1", prompt: "hi", model: "codex-mini", maxTurns: 1 });
    const events = await collectEvents(session);

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].content).toBe("Hello from Codex!");
  });

  // UT-2: command_execution completed uses aggregated_output and exit_code
  it("extracts command_execution from aggregated_output and exit_code", async () => {
    mockRunStreamedEvents = [
      {
        type: "item.completed",
        item: { type: "command_execution", aggregated_output: "file list", exit_code: 0 },
      },
    ];

    const session = runtime.spawn({ sessionId: "ut2", prompt: "ls", model: "codex-mini", maxTurns: 1 });
    const events = await collectEvents(session);

    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents).toHaveLength(1);
    expect(resultEvents[0].content).toBe("[exit 0] file list");
  });

  // UT-3: mcp_tool_call started uses item.server and item.tool
  it("extracts mcp_tool_call started from item.server and item.tool", async () => {
    mockRunStreamedEvents = [
      {
        type: "item.started",
        item: { type: "mcp_tool_call", server: "grackle", tool: "post_finding", arguments: { text: "found it" } },
      },
    ];

    const session = runtime.spawn({ sessionId: "ut3", prompt: "find", model: "codex-mini", maxTurns: 1 });
    const events = await collectEvents(session);

    const toolUseEvents = events.filter((e) => e.type === "tool_use");
    expect(toolUseEvents).toHaveLength(1);
    const parsed = JSON.parse(toolUseEvents[0].content);
    expect(parsed.tool).toBe("mcp__grackle__post_finding");
    expect(parsed.args).toEqual({ text: "found it" });
  });

  // UT-4: mcp_tool_call completed extracts result.content and error.message
  it("extracts mcp_tool_call result from result.content object", async () => {
    mockRunStreamedEvents = [
      {
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          server: "grackle",
          tool: "post_finding",
          result: { content: [{ type: "text", text: "Finding posted" }], structured_content: null },
        },
      },
    ];

    const session = runtime.spawn({ sessionId: "ut4a", prompt: "post", model: "codex-mini", maxTurns: 1 });
    const events = await collectEvents(session);

    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents).toHaveLength(1);
    // result.content is serialized as JSON
    const content = JSON.parse(resultEvents[0].content);
    expect(content).toEqual([{ type: "text", text: "Finding posted" }]);
  });

  it("extracts mcp_tool_call error from error.message object", async () => {
    mockRunStreamedEvents = [
      {
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          server: "grackle",
          tool: "post_finding",
          error: { message: "Permission denied" },
        },
      },
    ];

    const session = runtime.spawn({ sessionId: "ut4b", prompt: "post", model: "codex-mini", maxTurns: 1 });
    const events = await collectEvents(session);

    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents).toHaveLength(1);
    expect(resultEvents[0].content).toBe("Permission denied");
  });

  // UT-5: file_change uses item.changes array (not item.file/item.patch)
  it("extracts file_change from item.changes array", async () => {
    const changes = [{ path: "src/index.ts", content: "new content" }];
    mockRunStreamedEvents = [
      {
        type: "item.started",
        item: { type: "file_change", changes },
      },
      {
        type: "item.completed",
        item: { type: "file_change", changes, status: "completed" },
      },
    ];

    const session = runtime.spawn({ sessionId: "ut5", prompt: "edit", model: "codex-mini", maxTurns: 1 });
    const events = await collectEvents(session);

    const toolUseEvents = events.filter((e) => e.type === "tool_use");
    expect(toolUseEvents).toHaveLength(1);
    const startParsed = JSON.parse(toolUseEvents[0].content);
    expect(startParsed.args.file).toBe("src/index.ts");
    expect(startParsed.args.changes).toEqual(changes);

    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents).toHaveLength(1);
    const resultParsed = JSON.parse(resultEvents[0].content);
    expect(resultParsed.file).toBe("src/index.ts");
    expect(resultParsed.changes).toEqual(changes);
    expect(resultParsed.status).toBe("completed");
  });

  // UT-6: reasoning completed uses item.text only (no item.summary)
  it("extracts reasoning from item.text only", async () => {
    mockRunStreamedEvents = [
      {
        type: "item.completed",
        item: { type: "reasoning", text: "Thinking about the problem..." },
      },
    ];

    const session = runtime.spawn({ sessionId: "ut6", prompt: "think", model: "codex-mini", maxTurns: 1 });
    const events = await collectEvents(session);

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].content).toBe("[reasoning] Thinking about the problem...");
  });

  // MCP config transformation: verify Codex receives snake_case config
  it("transforms HTTP MCP config to Codex format (mcp_servers, http_headers, no type)", async () => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "/tmp/mcp.json");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        mcpServers: {
          grackle: {
            type: "http",
            url: "http://localhost:7435/mcp",
            headers: { Authorization: "Bearer tok123" },
            tools: ["*"],
          },
        },
      }),
    );

    mockRunStreamedEvents = [
      { type: "item.completed", item: { type: "agent_message", text: "done" } },
    ];

    const session = runtime.spawn({ sessionId: "mcp-cfg", prompt: "test", model: "codex-mini", maxTurns: 1 });
    await collectEvents(session);

    // Inspect the config passed to the Codex constructor
    expect(MockCodex).toHaveBeenCalledTimes(1);
    const codexOpts = MockCodex.mock.calls[0][0] as Record<string, unknown>;
    const config = codexOpts.config as Record<string, unknown>;
    expect(config).toBeDefined();

    // Key should be mcp_servers (snake_case), not mcpServers
    expect(config.mcp_servers).toBeDefined();
    expect(config.mcpServers).toBeUndefined();

    // Server entry should use http_headers (not headers) and have no type field
    const grackle = (config.mcp_servers as Record<string, unknown>).grackle as Record<string, unknown>;
    expect(grackle.url).toBe("http://localhost:7435/mcp");
    expect(grackle.http_headers).toEqual({ Authorization: "Bearer tok123" });
    expect(grackle.type).toBeUndefined();
    expect(grackle.headers).toBeUndefined();
    expect(grackle.tools).toBeUndefined();
  });

  // Stdio MCP servers are passed through unchanged
  it("passes stdio MCP servers through unchanged", async () => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "/tmp/mcp.json");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        mcpServers: {
          myStdio: { command: "node", args: ["server.js"], env: { FOO: "bar" } },
        },
      }),
    );

    mockRunStreamedEvents = [
      { type: "item.completed", item: { type: "agent_message", text: "ok" } },
    ];

    const session = runtime.spawn({ sessionId: "mcp-stdio", prompt: "test", model: "codex-mini", maxTurns: 1 });
    await collectEvents(session);

    const codexOpts = MockCodex.mock.calls[0][0] as Record<string, unknown>;
    const config = codexOpts.config as Record<string, unknown>;
    const myStdio = (config.mcp_servers as Record<string, unknown>).myStdio as Record<string, unknown>;
    expect(myStdio.command).toBe("node");
    expect(myStdio.args).toEqual(["server.js"]);
    expect(myStdio.env).toEqual({ FOO: "bar" });
  });

  it("passes skipGitRepoCheck: true to startThread (#535)", async () => {
    mockRunStreamedEvents = [
      { type: "item.completed", item: { type: "agent_message", text: "done" } },
    ];

    const session = runtime.spawn({ sessionId: "cdx-skip-git", prompt: "test", model: "codex-mini", maxTurns: 1 });
    await collectEvents(session);

    expect(mockStartThread).toHaveBeenCalledTimes(1);
    const threadOpts = mockStartThread.mock.calls[0][0] as Record<string, unknown>;
    expect(threadOpts.skipGitRepoCheck).toBe(true);
    expect(threadOpts.sandboxMode).toBe("workspace-write");
    expect(threadOpts.approvalPolicy).toBe("never");
  });

  it("emits usage event from turn.completed with cached tokens", async () => {
    mockRunStreamedEvents = [
      { type: "thread.started", thread_id: "t1" },
      { type: "turn.completed", usage: { input_tokens: 500, cached_input_tokens: 200, output_tokens: 30 } },
    ];

    const runtime = new CodexRuntime();
    const session = runtime.spawn({ sessionId: "codex-usage", prompt: "hi", model: "o3-mini", maxTurns: 1 });
    const events = await collectEvents(session);

    const usageEvents = events.filter((e) => e.type === "usage");
    expect(usageEvents).toHaveLength(1);
    const data = JSON.parse(usageEvents[0].content) as Record<string, number>;
    expect(data.input_tokens).toBe(700); // 500 + 200 cached
    expect(data.output_tokens).toBe(30);
    expect(data.cost_usd).toBe(0); // Codex SDK doesn't provide USD cost
  });
});
