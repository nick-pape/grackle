import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentEvent } from "./runtime.js";

// Mock the logger before importing the module under test
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./runtime-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./runtime-utils.js")>();
  return {
    ...original,
    resolveWorkingDirectory: vi.fn(async () => "/workspace/repo"),
  };
});

vi.mock("../runtime-installer.js", () => ({
  ensureRuntimeInstalled: vi.fn(async () => ""),
  importFromRuntime: vi.fn(async (_runtime: string, pkg: string) => import(pkg)),
  getRuntimeBinDirectory: vi.fn(() => ""),
  isDevMode: vi.fn(() => true),
}));

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
