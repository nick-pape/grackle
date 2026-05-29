import { describe, it, expect, beforeEach } from "vitest";
import {
  addSession,
  deleteSessionPump,
  getSession,
  getSessionPump,
  listAllSessions,
  parkSession,
  drainParkedSession,
  isParked,
  registerPumpForwarder,
  removeSession,
  startSessionPump,
  unregisterPumpForwarder,
  type PumpForwarder,
} from "./session-mgr.js";
import type { AgentEvent, AgentSession } from "@grackle-ai/runtime-sdk";

function makeMockSession(id: string): AgentSession {
  return {
    id,
    runtimeName: "test",
    runtimeSessionId: `test-${id}`,
    status: "running",
    stream: async function* () {},
    sendInput: () => {},
    kill: () => {},
    drainBufferedEvents: () => [],
  };
}

/**
 * Controllable session for pump tests: push events one at a time, end the
 * stream with `endStream()`. The pump's for-await consumes one event per push.
 */
class ControllableSession implements AgentSession {
  public readonly id: string;
  public readonly runtimeName: string = "test";
  public readonly runtimeSessionId: string;
  public status: "running" = "running";
  private readonly pending: AgentEvent[] = [];
  private readonly waiters: Array<(e: AgentEvent | undefined) => void> = [];
  private closed: boolean = false;

  public constructor(id: string) {
    this.id = id;
    this.runtimeSessionId = `test-${id}`;
  }

  public push(event: AgentEvent): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter(event);
    } else {
      this.pending.push(event);
    }
  }

  public endStream(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()!(undefined);
    }
  }

  public async *stream(): AsyncIterable<AgentEvent> {
    while (true) {
      const head = this.pending.shift();
      if (head !== undefined) {
        yield head;
        continue;
      }
      if (this.closed) {
        return;
      }
      const next = await new Promise<AgentEvent | undefined>((resolve) => {
        this.waiters.push(resolve);
      });
      if (next === undefined) {
        return;
      }
      yield next;
    }
  }

  public sendInput(): void {}
  public kill(): void {
    this.endStream();
  }
  public drainBufferedEvents(): AgentEvent[] {
    return this.pending.splice(0);
  }
}

/** Wait until the pump's task has observed a push (i.e., buffer or trim updated). */
async function tick(): Promise<void> {
  // Two macroticks cover both the await-resolve and the for-await body.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe("session-mgr", () => {
  beforeEach(() => {
    // Clean up any sessions from previous tests
    for (const session of listAllSessions()) {
      removeSession(session.id);
    }
  });

  it("add/get/remove/list roundtrip", () => {
    const session = makeMockSession("s1");
    addSession(session);

    expect(getSession("s1")).toBe(session);
    expect(listAllSessions()).toHaveLength(1);
    expect(listAllSessions()[0]).toBe(session);

    removeSession("s1");
    expect(getSession("s1")).toBeUndefined();
    expect(listAllSessions()).toHaveLength(0);
  });

  it("getSession returns undefined for unknown ID", () => {
    expect(getSession("nonexistent")).toBeUndefined();
  });

  it("removeSession is no-op for unknown ID", () => {
    // Should not throw
    removeSession("nonexistent");
    expect(listAllSessions()).toHaveLength(0);
  });

  it("duplicate ID overwrites the previous session", () => {
    const session1 = makeMockSession("dup");
    const session2 = makeMockSession("dup");

    addSession(session1);
    addSession(session2);

    expect(getSession("dup")).toBe(session2);
    expect(listAllSessions()).toHaveLength(1);
  });

  it("tracks multiple sessions independently", () => {
    const s1 = makeMockSession("a");
    const s2 = makeMockSession("b");
    const s3 = makeMockSession("c");

    addSession(s1);
    addSession(s2);
    addSession(s3);

    expect(listAllSessions()).toHaveLength(3);

    removeSession("b");
    expect(getSession("a")).toBe(s1);
    expect(getSession("b")).toBeUndefined();
    expect(getSession("c")).toBe(s3);
    expect(listAllSessions()).toHaveLength(2);
  });
});

describe("parked sessions", () => {
  beforeEach(() => {
    // Drain any parked sessions from previous tests
    drainParkedSession("parked-1");
    drainParkedSession("parked-2");
  });

  it("parkSession + drainParkedSession roundtrip", () => {
    const events = [
      { type: "text" as const, timestamp: "t1", content: "hello" },
      { type: "text" as const, timestamp: "t2", content: "world" },
    ];
    parkSession("parked-1", events);

    expect(isParked("parked-1")).toBe(true);
    const drained = drainParkedSession("parked-1");
    expect(drained).toEqual(events);
    expect(isParked("parked-1")).toBe(false);
  });

  it("drainParkedSession returns undefined for unknown session", () => {
    expect(drainParkedSession("nonexistent")).toBeUndefined();
  });

  it("drain is one-shot — second drain returns undefined", () => {
    parkSession("parked-2", [{ type: "text" as const, timestamp: "t1", content: "data" }]);
    expect(drainParkedSession("parked-2")).toHaveLength(1);
    expect(drainParkedSession("parked-2")).toBeUndefined();
  });
});

describe("session pumps", () => {
  beforeEach(() => {
    for (const session of listAllSessions()) {
      const pump = getSessionPump(session.id);
      if (pump) {
        deleteSessionPump(session.id);
      }
      removeSession(session.id);
    }
  });

  it("trims pump.buffer up to the slowest active forwarder's pos", async () => {
    const session = new ControllableSession("trim-1");
    const pump = startSessionPump(session);
    const fastForwarder: PumpForwarder = { pos: 0, cancelled: false };
    const slowForwarder: PumpForwarder = { pos: 0, cancelled: false };
    registerPumpForwarder(pump, fastForwarder);
    registerPumpForwarder(pump, slowForwarder);

    // Push 3 events; fast forwarder keeps up after each, slow stays at pos=1.
    for (let i = 0; i < 3; i++) {
      session.push({ type: "text", timestamp: "t", content: `e${String(i)}` });
      await tick();
      fastForwarder.pos = pump.bufferStartIndex + pump.buffer.length;
      if (i === 0) {
        slowForwarder.pos = 1; // consumed event 0; events from index 1 must stay.
      }
    }
    // Slowest at pos=1 → buffer holds events 1..2.
    expect(pump.bufferStartIndex).toBe(1);
    expect(pump.buffer).toHaveLength(2);

    // Advance slow forwarder past everything we've seen so far. The next push
    // can then trim the lot.
    slowForwarder.pos = pump.bufferStartIndex + pump.buffer.length; // = 3
    session.push({ type: "text", timestamp: "t", content: "e3" });
    await tick();
    // Push of e3 brings buffer to [e1, e2, e3] (start=1). trim sees
    // min(fast=3, slow=3) → drop 2 (events 1 and 2). buffer = [e3], start = 3.
    expect(pump.buffer).toHaveLength(1);
    expect(pump.bufferStartIndex).toBe(3);

    session.endStream();
    await tick();
    unregisterPumpForwarder(pump, fastForwarder);
    unregisterPumpForwarder(pump, slowForwarder);
  });

  it("does not trim while no forwarders are attached (so events stay parkable on disconnect)", async () => {
    const session = new ControllableSession("trim-2");
    const pump = startSessionPump(session);

    for (let i = 0; i < 5; i++) {
      session.push({ type: "text", timestamp: "t", content: `e${String(i)}` });
      await tick();
    }
    // No forwarders → buffer holds all 5 (well under the no-subscriber cap).
    expect(pump.bufferStartIndex).toBe(0);
    expect(pump.buffer).toHaveLength(5);

    session.endStream();
    await tick();
  });

  it("fires the natural-exit hook with the session id when session.stream() ends on its own", async () => {
    // Verifies the cleanup-callback contract that lets ahp-handlers prune
    // ClientState.sessionIds without the pump knowing about clients.
    const session = new ControllableSession("natural-exit-1");
    const seen: string[] = [];
    const pump = startSessionPump(session, (id) => {
      seen.push(id);
    });

    expect(seen).toHaveLength(0);
    session.endStream();
    await pump.task;
    expect(seen).toEqual(["natural-exit-1"]);
    // Also confirms session-mgr's own bookkeeping: the session is gone.
    expect(getSession("natural-exit-1")).toBeUndefined();
    expect(getSessionPump("natural-exit-1")).toBeUndefined();
  });

  it("does NOT fire the natural-exit hook when a caller has already removed the session (dispose/disconnect path)", async () => {
    // Mirrors the dispose path: the handler explicitly removes the session
    // and pump before the pump's natural-exit `finally` runs. The hook must
    // not double-fire — handlers do their own cleanup in this case.
    const session = new ControllableSession("natural-exit-2");
    const seen: string[] = [];
    const pump = startSessionPump(session, (id) => {
      seen.push(id);
    });

    // Simulate the dispose path: remove session + pump *before* killing.
    removeSession("natural-exit-2");
    deleteSessionPump("natural-exit-2");
    session.endStream();
    await pump.task;
    expect(seen).toHaveLength(0);
  });

  it("caps the buffer when no forwarders are attached so emit-into-the-void doesn't grow without bound", async () => {
    // Push enough events to exceed the no-subscriber cap. Buffer should hold
    // only the most recent ≤ cap events (older entries discarded via
    // bufferStartIndex advance), per AHP "future events only" semantics.
    const session = new ControllableSession("trim-3");
    const pump = startSessionPump(session);

    const TOTAL = 1100;
    for (let i = 0; i < TOTAL; i++) {
      session.push({ type: "text", timestamp: "t", content: `e${String(i)}` });
    }
    // One macrotick is enough — pushes all queued into pending; the pump
    // drains them serially through its for-await on the next microtask wave.
    while (pump.bufferStartIndex + pump.buffer.length < TOTAL) {
      await tick();
    }
    expect(pump.buffer.length).toBeLessThanOrEqual(1000);
    expect(pump.bufferStartIndex + pump.buffer.length).toBe(TOTAL);
    expect(pump.bufferStartIndex).toBeGreaterThanOrEqual(TOTAL - 1000);

    session.endStream();
    await tick();
  });
});
