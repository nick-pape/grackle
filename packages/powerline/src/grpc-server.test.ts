import { describe, it, expect, beforeEach, vi } from "vitest";
import { removeSession, listAllSessions, parkSession, drainParkedSession, isParked } from "./session-mgr.js";
import type { AgentEvent, AgentSession } from "./runtimes/runtime.js";
import { AsyncQueue } from "./utils/async-queue.js";

// We cannot easily test streamSession() through the ConnectRPC router because
// it requires a full HTTP transport. Instead, we dynamically import the module
// to access the exported `registerPowerLineRoutes` and extract the handlers
// via a fake router — but streamSession is a private function.
//
// A simpler approach: test the parking logic by directly exercising the
// session-mgr + AsyncQueue + drainBufferedEvents integration, which is
// where the actual state management happens. The streamSession generator
// logic (cleanExit flag) is straightforward control flow.

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
