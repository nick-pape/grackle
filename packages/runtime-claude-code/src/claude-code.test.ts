import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentEvent } from "@grackle-ai/runtime-sdk";

// Mock the logger before importing the module under test
vi.mock("@grackle-ai/runtime-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@grackle-ai/runtime-sdk")>();
  return {
    ...original,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    resolveWorkingDirectory: vi.fn(async () => "/workspace/repo"),
    ensureRuntimeInstalled: vi.fn(async () => ""),
    importFromRuntime: vi.fn(async (_runtime: string, pkg: string) => import(pkg)),
    getRuntimeBinDirectory: vi.fn(() => ""),
    isDevMode: vi.fn(() => true),
  };
});

// Mock the Claude Agent SDK so tests run without a real API key
const mockQuery = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: mockQuery,
}));

import { mapMessage, ClaudeCodeRuntime } from "./claude-code.js";

describe("mapMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:00.000Z"));
  });

  describe("assistant messages", () => {
    it("maps a text block to a text event", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello world" }],
        },
      };
      const events = mapMessage(msg);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("text");
      expect(events[0].content).toBe("Hello world");
      expect(events[0].raw).toEqual({ type: "text", text: "Hello world" });
    });

    it("maps a tool_use block to a tool_use event with JSON content", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", name: "read_file", input: { path: "/tmp/test" } },
          ],
        },
      };
      const events = mapMessage(msg);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("tool_use");
      const parsed = JSON.parse(events[0].content);
      expect(parsed.tool).toBe("read_file");
      expect(parsed.args).toEqual({ path: "/tmp/test" });
    });

    it("maps a tool_result block to a tool_result event", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_result", content: "file contents here" }],
        },
      };
      const events = mapMessage(msg);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("tool_result");
      expect(events[0].content).toBe("file contents here");
    });

    it("maps tool_result with non-string content to JSON", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_result", content: { key: "value" } }],
        },
      };
      const events = mapMessage(msg);
      expect(events).toHaveLength(1);
      expect(events[0].content).toBe('{"key":"value"}');
    });

    it("preserves order of mixed blocks", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "first" },
            { type: "tool_use", name: "bash", input: { cmd: "ls" } },
            { type: "tool_result", content: "output" },
            { type: "text", text: "last" },
          ],
        },
      };
      const events = mapMessage(msg);
      expect(events).toHaveLength(4);
      expect(events.map((e) => e.type)).toEqual(["text", "tool_use", "tool_result", "text"]);
    });

    it("returns empty array for empty content", () => {
      const msg = {
        type: "assistant",
        message: { role: "assistant", content: [] },
      };
      expect(mapMessage(msg)).toEqual([]);
    });

    it("returns empty array for non-array content", () => {
      const msg = {
        type: "assistant",
        message: { role: "assistant", content: "just a string" },
      };
      expect(mapMessage(msg)).toEqual([]);
    });

    it("returns empty array when message is missing", () => {
      const msg = { type: "assistant" };
      expect(mapMessage(msg)).toEqual([]);
    });
  });

  describe("finding/subtask tool calls (no longer intercepted — handled by MCP broker)", () => {
    it("does not emit finding event for post_finding tool call", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "post_finding",
              input: { title: "Bug Found", content: "There is a bug here" },
            },
          ],
        },
      };
      const events = mapMessage(msg);
      expect(events).toHaveLength(1); // only tool_use, no finding event
      expect(events[0].type).toBe("tool_use");
    });

  });

  describe("system messages", () => {
    it("init subtype produces system event with model", () => {
      const msg = { type: "system", subtype: "init", model: "claude-3" };
      const events = mapMessage(msg);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("system");
      expect(events[0].content).toBe("Session initialized (claude-3)");
    });

    it("init subtype uses 'unknown model' when model is missing", () => {
      const msg = { type: "system", subtype: "init" };
      const events = mapMessage(msg);
      expect(events[0].content).toBe("Session initialized (unknown model)");
    });

    it("non-init subtype returns empty array", () => {
      const msg = { type: "system", subtype: "other" };
      expect(mapMessage(msg)).toEqual([]);
    });
  });

  describe("result and unknown messages", () => {
    it("result type returns empty array", () => {
      const msg = { type: "result", result: "done" };
      expect(mapMessage(msg)).toEqual([]);
    });

    it("unknown type returns empty array", () => {
      const msg = { type: "something_else" };
      expect(mapMessage(msg)).toEqual([]);
    });

    it("missing type returns empty array", () => {
      const msg = {};
      expect(mapMessage(msg)).toEqual([]);
    });
  });

  describe("timestamps", () => {
    it("all events have ISO timestamp", () => {
      const msg = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "hello" },
            { type: "tool_use", name: "t", input: {} },
          ],
        },
      };
      const events = mapMessage(msg);
      for (const event of events) {
        expect(event.timestamp).toBe("2025-01-15T12:00:00.000Z");
      }
    });
  });
});

describe("ClaudeCodeRuntime structural", () => {
  // Can't test full stream() without the SDK, but verify basic structure
  it("has name 'claude-code'", async () => {
    const { ClaudeCodeRuntime } = await import("./claude-code.js");
    const runtime = new ClaudeCodeRuntime();
    expect(runtime.name).toBe("claude-code");
  });

  it("spawn returns a session with correct properties", async () => {
    const { ClaudeCodeRuntime } = await import("./claude-code.js");
    const runtime = new ClaudeCodeRuntime();
    const session = runtime.spawn({
      sessionId: "cc-1",
      prompt: "test",
      model: "claude-3",
      maxTurns: 10,
    });
    expect(session.id).toBe("cc-1");
    expect(session.runtimeName).toBe("claude-code");
    expect(session.status).toBe("running");
  });

  it("resume sets runtimeSessionId from options", async () => {
    const { ClaudeCodeRuntime } = await import("./claude-code.js");
    const runtime = new ClaudeCodeRuntime();
    const session = runtime.resume({
      sessionId: "cc-resume",
      runtimeSessionId: "prev-session-123",
    });
    expect(session.id).toBe("cc-resume");
    expect(session.runtimeSessionId).toBe("prev-session-123");
  });

  it("setupSdk includes Agent and Task in allowedTools", async () => {
    const { ClaudeCodeRuntime } = await import("./claude-code.js");
    const runtime = new ClaudeCodeRuntime();
    const session = runtime.spawn({
      sessionId: "cc-allowed-tools",
      prompt: "test",
      model: "claude-3",
      maxTurns: 0,
    });
    await (session as any).setupSdk();
    const opts = (session as any).cachedSdkOptions;
    const tools = opts.allowedTools as string[];
    expect(tools).toContain("Agent");
    expect(tools).toContain("Task");
  });

  it("setupSdk includes settingSources with 'project'", async () => {
    const { ClaudeCodeRuntime } = await import("./claude-code.js");
    const runtime = new ClaudeCodeRuntime();
    const session = runtime.spawn({
      sessionId: "cc-settings",
      prompt: "test",
      model: "claude-3",
      maxTurns: 0,
    });
    await (session as any).setupSdk();
    const opts = (session as any).cachedSdkOptions;
    expect(opts.settingSources).toEqual(["project"]);
  });

  it("setupSdk sets systemPrompt when systemContext is provided", async () => {
    const { ClaudeCodeRuntime } = await import("./claude-code.js");
    const runtime = new ClaudeCodeRuntime();
    const session = runtime.spawn({
      sessionId: "cc-sysprompt",
      prompt: "do something",
      model: "claude-3",
      maxTurns: 0,
      systemContext: "You are a helpful assistant.",
    });
    await (session as any).setupSdk();
    const opts = (session as any).cachedSdkOptions;
    expect(opts.systemPrompt).toEqual({ preset: "claude_code", append: "You are a helpful assistant." });
  });

  it("setupSdk omits systemPrompt when systemContext is not provided", async () => {
    const { ClaudeCodeRuntime } = await import("./claude-code.js");
    const runtime = new ClaudeCodeRuntime();
    const session = runtime.spawn({
      sessionId: "cc-no-sysprompt",
      prompt: "do something",
      model: "claude-3",
      maxTurns: 0,
    });
    await (session as any).setupSdk();
    const opts = (session as any).cachedSdkOptions;
    expect(opts.systemPrompt).toBeUndefined();
  });

  it("buildInitialPrompt returns only the prompt (excludes systemContext)", async () => {
    const { ClaudeCodeRuntime } = await import("./claude-code.js");
    const runtime = new ClaudeCodeRuntime();
    const session = runtime.spawn({
      sessionId: "cc-prompt-only",
      prompt: "user task here",
      model: "claude-3",
      maxTurns: 0,
      systemContext: "system instructions that should not appear in prompt",
    });
    const result = (session as any).buildInitialPrompt();
    expect(result).toBe("user task here");
    expect(result).not.toContain("system instructions");
  });

  it("setupSdk preserves caller-provided hooks alongside settingSources", async () => {
    const { ClaudeCodeRuntime } = await import("./claude-code.js");
    const runtime = new ClaudeCodeRuntime();
    const hooks = { Stop: [{ matcher: "", hooks: [{ type: "command", command: "echo hi" }] }] };
    const session = runtime.spawn({
      sessionId: "cc-hooks",
      prompt: "test",
      model: "claude-3",
      maxTurns: 0,
      hooks,
    });
    await (session as any).setupSdk();
    const opts = (session as any).cachedSdkOptions;
    expect(opts.settingSources).toEqual(["project"]);
    expect(opts.hooks).toEqual(hooks);
  });
});

// ─── Helpers ─────────────────────────────────────────────────

/** Create an async iterable from an array of objects. */
function asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < items.length) return { value: items[i++], done: false };
          return { value: undefined as unknown as T, done: true };
        },
      };
    },
  };
}

/** Collect events from a session stream, stopping after the first waiting_input. */
async function collectUntilIdle(session: { stream(): AsyncIterable<AgentEvent>; kill(): void }): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of session.stream()) {
    events.push(event);
    if (event.type === "status" && event.content === "waiting_input") {
      session.kill();
      break;
    }
    // Also stop on error to avoid hanging tests
    if (event.type === "status" && event.content === "failed") {
      break;
    }
  }
  return events;
}

describe("ClaudeCodeRuntime — runtime_session_id emission", () => {
  beforeEach(() => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "");
    mockQuery.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits runtime_session_id event when SDK returns a system message with session_id", async () => {
    // The SDK returns a system/init message with session_id, followed by an assistant message
    mockQuery.mockReturnValue(asyncIterableFrom([
      { type: "system", subtype: "init", session_id: "sdk-session-abc", model: "claude-sonnet-4" },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Hello" }] } },
    ]));

    const runtime = new ClaudeCodeRuntime();
    const session = runtime.spawn({ sessionId: "cc-emit-test", prompt: "hi", model: "claude-sonnet-4", maxTurns: 1 });
    const events = await collectUntilIdle(session);

    const rtIdEvent = events.find((e) => e.type === "runtime_session_id");
    expect(rtIdEvent, "Expected runtime_session_id event").toBeDefined();
    expect(rtIdEvent!.content).toBe("sdk-session-abc");
    expect(rtIdEvent!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("emits runtime_session_id only once even if SDK sends multiple system messages", async () => {
    mockQuery.mockReturnValue(asyncIterableFrom([
      { type: "system", subtype: "init", session_id: "sdk-session-first", model: "claude-sonnet-4" },
      { type: "system", subtype: "init", session_id: "sdk-session-second", model: "claude-sonnet-4" },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Hi" }] } },
    ]));

    const runtime = new ClaudeCodeRuntime();
    const session = runtime.spawn({ sessionId: "cc-once-test", prompt: "hi", model: "claude-sonnet-4", maxTurns: 1 });
    const events = await collectUntilIdle(session);

    const rtIdEvents = events.filter((e) => e.type === "runtime_session_id");
    expect(rtIdEvents).toHaveLength(1);
    expect(rtIdEvents[0].content).toBe("sdk-session-first");
  });
});

describe("ClaudeCodeRuntime — usage event emission", () => {
  beforeEach(() => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "");
    mockQuery.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits usage event from result message with token counts and cost", async () => {
    mockQuery.mockReturnValue(asyncIterableFrom([
      { type: "system", subtype: "init", session_id: "sdk-usage-test", model: "claude-sonnet-4" },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Hello" }] } },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Hello",
        total_cost_usd: 0.005916,
        usage: { input_tokens: 1952, output_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    ]));

    const runtime = new ClaudeCodeRuntime();
    const session = runtime.spawn({ sessionId: "cc-usage-test", prompt: "hi", model: "claude-sonnet-4", maxTurns: 1 });
    const events = await collectUntilIdle(session);

    const usageEvents = events.filter((e) => e.type === "usage");
    expect(usageEvents).toHaveLength(1);
    const data = JSON.parse(usageEvents[0].content) as Record<string, number>;
    expect(data.input_tokens).toBe(1952);
    expect(data.output_tokens).toBe(4);
    expect(data.cost_usd).toBe(0.005916);
  });

  it("includes cache tokens in total input count", async () => {
    mockQuery.mockReturnValue(asyncIterableFrom([
      { type: "system", subtype: "init", session_id: "sdk-cache-test", model: "claude-sonnet-4" },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "hello",
        total_cost_usd: 0.048,
        usage: { input_tokens: 3, output_tokens: 4, cache_creation_input_tokens: 5000, cache_read_input_tokens: 10000 },
      },
    ]));

    const runtime = new ClaudeCodeRuntime();
    const session = runtime.spawn({ sessionId: "cc-cache-test", prompt: "hi", model: "claude-sonnet-4", maxTurns: 1 });
    const events = await collectUntilIdle(session);

    const usageEvents = events.filter((e) => e.type === "usage");
    expect(usageEvents).toHaveLength(1);
    const data = JSON.parse(usageEvents[0].content) as Record<string, number>;
    // Total input = 3 (non-cached) + 5000 (cache creation) + 10000 (cache read)
    expect(data.input_tokens).toBe(15003);
    expect(data.output_tokens).toBe(4);
    expect(data.cost_usd).toBe(0.048);
  });

  it("does not emit usage event for error results", async () => {
    mockQuery.mockReturnValue(asyncIterableFrom([
      { type: "system", subtype: "init", session_id: "sdk-err-test", model: "claude-sonnet-4" },
      { type: "result", is_error: true, result: "Invalid API key" },
    ]));

    const runtime = new ClaudeCodeRuntime();
    const session = runtime.spawn({ sessionId: "cc-err-usage", prompt: "hi", model: "claude-sonnet-4", maxTurns: 1 });
    const events = await collectUntilIdle(session);

    const usageEvents = events.filter((e) => e.type === "usage");
    expect(usageEvents).toHaveLength(0);
  });

  it("handles result message without usage field gracefully", async () => {
    mockQuery.mockReturnValue(asyncIterableFrom([
      { type: "system", subtype: "init", session_id: "sdk-no-usage", model: "claude-sonnet-4" },
      { type: "result", subtype: "success", is_error: false, result: "done" },
    ]));

    const runtime = new ClaudeCodeRuntime();
    const session = runtime.spawn({ sessionId: "cc-no-usage", prompt: "hi", model: "claude-sonnet-4", maxTurns: 1 });
    const events = await collectUntilIdle(session);

    const usageEvents = events.filter((e) => e.type === "usage");
    expect(usageEvents).toHaveLength(0);
  });
});

describe("ClaudeCodeRuntime — synthetic tool_result emission", () => {
  beforeEach(() => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "");
    mockQuery.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits synthetic tool_result when tool_use is followed by text in next message", async () => {
    // Simulates the real SDK flow: tool_use in one message, text response in the next
    mockQuery.mockReturnValue(asyncIterableFrom([
      { type: "system", subtype: "init", session_id: "sdk-synth-1", model: "claude-sonnet-4" },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_abc123", name: "Bash", input: { command: "ls" } }],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Here are the files..." }],
        },
      },
      { type: "result", subtype: "success", is_error: false, result: "done" },
    ]));

    const runtime = new ClaudeCodeRuntime();
    const session = runtime.spawn({ sessionId: "cc-synth-1", prompt: "ls", model: "claude-sonnet-4", maxTurns: 1 });
    const events = await collectUntilIdle(session);

    // Should have: system, runtime_session_id, tool_use, tool_result (synthetic), text, usage
    const toolUseEvents = events.filter((e) => e.type === "tool_use");
    const toolResultEvents = events.filter((e) => e.type === "tool_result");

    expect(toolUseEvents).toHaveLength(1);
    expect(toolResultEvents).toHaveLength(1);

    // The synthetic tool_result should reference the tool_use ID
    const raw = toolResultEvents[0].raw as Record<string, unknown>;
    expect(raw.tool_use_id).toBe("toolu_abc123");
    expect(raw.synthetic).toBe(true);
  });

  it("emits synthetic tool_result for multiple tool_use blocks before text", async () => {
    mockQuery.mockReturnValue(asyncIterableFrom([
      { type: "system", subtype: "init", session_id: "sdk-synth-2", model: "claude-sonnet-4" },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
            { type: "tool_use", id: "toolu_2", name: "Read", input: { path: "/tmp/test" } },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done with both tools" }],
        },
      },
      { type: "result", subtype: "success", is_error: false, result: "done" },
    ]));

    const runtime = new ClaudeCodeRuntime();
    const session = runtime.spawn({ sessionId: "cc-synth-2", prompt: "test", model: "claude-sonnet-4", maxTurns: 1 });
    const events = await collectUntilIdle(session);

    const toolResultEvents = events.filter((e) => e.type === "tool_result");
    expect(toolResultEvents).toHaveLength(2);

    const ids = toolResultEvents.map((e) => (e.raw as Record<string, unknown>).tool_use_id);
    expect(ids).toContain("toolu_1");
    expect(ids).toContain("toolu_2");
  });

  it("does not emit synthetic tool_result when SDK provides real tool_result", async () => {
    // If the SDK includes tool_result in the same message, no synthetic needed
    mockQuery.mockReturnValue(asyncIterableFrom([
      { type: "system", subtype: "init", session_id: "sdk-synth-3", model: "claude-sonnet-4" },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_real", name: "Bash", input: { command: "echo hi" } },
            { type: "tool_result", content: "hi" },
          ],
        },
      },
      { type: "result", subtype: "success", is_error: false, result: "done" },
    ]));

    const runtime = new ClaudeCodeRuntime();
    const session = runtime.spawn({ sessionId: "cc-synth-3", prompt: "test", model: "claude-sonnet-4", maxTurns: 1 });
    const events = await collectUntilIdle(session);

    const toolResultEvents = events.filter((e) => e.type === "tool_result");
    // Real tool_result from mapMessage, plus synthetic from flush at stream end
    // The real one should appear first
    expect(toolResultEvents.length).toBeGreaterThanOrEqual(1);
    // First tool_result should be the real one (no synthetic flag)
    const firstRaw = toolResultEvents[0].raw as Record<string, unknown>;
    expect(firstRaw.synthetic).toBeUndefined();
  });
});

// ─── Multi-turn integration tests ──────────────────────────

import { drainUntilStatus } from "@grackle-ai/runtime-sdk";

describe("ClaudeCodeRuntime — multi-turn persistent mode", () => {
  beforeEach(() => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "");
    mockQuery.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * Create a mock query() for persistent mode. The real SDK receives an AsyncIterable
   * prompt queue and yields response messages for each user message consumed from it.
   * This mock reads from the prompt iterable and yields `turnResponses[i]` for each turn.
   */
  function mockQueryPersistent(turnResponses: Record<string, unknown>[][]): void {
    // The real SDK's query() returns an AsyncIterable directly (not a Promise).
    // The code casts `query(queryInput)` to AsyncIterable without awaiting.
    mockQuery.mockImplementation((queryInput: Record<string, unknown>) => {
      const promptIterable = queryInput.prompt as AsyncIterable<Record<string, unknown>>;

      return {
        async *[Symbol.asyncIterator]() {
          let turnIndex = 0;
          for await (const _userMessage of promptIterable) {
            const responses = turnResponses[turnIndex] ?? [];
            for (const msg of responses) {
              yield msg;
            }
            // Always yield a result message to signal turn completion
            yield { type: "result", subtype: "success", is_error: false, result: "ok" };
            turnIndex++;
          }
        },
      };
    });
  }

  /** Spawn a session and return an iterator-based event consumer. */
  function spawnSession(prompt: string = "hello") {
    const runtime = new ClaudeCodeRuntime();
    const session = runtime.spawn({
      sessionId: "cc-mt",
      prompt,
      model: "claude-sonnet-4",
      maxTurns: 0,
    });
    const streamIterator = session.stream()[Symbol.asyncIterator]();
    const nextEvent = async (): Promise<AgentEvent | undefined> => {
      const result = await streamIterator.next();
      return result.done ? undefined : result.value;
    };
    return { session, nextEvent };
  }

  it("follow-up events appear via prompt queue after sendInput", async () => {
    mockQueryPersistent([
      // Turn 1: system init + assistant text
      [
        { type: "system", subtype: "init", session_id: "sess-mt", model: "claude-sonnet-4" },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "turn1 response" }] } },
      ],
      // Turn 2: assistant text only
      [
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "turn2 response" }] } },
      ],
    ]);

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

  it("query() is called exactly once across multiple turns (persistent mode)", async () => {
    mockQueryPersistent([
      [
        { type: "system", subtype: "init", session_id: "sess-once", model: "claude-sonnet-4" },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "t1" }] } },
      ],
      [
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "t2" }] } },
      ],
      [
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "t3" }] } },
      ],
    ]);

    const { session, nextEvent } = spawnSession();
    await drainUntilStatus(nextEvent, "waiting_input");

    // Second turn
    session.sendInput("second");
    await drainUntilStatus(nextEvent, "running");
    await drainUntilStatus(nextEvent, "waiting_input");

    // Third turn
    session.sendInput("third");
    await drainUntilStatus(nextEvent, "running");
    await drainUntilStatus(nextEvent, "waiting_input");

    // query() called exactly once — all turns go through the same persistent query
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // The prompt argument was an AsyncIterable (the prompt queue), not a string
    const callArg = mockQuery.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof callArg.prompt).not.toBe("string");
    expect((callArg.prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBeDefined();

    session.kill();
  });

  it("fallback to resume-per-input when persistent query throws", async () => {
    // First call: persistent mode throws during query()
    let callCount = 0;
    mockQuery.mockImplementation((queryInput: Record<string, unknown>) => {
      callCount++;
      if (callCount === 1 && typeof queryInput.prompt !== "string") {
        // Persistent mode — simulate failure
        throw new Error("Persistent mode not supported");
      }
      // Fallback calls use string prompt — return a simple async iterable
      return asyncIterableFrom([
        { type: "system", subtype: "init", session_id: "sess-fallback", model: "claude-sonnet-4" },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `call${callCount} response` }] } },
        { type: "result", subtype: "success", is_error: false, result: "ok" },
      ]);
    });

    const { session, nextEvent } = spawnSession("initial prompt");

    // Initial turn: persistent mode fails, falls back to consumeQuery with string prompt
    const turn1Events = await drainUntilStatus(nextEvent, "waiting_input");
    expect(turn1Events.some((e) => e.type === "text" && e.content.includes("response"))).toBe(true);

    // Follow-up: uses resume-per-input (query called again with string + resume option)
    session.sendInput("follow-up");
    await drainUntilStatus(nextEvent, "running");
    const turn2Events = await drainUntilStatus(nextEvent, "waiting_input");
    expect(turn2Events.some((e) => e.type === "text" && e.content.includes("response"))).toBe(true);

    // Exact call sequence:
    // Call 1: persistent mode (AsyncIterable prompt) — throws
    // Call 2: fallback consumeQuery (string prompt, no resume — first turn)
    // Call 3: follow-up consumeQuery (string prompt, with resume)
    expect(mockQuery).toHaveBeenCalledTimes(3);

    // Call 1: persistent mode attempted with AsyncIterable prompt
    const call1 = mockQuery.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof call1.prompt).not.toBe("string");

    // Call 2: fallback with string prompt, no resume option
    const call2 = mockQuery.mock.calls[1][0] as Record<string, unknown>;
    expect(typeof call2.prompt).toBe("string");
    expect(call2.prompt).toBe("initial prompt");
    const call2Opts = call2.options as Record<string, unknown>;
    expect(call2Opts.resume).toBeUndefined();

    // Call 3: follow-up with string prompt and resume option set to session ID from call 2
    const call3 = mockQuery.mock.calls[2][0] as Record<string, unknown>;
    expect(typeof call3.prompt).toBe("string");
    expect(call3.prompt).toBe("follow-up");
    const call3Opts = call3.options as Record<string, unknown>;
    expect(call3Opts.resume).toBe("sess-fallback");

    session.kill();
  });

  it("usage events emitted for both turns in persistent mode", async () => {
    mockQueryPersistent([
      [
        { type: "system", subtype: "init", session_id: "sess-usage", model: "claude-sonnet-4" },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "t1" }] } },
        // Note: usage is extracted from result messages; add usage to the result
      ],
      [
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "t2" }] } },
      ],
    ]);

    // Override the mock to include usage data in result messages
    mockQuery.mockImplementation((queryInput: Record<string, unknown>) => {
      const promptIterable = queryInput.prompt as AsyncIterable<Record<string, unknown>>;
      return {
        async *[Symbol.asyncIterator]() {
          let turnIndex = 0;
          for await (const _userMessage of promptIterable) {
            if (turnIndex === 0) {
              yield { type: "system", subtype: "init", session_id: "sess-usage-mt", model: "claude-sonnet-4" };
              yield { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "t1" }] } };
              yield {
                type: "result", subtype: "success", is_error: false, result: "ok",
                total_cost_usd: 0.01,
                usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
              };
            } else {
              yield { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "t2" }] } };
              yield {
                type: "result", subtype: "success", is_error: false, result: "ok",
                total_cost_usd: 0.02,
                usage: { input_tokens: 200, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 },
              };
            }
            turnIndex++;
          }
        },
      };
    });

    const { session, nextEvent } = spawnSession();
    const turn1Events = await drainUntilStatus(nextEvent, "waiting_input");

    session.sendInput("more");
    await drainUntilStatus(nextEvent, "running");
    const turn2Events = await drainUntilStatus(nextEvent, "waiting_input");

    const allEvents = [...turn1Events, ...turn2Events];
    const usageEvents = allEvents.filter((e) => e.type === "usage");
    expect(usageEvents).toHaveLength(2);

    const usage1 = JSON.parse(usageEvents[0].content) as Record<string, number>;
    expect(usage1.input_tokens).toBe(100);
    expect(usage1.output_tokens).toBe(10);
    expect(usage1.cost_usd).toBe(0.01);

    const usage2 = JSON.parse(usageEvents[1].content) as Record<string, number>;
    expect(usage2.input_tokens).toBe(250); // 200 + 50 cached
    expect(usage2.output_tokens).toBe(20);
    expect(usage2.cost_usd).toBe(0.02);

    session.kill();
  });

  it("session recovers when persistent stream throws mid-turn", async () => {
    // Simulate: persistent mode works for turn 1, then the stream THROWS on
    // the second prompt (e.g. SDK process crash). The .catch() handler must
    // resolve turnCompleteResolve so the input loop doesn't hang.
    let callCount = 0;
    mockQuery.mockImplementation((queryInput: Record<string, unknown>) => {
      callCount++;
      if (callCount === 1 && typeof queryInput.prompt !== "string") {
        const promptIterable = queryInput.prompt as AsyncIterable<Record<string, unknown>>;
        return {
          async *[Symbol.asyncIterator]() {
            let first = true;
            for await (const _msg of promptIterable) {
              if (first) {
                yield { type: "system", subtype: "init", session_id: "sess-throw", model: "claude-sonnet-4" };
                yield { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "turn1" }] } };
                yield { type: "result", subtype: "success", is_error: false, result: "ok" };
                first = false;
              } else {
                // Second prompt: stream throws (process crash)
                throw new Error("Process crashed");
              }
            }
          },
        };
      }
      // Resume-per-input fallback
      return asyncIterableFrom([
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `resumed-call${callCount}` }] } },
        { type: "result", subtype: "success", is_error: false, result: "ok" },
      ]);
    });

    const { session, nextEvent } = spawnSession();
    await drainUntilStatus(nextEvent, "waiting_input");

    // Verify persistent mode was used: query() called exactly once with AsyncIterable prompt
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const persistentCall = mockQuery.mock.calls[0][0] as Record<string, unknown>;
    expect((persistentCall.prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBeDefined();

    // Follow-up triggers persistent stream throw → turnCompleteResolve fires →
    // session returns to waiting_input (does NOT hang)
    session.sendInput("trigger-crash");
    await drainUntilStatus(nextEvent, "running");
    await drainUntilStatus(nextEvent, "waiting_input");

    // Session still alive — next follow-up uses resume-per-input
    session.sendInput("retry");
    await drainUntilStatus(nextEvent, "running");
    const recoveryEvents = await drainUntilStatus(nextEvent, "waiting_input");
    expect(recoveryEvents.some((e) => e.type === "text" && e.content.includes("resumed"))).toBe(true);

    // Verify: query() was called again for retry (persistent crashed, fell back to resume-per-input)
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const retryCall = mockQuery.mock.calls[1][0] as Record<string, unknown>;
    expect(typeof retryCall.prompt).toBe("string");
    expect(retryCall.prompt).toBe("retry");
    const retryOpts = retryCall.options as Record<string, unknown>;
    expect(retryOpts.resume).toBe("sess-throw");

    session.kill();
  });

  it("session degrades to resume-per-input when persistent stream ends early", async () => {
    // Simulate: persistent mode works for turn 1, then the stream closes normally
    // (e.g. process exits). The consumePersistentStream cleanup resolves
    // turnCompleteResolve and clears promptQueue, so follow-ups fall back to
    // resume-per-input.
    let callCount = 0;
    mockQuery.mockImplementation((queryInput: Record<string, unknown>) => {
      callCount++;
      if (callCount === 1 && typeof queryInput.prompt !== "string") {
        // Persistent mode: yield turn 1 then close the stream (process exited)
        const promptIterable = queryInput.prompt as AsyncIterable<Record<string, unknown>>;
        return {
          async *[Symbol.asyncIterator]() {
            // Consume only the first prompt, yield response, then exit
            const iter = promptIterable[Symbol.asyncIterator]();
            await iter.next(); // consume initial prompt
            yield { type: "system", subtype: "init", session_id: "sess-degrade", model: "claude-sonnet-4" };
            yield { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "turn1" }] } };
            yield { type: "result", subtype: "success", is_error: false, result: "ok" };
            // Stream ends here — consumePersistentStream cleanup fires
          },
        };
      }
      // Resume-per-input fallback
      return asyncIterableFrom([
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `resumed-call${callCount}` }] } },
        { type: "result", subtype: "success", is_error: false, result: "ok" },
      ]);
    });

    const { session, nextEvent } = spawnSession();
    await drainUntilStatus(nextEvent, "waiting_input");

    // Follow-up: persistent stream already ended, so promptQueue was cleared.
    // executeFollowUp falls back to resume-per-input via runtimeSessionId.
    session.sendInput("after-stream-end");
    await drainUntilStatus(nextEvent, "running");
    const turn2Events = await drainUntilStatus(nextEvent, "waiting_input");
    expect(turn2Events.some((e) => e.type === "text" && e.content.includes("resumed"))).toBe(true);

    // The follow-up call should use resume-per-input (string prompt + resume option)
    const followUpCall = mockQuery.mock.calls[callCount - 1][0] as Record<string, unknown>;
    expect(typeof followUpCall.prompt).toBe("string");
    const followUpOpts = followUpCall.options as Record<string, unknown>;
    expect(followUpOpts.resume).toBe("sess-degrade");

    session.kill();
  });
});
