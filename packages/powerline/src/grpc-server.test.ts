import { describe, it, expect, beforeEach, vi } from "vitest";
import { removeSession, listAllSessions, parkSession, drainParkedSession, isParked } from "./session-mgr.js";
import type { AgentEvent, AgentSession } from "./runtimes/runtime.js";
import { AsyncQueue } from "./utils/async-queue.js";
import type { ConnectRouter } from "@connectrpc/connect";
import { powerline } from "@grackle-ai/common";

/** Create a mock session backed by a real AsyncQueue for realistic drain testing. */
function makeMockSessionWithQueue(id: string): AgentSession & { eventQueue: AsyncQueue<AgentEvent> } {
  const eventQueue = new AsyncQueue<AgentEvent>();
  let killed = false;
  return {
    id,
    runtimeName: "test",
    runtimeSessionId: `test-${id}`,
    status: "running",
    async *stream() {
      yield { type: "system", timestamp: new Date().toISOString(), content: "Session started" };
      for await (const event of eventQueue) {
        yield event;
      }
    },
    sendInput: () => {},
    kill: () => {
      killed = true;
      eventQueue.close();
    },
    drainBufferedEvents: () => eventQueue.drain(),
    eventQueue,
  };
}

describe("session parking integration", () => {
  beforeEach(() => {
    // Clean up sessions from previous tests
    for (const session of listAllSessions()) {
      removeSession(session.id);
    }
    drainParkedSession("test-session");
  });

  it("drainBufferedEvents returns events buffered before kill", () => {
    const session = makeMockSessionWithQueue("test-session");

    // Push events to the queue (simulating agent output)
    session.eventQueue.push({ type: "text", timestamp: "t1", content: "hello" });
    session.eventQueue.push({ type: "text", timestamp: "t2", content: "world" });

    // Kill the session (as streamSession would do on gRPC abort)
    session.kill();

    // Drain should return the buffered events
    const drained = session.drainBufferedEvents();
    expect(drained).toHaveLength(2);
    expect(drained[0]!.content).toBe("hello");
    expect(drained[1]!.content).toBe("world");
  });

  it("drainBufferedEvents returns empty when all events were consumed", async () => {
    const session = makeMockSessionWithQueue("test-session");

    session.eventQueue.push({ type: "text", timestamp: "t1", content: "consumed" });

    // Consume the event via shift (simulating the gRPC stream consuming it)
    await session.eventQueue.shift();

    session.kill();
    const drained = session.drainBufferedEvents();
    expect(drained).toHaveLength(0);
  });

  it("parking stores events and drain retrieves them", () => {
    const session = makeMockSessionWithQueue("test-session");

    // Simulate: agent pushes events, gRPC stream breaks, we kill + drain + park
    session.eventQueue.push({ type: "text", timestamp: "t1", content: "buffered" });
    session.kill();
    const buffered = session.drainBufferedEvents();

    // Park the events (as streamSession would do)
    parkSession("test-session", buffered);

    expect(isParked("test-session")).toBe(true);

    // Drain parked events (as DrainBufferedEvents RPC would do)
    const parked = drainParkedSession("test-session");
    expect(parked).toHaveLength(1);
    expect(parked![0]!.content).toBe("buffered");

    // Second drain returns undefined (one-shot)
    expect(drainParkedSession("test-session")).toBeUndefined();
  });

  it("no parking when buffer is empty", () => {
    const session = makeMockSessionWithQueue("test-session");

    // Kill with nothing buffered
    session.kill();
    const buffered = session.drainBufferedEvents();
    expect(buffered).toHaveLength(0);

    // Nothing to park
    expect(isParked("test-session")).toBe(false);
  });
});

// ─── Handler-level tests via fake ConnectRouter ─────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HandlerMap = Record<string, (...args: any[]) => any>;

/** Extract gRPC handlers by calling registerPowerLineRoutes with a fake router. */
async function getHandlers(): Promise<HandlerMap> {
  // Mock runtime-registry so spawn/resume don't need real runtimes
  vi.mock("./runtime-registry.js", () => ({
    getRuntime: () => undefined,
    listRuntimes: () => [],
  }));
  vi.mock("./token-writer.js", () => ({ writeTokens: vi.fn() }));
  vi.mock("./worktree.js", () => ({ removeWorktree: vi.fn() }));

  const { registerPowerLineRoutes } = await import("./grpc-server.js");

  let handlers: HandlerMap = {};
  const fakeRouter = {
    service(_def: unknown, impl: HandlerMap) {
      handlers = impl;
    },
  } as unknown as ConnectRouter;
  registerPowerLineRoutes(fakeRouter);
  return handlers;
}

describe("DrainBufferedEvents RPC handler", () => {
  beforeEach(() => {
    drainParkedSession("drain-test");
  });

  it("yields parked events as proto messages and clears the parked buffer", async () => {
    const handlers = await getHandlers();

    // Park some events
    parkSession("drain-test", [
      { type: "text", timestamp: "t1", content: "event-1" },
      { type: "tool_use", timestamp: "t2", content: "event-2" },
    ]);

    // Call the handler
    const generator = handlers.drainBufferedEvents({ sessionId: "drain-test" });
    const results: powerline.AgentEvent[] = [];
    for await (const event of generator) {
      results.push(event as powerline.AgentEvent);
    }

    expect(results).toHaveLength(2);
    expect(results[0]!.content).toBe("event-1");
    expect(results[0]!.type).toBe("text");
    expect(results[1]!.content).toBe("event-2");
    expect(results[1]!.type).toBe("tool_use");

    // Buffer should be cleared (one-shot)
    expect(isParked("drain-test")).toBe(false);
  });

  it("yields nothing for unknown session", async () => {
    const handlers = await getHandlers();

    const generator = handlers.drainBufferedEvents({ sessionId: "nonexistent" });
    const results: powerline.AgentEvent[] = [];
    for await (const event of generator) {
      results.push(event as powerline.AgentEvent);
    }

    expect(results).toHaveLength(0);
  });
});
