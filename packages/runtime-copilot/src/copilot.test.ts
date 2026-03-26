import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentEvent } from "@grackle-ai/runtime-sdk";

// Mock dependencies before importing
vi.mock("@grackle-ai/runtime-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@grackle-ai/runtime-sdk")>();
  return {
    ...original,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    resolveWorkingDirectory: vi.fn(async () => undefined),
    ensureRuntimeInstalled: vi.fn(async () => ""),
    importFromRuntime: vi.fn(async (_runtime: string, pkg: string) => import(pkg)),
    getRuntimeBinDirectory: vi.fn(() => ""),
    isDevMode: vi.fn(() => true),
  };
});
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
}));

import { resolveGithubToken, resolveProviderConfig, CopilotRuntime, CopilotSession, _setCopilotSdkForTesting } from "./copilot.js";

describe("resolveGithubToken", () => {
  beforeEach(() => {
    vi.stubEnv("COPILOT_GITHUB_TOKEN", "");
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns COPILOT_GITHUB_TOKEN when set (highest priority)", () => {
    vi.stubEnv("COPILOT_GITHUB_TOKEN", "copilot-token");
    vi.stubEnv("GH_TOKEN", "gh-token");
    vi.stubEnv("GITHUB_TOKEN", "github-token");

    expect(resolveGithubToken()).toBe("copilot-token");
  });

  it("falls back to GH_TOKEN when COPILOT_GITHUB_TOKEN is not set", () => {
    vi.stubEnv("GH_TOKEN", "gh-token");
    vi.stubEnv("GITHUB_TOKEN", "github-token");

    expect(resolveGithubToken()).toBe("gh-token");
  });

  it("falls back to GITHUB_TOKEN as last resort", () => {
    vi.stubEnv("GITHUB_TOKEN", "github-token");

    expect(resolveGithubToken()).toBe("github-token");
  });

  it("returns undefined when no token env vars are set", () => {
    expect(resolveGithubToken()).toBeUndefined();
  });
});

describe("resolveProviderConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses valid JSON", () => {
    vi.stubEnv("COPILOT_PROVIDER_CONFIG", '{"type":"openai","apiKey":"key123"}');
    const config = resolveProviderConfig();
    expect(config).toEqual({ type: "openai", apiKey: "key123" });
  });

  it("returns undefined when not set", () => {
    vi.stubEnv("COPILOT_PROVIDER_CONFIG", "");
    expect(resolveProviderConfig()).toBeUndefined();
  });

  it("returns undefined for malformed JSON", () => {
    vi.stubEnv("COPILOT_PROVIDER_CONFIG", "not-json{");
    expect(resolveProviderConfig()).toBeUndefined();
  });
});

describe("CopilotRuntime structural", () => {
  it("has name 'copilot'", () => {
    const runtime = new CopilotRuntime();
    expect(runtime.name).toBe("copilot");
  });

  it("spawn returns a session with correct properties", () => {
    const runtime = new CopilotRuntime();
    const session = runtime.spawn({
      sessionId: "cop-1",
      prompt: "test",
      model: "gpt-4",
      maxTurns: 5,
    });
    expect(session.id).toBe("cop-1");
    expect(session.runtimeName).toBe("copilot");
    expect(session.status).toBe("running");
  });

  it("resume sets runtimeSessionId from options", () => {
    const runtime = new CopilotRuntime();
    const session = runtime.resume({
      sessionId: "cop-resume",
      runtimeSessionId: "prev-123",
    });
    expect(session.id).toBe("cop-resume");
    expect(session.runtimeSessionId).toBe("prev-123");
  });
});

describe("CopilotSession — native system prompt injection", () => {
  it("buildInitialPrompt returns only the prompt (excludes systemContext)", () => {
    const session = new CopilotSession("cop-prompt", "user task here", "gpt-4", 0, undefined, undefined, undefined, "system instructions");
    const result = (session as any).buildInitialPrompt();
    expect(result).toBe("user task here");
    expect(result).not.toContain("system instructions");
  });

  it("buildInitialPrompt returns prompt unchanged when no systemContext", () => {
    const session = new CopilotSession("cop-no-ctx", "just the prompt", "gpt-4", 0);
    const result = (session as any).buildInitialPrompt();
    expect(result).toBe("just the prompt");
  });
});

// ─── Kill path tests (UT-1 through UT-4) ────────────────────────────────────

/**
 * Helper to inject a mock Copilot SDK session into a CopilotSession instance
 * without going through the full SDK setup. We access the private field via
 * type-cast so the test stays self-contained and does not require starting the
 * Copilot CLI process.
 */
function injectMockCopilotSession(
  session: CopilotSession,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockSdkSession: Record<string, any>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (session as any).copilotSession = mockSdkSession;
}

describe("CopilotSession.kill — abort path (UT-1 through UT-4)", () => {
  /**
   * UT-1: kill() succeeds when the Copilot SDK abort() is synchronous (returns void).
   *
   * The original bug: abort() returning void caused `.catch()` to throw a TypeError,
   * which propagated out of kill() and surfaced as [internal] internal error.
   */
  it("UT-1: kill() does not throw when abort() is synchronous (returns void)", () => {
    const session = new CopilotSession("s1", "prompt", "model", 0);
    const mockSdkSession = {
      abort: vi.fn(() => { /* synchronous, returns undefined (void) */ }),
      destroy: vi.fn(() => Promise.resolve()),
    };
    injectMockCopilotSession(session, mockSdkSession);

    // Must not throw — this was the bug: abort() returned void and .catch() exploded
    expect(() => session.kill()).not.toThrow();
    expect(mockSdkSession.abort).toHaveBeenCalledOnce();
  });

  /**
   * UT-2: kill() succeeds when the Copilot SDK abort() returns a Promise.
   */
  it("UT-2: kill() does not throw when abort() returns a resolved Promise", async () => {
    const session = new CopilotSession("s2", "prompt", "model", 0);
    const mockSdkSession = {
      abort: vi.fn(() => Promise.resolve()),
      destroy: vi.fn(() => Promise.resolve()),
    };
    injectMockCopilotSession(session, mockSdkSession);

    expect(() => session.kill()).not.toThrow();
    expect(mockSdkSession.abort).toHaveBeenCalledOnce();
    // Let microtasks drain so the .catch() handler runs without unhandled rejection
    await Promise.resolve();
  });

  /**
   * UT-3: kill() still completes (and cleanup still runs) when abort() throws
   * synchronously or returns a rejected Promise — no uncaught exception surfaces.
   */
  it("UT-3: kill() completes and cleanup (destroy) runs even when abort() throws synchronously", async () => {
    const session = new CopilotSession("s3", "prompt", "model", 0);
    const destroyFn = vi.fn(() => Promise.resolve());
    const mockSdkSession = {
      abort: vi.fn(() => { throw new Error("SDK exploded"); }),
      destroy: destroyFn,
    };
    injectMockCopilotSession(session, mockSdkSession);

    expect(() => session.kill()).not.toThrow();
    // Status must still be killed even though abort() threw
    expect(session.status).toBe("stopped");

    // releaseResources() fires cleanup() as a fire-and-forget; drain the microtask
    // queue so the async cleanup path (destroy()) settles before we assert on it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(destroyFn).toHaveBeenCalledOnce();
  });

  it("UT-3b: kill() completes and cleanup (destroy) runs even when abort() returns a rejected Promise", async () => {
    const session = new CopilotSession("s3b", "prompt", "model", 0);
    const destroyFn = vi.fn(() => Promise.resolve());
    const mockSdkSession = {
      abort: vi.fn(() => Promise.reject(new Error("async abort failure"))),
      destroy: destroyFn,
    };
    injectMockCopilotSession(session, mockSdkSession);

    expect(() => session.kill()).not.toThrow();
    expect(session.status).toBe("stopped");
    // Drain microtasks — the rejection must be swallowed, not unhandled,
    // and the cleanup (destroy) path must still execute.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(destroyFn).toHaveBeenCalledOnce();
  });

  /**
   * UT-4: After kill(), session status is "interrupted" and the event queue is closed
   * (iterating it should complete immediately without hanging).
   */
  it("UT-4: session status is 'killed' and event queue closes after kill()", async () => {
    const session = new CopilotSession("s4", "prompt", "model", 0);
    const mockSdkSession = {
      abort: vi.fn(() => Promise.resolve()),
      destroy: vi.fn(() => Promise.resolve()),
    };
    injectMockCopilotSession(session, mockSdkSession);

    session.kill();

    expect(session.status).toBe("stopped");

    // The event queue must be closed — draining it should not hang.
    // kill() now emits a final "killed" status event before closing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queue = (session as any).eventQueue;
    const collected: AgentEvent[] = [];
    for await (const item of queue) {
      collected.push(item);
    }
    // Queue closed cleanly; the "killed" status event should be the only item.
    expect(collected).toHaveLength(1);
    expect(collected[0].type).toBe("status");
    expect(collected[0].content).toBe("killed");
    expect(session.status).toBe("stopped");
  });

  /**
   * UT-1 variant: kill() on a session where copilotSession has not yet been
   * set (SDK setup not started) must also be a no-op success.
   */
  it("kill() is safe when copilotSession has not been set yet", () => {
    const session = new CopilotSession("s5", "prompt", "model", 0);
    // Do NOT inject a mock — copilotSession is undefined
    expect(() => session.kill()).not.toThrow();
    expect(session.status).toBe("stopped");
  });
});

describe("CopilotRuntime — runtime_session_id emission", () => {
  // Uses the @internal _setCopilotSdkForTesting hook to inject a mock SDK and
  // exercise the real setupSdk() code path end-to-end.

  beforeEach(() => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "");

    const idleHandlers: Record<string, () => void> = {};
    const mockCopilotSession = {
      sessionId: "copilot-sdk-session-xyz",
      on: vi.fn((event: string, fn: () => void) => { idleHandlers[event] = fn; }),
      send: vi.fn(async () => { setTimeout(() => idleHandlers["session.idle"]?.(), 0); }),
      destroy: vi.fn(async () => {}),
      abort: vi.fn(),
    };
    const mockCopilotClient = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => []),
      createSession: vi.fn(async () => mockCopilotSession),
      resumeSession: vi.fn(async () => mockCopilotSession),
    };

    _setCopilotSdkForTesting({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      CopilotClient: class { constructor() { return mockCopilotClient; } } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      defineTool: vi.fn() as any,
      approveAll: vi.fn(),
    });
  });

  afterEach(() => {
    _setCopilotSdkForTesting(undefined); // reset cache for next test
    vi.unstubAllEnvs();
  });

  it("real setupSdk() emits runtime_session_id event with the Copilot session ID", async () => {
    const runtime = new CopilotRuntime();
    const session = runtime.spawn({ sessionId: "cop-emit-real", prompt: "hi", model: "gpt-4o", maxTurns: 1 });

    const events: AgentEvent[] = [];
    for await (const event of session.stream()) {
      events.push(event);
      if (event.type === "status" && event.content === "waiting_input") {
        session.kill();
        break;
      }
      if (event.type === "status" && event.content === "failed") break;
    }

    const rtIdEvent = events.find((e) => e.type === "runtime_session_id");
    expect(rtIdEvent, `Expected runtime_session_id event. Got: ${JSON.stringify(events.map(e => e.type))}`).toBeDefined();
    expect(rtIdEvent!.content).toBe("copilot-sdk-session-xyz");
    expect(rtIdEvent!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("CopilotRuntime — usage event emission", () => {
  beforeEach(() => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers: Record<string, (...args: any[]) => void> = {};
    const mockCopilotSession = {
      sessionId: "copilot-usage-session",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: vi.fn((event: string, fn: (...args: any[]) => void) => { handlers[event] = fn; }),
      send: vi.fn(async () => {
        // Simulate: usage event fires before idle
        setTimeout(() => {
          handlers["assistant.usage"]?.({
            data: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 500, cacheWriteTokens: 0, cost: 0.003, model: "gpt-4o" },
          });
          handlers["session.idle"]?.();
        }, 0);
      }),
      destroy: vi.fn(async () => {}),
      abort: vi.fn(),
    };
    const mockCopilotClient = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => []),
      createSession: vi.fn(async () => mockCopilotSession),
      resumeSession: vi.fn(async () => mockCopilotSession),
    };

    _setCopilotSdkForTesting({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      CopilotClient: class { constructor() { return mockCopilotClient; } } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      defineTool: vi.fn() as any,
      approveAll: vi.fn(),
    });
  });

  afterEach(() => {
    _setCopilotSdkForTesting(undefined);
    vi.unstubAllEnvs();
  });

  it("emits usage event from assistant.usage with cache tokens included", async () => {
    const runtime = new CopilotRuntime();
    const session = runtime.spawn({ sessionId: "cop-usage-test", prompt: "hi", model: "gpt-4o", maxTurns: 1 });

    const events: AgentEvent[] = [];
    for await (const event of session.stream()) {
      events.push(event);
      if (event.type === "status" && event.content === "waiting_input") {
        session.kill();
        break;
      }
      if (event.type === "status" && event.content === "failed") break;
    }

    const usageEvents = events.filter((e) => e.type === "usage");
    expect(usageEvents).toHaveLength(1);
    const data = JSON.parse(usageEvents[0].content) as Record<string, number>;
    // input = 100 (input) + 500 (cacheRead) + 0 (cacheWrite) = 600
    expect(data.input_tokens).toBe(600);
    expect(data.output_tokens).toBe(20);
    // Copilot SDK cost is in nano-AIU, not USD — we emit 0 until conversion is available
    expect(data.cost_usd).toBe(0);
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

describe("CopilotRuntime — multi-turn", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handlers: Record<string, (...args: any[]) => void>;
  let sendCallCount: number;
  let mockCopilotClient: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.stubEnv("GRACKLE_MCP_CONFIG", "");

    handlers = {};
    sendCallCount = 0;

    const mockCopilotSession = {
      sessionId: "copilot-mt-session",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: vi.fn((event: string, fn: (...args: any[]) => void) => { handlers[event] = fn; }),
      send: vi.fn(async () => {
        sendCallCount++;
        const turn = sendCallCount;
        setTimeout(() => {
          // Fire a text delta with per-turn content
          handlers["assistant.message_delta"]?.({
            data: { messageId: `m${turn}`, deltaContent: `turn${turn} response` },
          });
          handlers["session.idle"]?.();
        }, 0);
      }),
      destroy: vi.fn(async () => {}),
      abort: vi.fn(),
    };
    mockCopilotClient = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => []),
      createSession: vi.fn(async () => mockCopilotSession),
      resumeSession: vi.fn(async () => mockCopilotSession),
    };

    _setCopilotSdkForTesting({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      CopilotClient: class { constructor() { return mockCopilotClient; } } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      defineTool: vi.fn() as any,
      approveAll: vi.fn(),
    });
  });

  afterEach(() => {
    _setCopilotSdkForTesting(undefined);
    vi.unstubAllEnvs();
  });

  /** Spawn a session and return an iterator-based event consumer. */
  function spawnSession(prompt: string = "hello") {
    const runtime = new CopilotRuntime();
    const session = runtime.spawn({
      sessionId: "cop-mt",
      prompt,
      model: "gpt-4o",
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

  it("copilotSession is reused across turns (createSession once, send per turn)", async () => {
    const { session, nextEvent } = spawnSession();
    await drainUntilStatus(nextEvent, "waiting_input");

    session.sendInput("second turn");
    await drainUntilStatus(nextEvent, "running");
    await drainUntilStatus(nextEvent, "waiting_input");

    expect(mockCopilotClient.createSession).toHaveBeenCalledTimes(1);
    expect(sendCallCount).toBe(2); // once per turn (initial + follow-up)

    session.kill();
  });

  it("error in follow-up does not crash the session", async () => {
    // Override send: first call succeeds, second throws, third succeeds
    let localSendCount = 0;
    const mockCopilotSession = {
      sessionId: "copilot-err-session",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: vi.fn((event: string, fn: (...args: any[]) => void) => { handlers[event] = fn; }),
      send: vi.fn(async () => {
        localSendCount++;
        const turn = localSendCount;
        if (turn === 2) {
          throw new Error("Copilot SDK connection lost");
        }
        setTimeout(() => {
          handlers["assistant.message_delta"]?.({
            data: { messageId: `m${turn}`, deltaContent: `turn${turn} ok` },
          });
          handlers["session.idle"]?.();
        }, 0);
      }),
      destroy: vi.fn(async () => {}),
      abort: vi.fn(),
    };
    mockCopilotClient = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => []),
      createSession: vi.fn(async () => mockCopilotSession),
      resumeSession: vi.fn(async () => mockCopilotSession),
    };
    _setCopilotSdkForTesting({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      CopilotClient: class { constructor() { return mockCopilotClient; } } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      defineTool: vi.fn() as any,
      approveAll: vi.fn(),
    });

    const { session, nextEvent } = spawnSession();
    await drainUntilStatus(nextEvent, "waiting_input");

    // Follow-up that throws
    session.sendInput("bad");
    await drainUntilStatus(nextEvent, "running");
    const errorTurnEvents = await drainUntilStatus(nextEvent, "waiting_input");
    expect(errorTurnEvents.some((e) => e.type === "error")).toBe(true);

    // Session still alive — send another input
    session.sendInput("retry");
    await drainUntilStatus(nextEvent, "running");
    const recoveryEvents = await drainUntilStatus(nextEvent, "waiting_input");
    expect(recoveryEvents.some((e) => e.type === "text" && e.content === "turn3 ok")).toBe(true);

    session.kill();
  });

  it("usage events emitted per turn", async () => {
    // Set up a fresh mock session that also emits usage events
    let usageSendCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usageHandlers: Record<string, (...args: any[]) => void> = {};
    const usageMockSession = {
      sessionId: "copilot-usage-mt",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: vi.fn((event: string, fn: (...args: any[]) => void) => { usageHandlers[event] = fn; }),
      send: vi.fn(async () => {
        usageSendCount++;
        const turn = usageSendCount;
        setTimeout(() => {
          usageHandlers["assistant.message_delta"]?.({
            data: { messageId: `m${turn}`, deltaContent: `t${turn}` },
          });
          usageHandlers["assistant.usage"]?.({
            data: { inputTokens: turn * 100, outputTokens: turn * 10, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, model: "gpt-4o" },
          });
          usageHandlers["session.idle"]?.();
        }, 0);
      }),
      destroy: vi.fn(async () => {}),
      abort: vi.fn(),
    };

    const usageMockClient = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => []),
      createSession: vi.fn(async () => usageMockSession),
      resumeSession: vi.fn(async () => usageMockSession),
    };
    _setCopilotSdkForTesting({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      CopilotClient: class { constructor() { return usageMockClient; } } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      defineTool: vi.fn() as any,
      approveAll: vi.fn(),
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

    const usage2 = JSON.parse(usageEvents[1].content) as Record<string, number>;
    expect(usage2.input_tokens).toBe(200);
    expect(usage2.output_tokens).toBe(20);

    session.kill();
  });
});
