import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
}));

import { resolveGithubToken, resolveProviderConfig, buildFindingTool, buildSubtaskCreateTool, CopilotRuntime, CopilotSession } from "./copilot.js";
import { AsyncQueue } from "../utils/async-queue.js";
import type { AgentEvent } from "./runtime.js";

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

describe("buildFindingTool", () => {
  it("returns tool with correct structure", () => {
    const queue = new AsyncQueue<AgentEvent>();
    let capturedName = "";
    let capturedOpts: Record<string, unknown> = {};
    const mockDefineTool = (name: string, opts: Record<string, unknown>): unknown => {
      capturedName = name;
      capturedOpts = opts;
      return { name, ...opts };
    };

    buildFindingTool(mockDefineTool, queue);
    expect(capturedName).toBe("post_finding");
    expect(capturedOpts.description).toBeDefined();
    expect(capturedOpts.parameters).toBeDefined();

    const params = capturedOpts.parameters as Record<string, unknown>;
    expect(params.type).toBe("object");
    const properties = params.properties as Record<string, unknown>;
    expect(properties.title).toBeDefined();
    expect(properties.content).toBeDefined();
    expect(properties.category).toBeDefined();
    expect(properties.tags).toBeDefined();

    queue.close();
  });

  it("handler pushes finding event to queue with defaults for missing fields", async () => {
    const queue = new AsyncQueue<AgentEvent>();
    let handler: (args: Record<string, unknown>) => Promise<unknown> = async () => ({});
    const mockDefineTool = (_name: string, opts: Record<string, unknown>): unknown => {
      handler = opts.handler as typeof handler;
      return {};
    };

    buildFindingTool(mockDefineTool, queue);

    const result = await handler({ title: "My Finding", content: "Details" });
    expect(result).toEqual({ status: "finding_posted", title: "My Finding" });

    const event = await queue.shift();
    expect(event).toBeDefined();
    expect(event!.type).toBe("finding");

    const finding = JSON.parse(event!.content);
    expect(finding.title).toBe("My Finding");
    expect(finding.content).toBe("Details");
    expect(finding.category).toBe("general"); // default
    expect(finding.tags).toEqual([]); // default
    expect(event!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    queue.close();
  });
});

describe("buildSubtaskCreateTool", () => {
  it("returns tool with correct structure", () => {
    const queue = new AsyncQueue<AgentEvent>();
    let capturedName = "";
    let capturedOpts: Record<string, unknown> = {};
    const mockDefineTool = (name: string, opts: Record<string, unknown>): unknown => {
      capturedName = name;
      capturedOpts = opts;
      return { name, ...opts };
    };

    buildSubtaskCreateTool(mockDefineTool, queue);
    expect(capturedName).toBe("create_subtask");
    expect(capturedOpts.description).toBeDefined();
    expect(capturedOpts.parameters).toBeDefined();

    const params = capturedOpts.parameters as Record<string, unknown>;
    expect(params.type).toBe("object");
    const properties = params.properties as Record<string, unknown>;
    expect(properties.title).toBeDefined();
    expect(properties.description).toBeDefined();
    expect(properties.local_id).toBeDefined();
    expect(properties.depends_on).toBeDefined();
    expect(properties.can_decompose).toBeDefined();

    queue.close();
  });

  it("handler pushes subtask_create event to queue", async () => {
    const queue = new AsyncQueue<AgentEvent>();
    let handler: (args: Record<string, unknown>) => Promise<unknown> = async () => ({});
    const mockDefineTool = (_name: string, opts: Record<string, unknown>): unknown => {
      handler = opts.handler as typeof handler;
      return {};
    };

    buildSubtaskCreateTool(mockDefineTool, queue);

    const result = await handler({
      title: "Build Auth",
      description: "Implement authentication",
      local_id: "auth",
    }) as Record<string, unknown>;
    expect(result.status).toBe("subtask_queued");
    expect(result.local_id).toBe("auth");
    expect(result.title).toBe("Build Auth");

    const event = await queue.shift();
    expect(event).toBeDefined();
    expect(event!.type).toBe("subtask_create");

    const subtask = JSON.parse(event!.content);
    expect(subtask.title).toBe("Build Auth");
    expect(subtask.description).toBe("Implement authentication");
    expect(subtask.local_id).toBe("auth");
    expect(subtask.depends_on).toEqual([]);
    expect(subtask.can_decompose).toBe(false);
    expect(event!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    queue.close();
  });

  it("handler omits local_id from result when not provided", async () => {
    const queue = new AsyncQueue<AgentEvent>();
    let handler: (args: Record<string, unknown>) => Promise<unknown> = async () => ({});
    const mockDefineTool = (_name: string, opts: Record<string, unknown>): unknown => {
      handler = opts.handler as typeof handler;
      return {};
    };

    buildSubtaskCreateTool(mockDefineTool, queue);

    const result = await handler({ title: "Task", description: "Do it" }) as Record<string, unknown>;
    expect(result.local_id).toBeUndefined();

    queue.close();
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
    expect(session.status).toBe("interrupted");

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
    expect(session.status).toBe("interrupted");
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

    expect(session.status).toBe("interrupted");

    // The event queue must be closed — draining it should not hang.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queue = (session as any).eventQueue;
    const collected: unknown[] = [];
    for await (const item of queue) {
      collected.push(item);
    }
    // Queue closed cleanly; nothing to assert on items (may be empty)
    expect(session.status).toBe("interrupted");
  });

  /**
   * UT-1 variant: kill() on a session where copilotSession has not yet been
   * set (SDK setup not started) must also be a no-op success.
   */
  it("kill() is safe when copilotSession has not been set yet", () => {
    const session = new CopilotSession("s5", "prompt", "model", 0);
    // Do NOT inject a mock — copilotSession is undefined
    expect(() => session.kill()).not.toThrow();
    expect(session.status).toBe("interrupted");
  });
});
