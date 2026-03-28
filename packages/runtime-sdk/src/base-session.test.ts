import { describe, it, expect, vi, beforeEach } from "vitest";
import { BaseAgentSession } from "./base-session.js";
import type { AgentEvent, CreateSessionOptions } from "./runtime.js";
import { drainUntilStatus } from "./test-helpers.js";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockResolveWorkingDirectory = vi.fn<[], Promise<string | undefined>>();
const mockResolveMcpServers = vi.fn();

vi.mock("./runtime-utils.js", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    resolveWorkingDirectory: (...args: unknown[]) => mockResolveWorkingDirectory(...(args as [])),
    resolveMcpServers: (...args: unknown[]) => mockResolveMcpServers(...(args as [])),
  };
});

/** A deferred promise that can be resolved externally. */
interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Minimal concrete subclass of BaseAgentSession for testing the input queue,
 * turn serialization, and shared helper methods.
 */
class TestSession extends BaseAgentSession {
  public runtimeName: string = "test";
  protected readonly runtimeDisplayName: string = "Test";
  protected readonly noMessagesError: string = "no messages";

  /** Track executeFollowUp calls for assertions. */
  public followUpCalls: string[] = [];

  /** If set, executeFollowUp will throw on calls matching this predicate. */
  public throwOnInput?: (text: string) => boolean;

  /**
   * Queue of deferreds that control when each executeFollowUp resolves.
   * If empty, executeFollowUp resolves immediately.
   */
  private gates: Deferred[] = [];

  /**
   * Add a gate — executeFollowUp will block on each gate in order.
   * Call gate.resolve() to let the follow-up complete.
   */
  public addGate(): Deferred {
    const d = createDeferred();
    this.gates.push(d);
    return d;
  }

  protected async setupSdk(): Promise<void> {
    // no-op
  }

  // setupForResume uses the base class default implementation

  protected async runInitialQuery(_prompt: string): Promise<number> {
    return 1;
  }

  protected abortActive(): void {
    // no-op
  }

  protected async executeFollowUp(text: string): Promise<void> {
    if (this.throwOnInput?.(text)) {
      throw new Error(`Simulated error for: ${text}`);
    }
    this.followUpCalls.push(text);
    const gate = this.gates.shift();
    if (gate) {
      await gate.promise;
    }
  }

  // ─── Public wrappers to expose protected helpers for unit testing ───

  public testResolveWorkDir(requireNonEmpty?: boolean): Promise<string | undefined> {
    return this.resolveWorkDir(requireNonEmpty);
  }

  public testResolveMcp(): unknown {
    return this.resolveMcp();
  }

  public testPushUsageEvent(inputTokens: number, outputTokens: number, costUsd: number): void {
    this.pushUsageEvent(inputTokens, outputTokens, costUsd);
  }

  public testSetRuntimeSessionId(id: string): void {
    this.setRuntimeSessionId(id);
  }
}

/**
 * Subclass that overrides setupForResume to add custom behavior on top of the default.
 */
class OverrideResumeSession extends TestSession {
  protected override async setupForResume(): Promise<void> {
    await super.setupForResume();
    this.eventQueue.push({
      type: "system",
      timestamp: new Date().toISOString(),
      content: "custom-resume-action",
    });
  }
}

/** Create a session and return helpers for consuming its event stream. */
function spawnSession(opts?: Partial<CreateSessionOptions>): {
  session: TestSession;
  nextEvent: () => Promise<AgentEvent | undefined>;
} {
  const session = new TestSession({
    id: "test-1",
    prompt: "hello",
    model: "model",
    maxTurns: 0,
    ...opts,
  });
  const streamIterator = session.stream()[Symbol.asyncIterator]();

  const nextEvent = async (): Promise<AgentEvent | undefined> => {
    const result = await streamIterator.next();
    if (!result.done && result.value) {
      return result.value;
    }
    return undefined;
  };

  return { session, nextEvent };
}

// ─── Existing tests: input serialization ─────────────────────────

describe("BaseAgentSession input serialization", () => {
  it("processes a single input through the queue", async () => {
    const { session, nextEvent } = spawnSession();

    // Drain until initial query completes → waiting_input
    await drainUntilStatus(nextEvent, "waiting_input");
    expect(session.status).toBe("idle");

    // Send input
    session.sendInput("hello");

    // Should transition: running → (executeFollowUp) → waiting_input
    await drainUntilStatus(nextEvent, "running");
    await drainUntilStatus(nextEvent, "waiting_input");

    expect(session.followUpCalls).toEqual(["hello"]);
    expect(session.status).toBe("idle");

    session.kill();
  });

  it("serializes multiple rapid inputs (second waits for first)", async () => {
    const { session, nextEvent } = spawnSession();

    // Gate controls when executeFollowUp completes
    const gate1 = session.addGate();
    const gate2 = session.addGate();

    await drainUntilStatus(nextEvent, "waiting_input");

    // Send 2 inputs rapidly
    session.sendInput("first");
    session.sendInput("second");

    // First starts running
    await drainUntilStatus(nextEvent, "running");

    // First is blocked on gate — second should NOT have started
    expect(session.followUpCalls).toEqual(["first"]);

    // Release first
    gate1.resolve();
    await drainUntilStatus(nextEvent, "waiting_input");

    // Second starts
    await drainUntilStatus(nextEvent, "running");
    expect(session.followUpCalls).toEqual(["first", "second"]);

    // Release second
    gate2.resolve();
    await drainUntilStatus(nextEvent, "waiting_input");

    expect(session.followUpCalls).toEqual(["first", "second"]);

    session.kill();
  });

  it("queues input while a follow-up is in progress", async () => {
    const { session, nextEvent } = spawnSession();

    const gate = session.addGate();

    await drainUntilStatus(nextEvent, "waiting_input");

    session.sendInput("first");

    // Wait for first to start running
    await drainUntilStatus(nextEvent, "running");

    // Send second while first is blocked
    session.sendInput("second");

    // At this point, only "first" should be in followUpCalls
    expect(session.followUpCalls).toEqual(["first"]);

    // Release first
    gate.resolve();
    await drainUntilStatus(nextEvent, "waiting_input");

    // Second gets processed (no gate, resolves immediately)
    await drainUntilStatus(nextEvent, "running");
    await drainUntilStatus(nextEvent, "waiting_input");
    expect(session.followUpCalls).toEqual(["first", "second"]);

    session.kill();
  });

  it("kill stops the input loop", async () => {
    const { session, nextEvent } = spawnSession();

    const gate = session.addGate();

    await drainUntilStatus(nextEvent, "waiting_input");

    session.sendInput("first");
    session.sendInput("second");

    // Wait for first to start
    await drainUntilStatus(nextEvent, "running");

    // Kill while first is blocked on gate
    session.kill();

    // Release gate so the follow-up can finish (but session is killed)
    gate.resolve();

    expect(session.status).toBe("stopped");

    // kill() emits a final "killed" status event before closing the stream
    const killedEvent = await nextEvent();
    expect(killedEvent).toBeDefined();
    expect(killedEvent!.type).toBe("status");
    expect(killedEvent!.content).toBe("killed");

    // Stream should end after the killed event
    const event = await nextEvent();
    expect(event).toBeUndefined();

    // "first" was recorded (push happens before gate), but "second" was not processed
    expect(session.followUpCalls).toEqual(["first"]);
  });

  it("sendInput after kill is a no-op", async () => {
    const { session, nextEvent } = spawnSession();

    await drainUntilStatus(nextEvent, "waiting_input");
    session.kill();

    // Drain the final "killed" status event emitted by kill()
    await drainUntilStatus(nextEvent, "killed");

    session.sendInput("should-be-ignored");

    // Small delay to ensure nothing happens
    await new Promise((r) => setTimeout(r, 20));

    expect(session.followUpCalls).toEqual([]);
  });

  it("error in executeFollowUp does not kill the loop", async () => {
    const { session, nextEvent } = spawnSession();
    session.throwOnInput = (text) => text === "fail-me";

    await drainUntilStatus(nextEvent, "waiting_input");

    // Send an input that will throw
    session.sendInput("fail-me");

    // Should get running status
    await drainUntilStatus(nextEvent, "running");

    // Drain until we find the error and then waiting_input (loop continues)
    let foundError = false;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- loop
    while (true) {
      const event = await nextEvent();
      if (!event) {
        break;
      }
      if (event.type === "error" && event.content.includes("Simulated error")) {
        foundError = true;
      }
      if (event.type === "status" && event.content === "waiting_input") {
        break;
      }
    }

    expect(foundError).toBe(true);
    expect(session.followUpCalls).toEqual([]); // "fail-me" threw before push

    // Send another input — loop should still be alive
    session.sendInput("after-error");
    await drainUntilStatus(nextEvent, "running");
    await drainUntilStatus(nextEvent, "waiting_input");

    expect(session.followUpCalls).toEqual(["after-error"]);

    session.kill();
  });
});

// ─── Slow-setup subclass for pre-readiness tests ──────────────────

/**
 * Subclass that simulates a slow setupSdk() with a deferred gate,
 * mirroring real runtime behavior where input sent before SDK initialization
 * completes is queued and processed once setupSdk() finishes.
 */
class SlowSetupSession extends TestSession {
  private readonly setupGate: Deferred = createDeferred();

  /** Resolve the setup gate (simulates SDK initialization completing). */
  public resolveSetup(): void {
    this.setupGate.resolve();
  }

  protected override async setupSdk(): Promise<void> {
    await this.setupGate.promise;
  }
}

/** Create a SlowSetupSession and return helpers for consuming its event stream. */
function spawnSlowSession(opts?: Partial<CreateSessionOptions>): {
  session: SlowSetupSession;
  nextEvent: () => Promise<AgentEvent | undefined>;
} {
  const session = new SlowSetupSession({
    id: "slow-1",
    prompt: "hello",
    model: "model",
    maxTurns: 0,
    ...opts,
  });
  const streamIterator = session.stream()[Symbol.asyncIterator]();

  const nextEvent = async (): Promise<AgentEvent | undefined> => {
    const result = await streamIterator.next();
    if (!result.done && result.value) {
      return result.value;
    }
    return undefined;
  };

  return { session, nextEvent };
}

describe("sendInput before SDK ready", () => {
  it("queues input sent before setupSdk completes", async () => {
    const { session, nextEvent } = spawnSlowSession();

    // Drain the initial "Starting..." system event
    const startEvent = await nextEvent();
    expect(startEvent?.type).toBe("system");

    // Resume the generator WITHOUT awaiting — this kicks off runSession(),
    // which calls setupSdk() and blocks on the deferred gate. The returned
    // promise waits for the first eventQueue push (waiting_input after setup).
    const pendingFirstEvent = nextEvent();

    // Send input while setupSdk is genuinely in-flight
    session.sendInput("early");

    // Now resolve setup so the session can proceed
    session.resolveSetup();

    // The pending nextEvent resolves with the waiting_input status
    const waitingEvent = await pendingFirstEvent;
    expect(waitingEvent?.type).toBe("status");
    expect(waitingEvent?.content).toBe("waiting_input");

    // The early message should be queued and processed as the first follow-up
    await drainUntilStatus(nextEvent, "running");
    await drainUntilStatus(nextEvent, "waiting_input");

    // Send a normal post-ready message
    session.sendInput("late");
    await drainUntilStatus(nextEvent, "running");
    await drainUntilStatus(nextEvent, "waiting_input");

    expect(session.followUpCalls).toEqual(["early", "late"]);

    session.kill();
  });

  it("queues multiple inputs sent before setupSdk and processes them in order", async () => {
    const { session, nextEvent } = spawnSlowSession();

    // Drain the initial system event
    const startEvent = await nextEvent();
    expect(startEvent?.type).toBe("system");

    // Resume the generator WITHOUT awaiting — kicks off runSession(),
    // which blocks on setupSdk()'s deferred gate.
    const pendingFirstEvent = nextEvent();

    // Send 3 messages while setupSdk is genuinely in-flight
    session.sendInput("alpha");
    session.sendInput("bravo");
    session.sendInput("charlie");

    // Resolve setup
    session.resolveSetup();

    // The pending nextEvent resolves with waiting_input
    const waitingEvent = await pendingFirstEvent;
    expect(waitingEvent?.type).toBe("status");
    expect(waitingEvent?.content).toBe("waiting_input");

    // All 3 should be processed in FIFO order
    for (const _expected of ["alpha", "bravo", "charlie"]) {
      await drainUntilStatus(nextEvent, "running");
      await drainUntilStatus(nextEvent, "waiting_input");
    }

    expect(session.followUpCalls).toEqual(["alpha", "bravo", "charlie"]);

    session.kill();
  });
});

// ─── Shared helper method tests ──────────────────────────────────

describe("BaseAgentSession.resolveWorkDir", () => {
  beforeEach(() => {
    mockResolveWorkingDirectory.mockReset();
  });

  it("delegates to resolveWorkingDirectory with session fields", async () => {
    mockResolveWorkingDirectory.mockResolvedValue("/workspace/repo");
    const session = new TestSession({
      id: "t-1",
      prompt: "p",
      model: "m",
      maxTurns: 0,
      branch: "feat/x",
      workingDirectory: "/home/user/code",
      useWorktrees: false,
    });

    const result = await session.testResolveWorkDir();

    expect(result).toBe("/workspace/repo");
    expect(mockResolveWorkingDirectory).toHaveBeenCalledOnce();
    const args = mockResolveWorkingDirectory.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.branch).toBe("feat/x");
    expect(args.workingDirectory).toBe("/home/user/code");
    expect(args.useWorktrees).toBe(false);
    expect(args.eventQueue).toBeDefined();
    expect(args.requireNonEmpty).toBeUndefined();
  });

  it("passes requireNonEmpty when specified", async () => {
    mockResolveWorkingDirectory.mockResolvedValue("/workspace/repo");
    const session = new TestSession({ id: "t-2", prompt: "p", model: "m", maxTurns: 0 });

    await session.testResolveWorkDir(true);

    const args = mockResolveWorkingDirectory.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.requireNonEmpty).toBe(true);
  });

  it("returns undefined when resolveWorkingDirectory returns undefined", async () => {
    mockResolveWorkingDirectory.mockResolvedValue(undefined);
    const session = new TestSession({ id: "t-3", prompt: "p", model: "m", maxTurns: 0 });

    const result = await session.testResolveWorkDir();

    expect(result).toBeUndefined();
  });
});

describe("BaseAgentSession.resolveMcp", () => {
  beforeEach(() => {
    mockResolveMcpServers.mockReset();
  });

  it("delegates to resolveMcpServers with session mcpServers and mcpBroker", () => {
    const mcpServers = { grackle: { type: "http", url: "http://localhost" } };
    const mcpBroker = { url: "http://broker", token: "tok" };
    mockResolveMcpServers.mockReturnValue({ servers: mcpServers, disallowedTools: [] });

    const session = new TestSession({
      id: "t-4",
      prompt: "p",
      model: "m",
      maxTurns: 0,
      mcpServers,
      mcpBroker,
    });

    const result = session.testResolveMcp();

    expect(mockResolveMcpServers).toHaveBeenCalledWith(mcpServers, mcpBroker);
    expect(result).toEqual({ servers: mcpServers, disallowedTools: [] });
  });

  it("returns empty config when neither mcpServers nor mcpBroker set", () => {
    mockResolveMcpServers.mockReturnValue({ servers: undefined, disallowedTools: [] });
    const session = new TestSession({ id: "t-5", prompt: "p", model: "m", maxTurns: 0 });

    const result = session.testResolveMcp();

    expect(mockResolveMcpServers).toHaveBeenCalledWith(undefined, undefined);
    expect(result).toEqual({ servers: undefined, disallowedTools: [] });
  });
});

describe("BaseAgentSession.setupForResume default", () => {
  it("pushes a system event with the resumeSessionId", async () => {
    const { nextEvent } = spawnSession({ resumeSessionId: "prev-session-123" });

    // Drain until waiting_input (resume path)
    const events = await drainUntilStatus(nextEvent, "waiting_input");

    const resumeEvent = events.find(
      (e) => e.type === "system" && e.content.includes("Session resumed"),
    );
    expect(resumeEvent).toBeDefined();
    expect(resumeEvent!.content).toBe("Session resumed (id: prev-session-123)");
  });

  it("can be overridden by subclasses", async () => {
    const session = new OverrideResumeSession({
      id: "t-resume",
      prompt: "p",
      model: "m",
      maxTurns: 0,
      resumeSessionId: "prev-456",
    });
    const streamIterator = session.stream()[Symbol.asyncIterator]();
    const nextEvent = async (): Promise<AgentEvent | undefined> => {
      const result = await streamIterator.next();
      return !result.done && result.value ? result.value : undefined;
    };

    const events = await drainUntilStatus(nextEvent, "waiting_input");

    // Both base and custom events should be present
    const baseEvent = events.find((e) => e.type === "system" && e.content.includes("Session resumed"));
    const customEvent = events.find((e) => e.type === "system" && e.content === "custom-resume-action");
    expect(baseEvent).toBeDefined();
    expect(customEvent).toBeDefined();

    session.kill();
  });
});

describe("BaseAgentSession.pushUsageEvent", () => {
  it("pushes a usage event with correct JSON shape", () => {
    const session = new TestSession({ id: "t-u1", prompt: "p", model: "m", maxTurns: 0 });

    session.testPushUsageEvent(100, 20, 0.005);

    const events = session.drainBufferedEvents();
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toBeDefined();
    const parsed = JSON.parse(usage!.content) as Record<string, number>;
    expect(parsed).toEqual({ input_tokens: 100, output_tokens: 20, cost_usd: 0.005 });
  });

  it("skips push when all values are zero", () => {
    const session = new TestSession({ id: "t-u2", prompt: "p", model: "m", maxTurns: 0 });

    session.testPushUsageEvent(0, 0, 0);

    const events = session.drainBufferedEvents();
    expect(events.find((e) => e.type === "usage")).toBeUndefined();
  });

  it("pushes when only cost is non-zero", () => {
    const session = new TestSession({ id: "t-u3", prompt: "p", model: "m", maxTurns: 0 });

    session.testPushUsageEvent(0, 0, 0.01);

    const events = session.drainBufferedEvents();
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toBeDefined();
    const parsed = JSON.parse(usage!.content) as Record<string, number>;
    expect(parsed).toEqual({ input_tokens: 0, output_tokens: 0, cost_usd: 0.01 });
  });

  it("pushes when only tokens are non-zero", () => {
    const session = new TestSession({ id: "t-u4", prompt: "p", model: "m", maxTurns: 0 });

    session.testPushUsageEvent(50, 0, 0);

    const events = session.drainBufferedEvents();
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toBeDefined();
    const parsed = JSON.parse(usage!.content) as Record<string, number>;
    expect(parsed).toEqual({ input_tokens: 50, output_tokens: 0, cost_usd: 0 });
  });
});

describe("BaseAgentSession.setRuntimeSessionId", () => {
  it("sets runtimeSessionId and pushes event on first call", () => {
    const session = new TestSession({ id: "t-s1", prompt: "p", model: "m", maxTurns: 0 });
    expect(session.runtimeSessionId).toBe("");

    session.testSetRuntimeSessionId("runtime-abc");

    expect(session.runtimeSessionId).toBe("runtime-abc");
    const events = session.drainBufferedEvents();
    const idEvent = events.find((e) => e.type === "runtime_session_id");
    expect(idEvent).toBeDefined();
    expect(idEvent!.content).toBe("runtime-abc");
  });

  it("updates runtimeSessionId but does NOT push event on subsequent calls", () => {
    const session = new TestSession({ id: "t-s2", prompt: "p", model: "m", maxTurns: 0 });

    session.testSetRuntimeSessionId("first-id");
    session.testSetRuntimeSessionId("second-id");

    expect(session.runtimeSessionId).toBe("second-id");
    const events = session.drainBufferedEvents();
    const idEvents = events.filter((e) => e.type === "runtime_session_id");
    expect(idEvents).toHaveLength(1);
    expect(idEvents[0]!.content).toBe("first-id");
  });

  it("does not push event when id is empty string", () => {
    const session = new TestSession({ id: "t-s3", prompt: "p", model: "m", maxTurns: 0 });

    session.testSetRuntimeSessionId("");

    const events = session.drainBufferedEvents();
    expect(events.find((e) => e.type === "runtime_session_id")).toBeUndefined();
  });
});
