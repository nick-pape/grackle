import { describe, it, expect, vi } from "vitest";
import { BaseAgentRuntime } from "./base-runtime.js";
import type { AgentSession, CreateSessionOptions, RuntimeCapabilities } from "./runtime.js";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** Minimal concrete session for testing. */
class TestSession implements AgentSession {
  public id: string;
  public runtimeName: string = "test";
  public runtimeSessionId: string = "";
  public status = "pending" as const;
  public readonly capturedOptions: CreateSessionOptions;

  public constructor(opts: CreateSessionOptions) {
    this.id = opts.id;
    this.capturedOptions = opts;
  }

  public stream(): AsyncIterable<never> {
    return (async function* () {})();
  }
  public sendInput(_text: string): void {}
  public kill(_reason?: string): void {}
  public drainBufferedEvents(): never[] {
    return [];
  }
}

/** Concrete runtime with default capabilities (supportsHooks: false). */
class NoHooksRuntime extends BaseAgentRuntime {
  public name: string = "no-hooks";
  protected createSession(opts: CreateSessionOptions): AgentSession {
    return new TestSession(opts);
  }
}

/** Concrete runtime that supports hooks. */
class HooksRuntime extends BaseAgentRuntime {
  public name: string = "hooks";
  public override readonly capabilities: RuntimeCapabilities = {
    supportsHooks: true,
    supportsResume: true,
    requiresNonEmptyResumePrompt: false,
  };
  public createSession(opts: CreateSessionOptions): AgentSession {
    return new TestSession(opts);
  }
}

/** Concrete runtime that requires a non-empty resume prompt. */
class NonEmptyResumeRuntime extends BaseAgentRuntime {
  public name: string = "non-empty-resume";
  public override readonly capabilities: RuntimeCapabilities = {
    supportsHooks: false,
    supportsResume: true,
    requiresNonEmptyResumePrompt: true,
  };
  public createSession(opts: CreateSessionOptions): AgentSession {
    return new TestSession(opts);
  }
}

describe("BaseAgentRuntime", () => {
  describe("default capabilities", () => {
    it("exposes default capabilities with supportsHooks: false", () => {
      const runtime = new NoHooksRuntime();
      expect(runtime.capabilities.supportsHooks).toBe(false);
    });

    it("exposes default capabilities with supportsResume: true", () => {
      const runtime = new NoHooksRuntime();
      expect(runtime.capabilities.supportsResume).toBe(true);
    });

    it("exposes default capabilities with requiresNonEmptyResumePrompt: false", () => {
      const runtime = new NoHooksRuntime();
      expect(runtime.capabilities.requiresNonEmptyResumePrompt).toBe(false);
    });
  });

  describe("spawn() — hooks forwarding", () => {
    const baseOpts = {
      sessionId: "s1",
      prompt: "hello",
      model: "m",
      maxTurns: 0,
      hooks: { onStop: () => {} },
    };

    it("drops hooks when supportsHooks is false (default)", () => {
      const runtime = new NoHooksRuntime();
      const session = runtime.spawn(baseOpts) as TestSession;
      expect(session.capturedOptions.hooks).toBeUndefined();
    });

    it("forwards hooks when supportsHooks is true", () => {
      const runtime = new HooksRuntime();
      const hooks = { onStop: () => {} };
      const session = runtime.spawn({ ...baseOpts, hooks }) as TestSession;
      expect(session.capturedOptions.hooks).toBe(hooks);
    });

    it("passes other spawn options unchanged", () => {
      const runtime = new HooksRuntime();
      const session = runtime.spawn({ ...baseOpts, prompt: "test-prompt" }) as TestSession;
      expect(session.capturedOptions.prompt).toBe("test-prompt");
      expect(session.capturedOptions.model).toBe("m");
    });
  });

  describe("resume() — prompt selection", () => {
    const resumeOpts = { sessionId: "s2", runtimeSessionId: "rt-1" };

    it("passes empty string prompt when requiresNonEmptyResumePrompt is false", () => {
      const runtime = new NoHooksRuntime();
      const session = runtime.resume(resumeOpts) as TestSession;
      expect(session.capturedOptions.prompt).toBe("");
    });

    it('passes "(resumed)" placeholder when requiresNonEmptyResumePrompt is true', () => {
      const runtime = new NonEmptyResumeRuntime();
      const session = runtime.resume(resumeOpts) as TestSession;
      expect(session.capturedOptions.prompt).toBe("(resumed)");
    });

    it("passes resumeSessionId to createSession", () => {
      const runtime = new NoHooksRuntime();
      const session = runtime.resume(resumeOpts) as TestSession;
      expect(session.capturedOptions.resumeSessionId).toBe("rt-1");
    });
  });
});
