import { describe, it, expect } from "vitest";
import { BaseAgentSession } from "./base-session.js";
import type { AgentEvent } from "./runtime.js";

/** A deferred promise that can be resolved externally. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Minimal concrete subclass of BaseAgentSession for testing the input queue
 * and turn serialization behavior without any real SDK dependency.
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
  private gates: Array<Deferred<void>> = [];

  /**
   * Add a gate — executeFollowUp will block on each gate in order.
   * Call gate.resolve() to let the follow-up complete.
   */
  public addGate(): Deferred<void> {
    const d = createDeferred<void>();
    this.gates.push(d);
    return d;
  }

  protected async setupSdk(): Promise<void> {
    // no-op
  }

  protected async setupForResume(): Promise<void> {
    // no-op
  }

  protected async runInitialQuery(_prompt: string): Promise<number> {
    return 1;
  }

  protected canAcceptInput(): boolean {
    return true;
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
}

/** Drain events from an async iterator until a status event with the given content. */
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

/** Create a session and return helpers for consuming its event stream. */
function spawnSession(): {
  session: TestSession;
  nextEvent: () => Promise<AgentEvent | undefined>;
} {
  const session = new TestSession("test-1", "hello", "model", 0);
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

    expect(session.status).toBe("interrupted");

    // Stream should end
    const event = await nextEvent();
    expect(event).toBeUndefined();

    // "first" was recorded (push happens before gate), but "second" was not processed
    expect(session.followUpCalls).toEqual(["first"]);
  });

  it("sendInput after kill is a no-op", async () => {
    const { session, nextEvent } = spawnSession();

    await drainUntilStatus(nextEvent, "waiting_input");
    session.kill();

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
