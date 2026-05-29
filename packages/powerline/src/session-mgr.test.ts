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

  it("fires the natural-exit hook when the last forwarder detaches after a natural pump exit", async () => {
    // The hook intentionally does NOT fire from the pump's own finally
    // (which would race the createSession+subscribe sequence). It fires when
    // the last forwarder unregisters *after* pump.done is set.
    const session = new ControllableSession("natural-exit-1");
    const seen: string[] = [];
    const pump = startSessionPump(session, (id) => {
      seen.push(id);
    });
    const forwarder: PumpForwarder = { pos: 0, cancelled: false };
    registerPumpForwarder(pump, forwarder);

    // Pump ends on its own — but the hook hasn't fired yet because a
    // forwarder is still attached.
    session.endStream();
    await pump.task;
    expect(seen).toHaveLength(0);
    expect(getSession("natural-exit-1")).toBeDefined();

    // Now the forwarder detaches. With pump.done true and the last forwarder
    // gone, the hook fires and the session is reaped.
    unregisterPumpForwarder(pump, forwarder);
    expect(seen).toEqual(["natural-exit-1"]);
    expect(getSession("natural-exit-1")).toBeUndefined();
    expect(getSessionPump("natural-exit-1")).toBeUndefined();
  });

  it("does NOT fire the natural-exit hook if no forwarder has ever attached", async () => {
    // The "fast child completes before subscribe arrives" case. The pump
    // finishes naturally with no forwarder ever registered — we leave the
    // session in place so the still-arriving subscribe can find it (it
    // replays from buffer start since it's the first forwarder).
    const session = new ControllableSession("natural-exit-2");
    const seen: string[] = [];
    const pump = startSessionPump(session, (id) => {
      seen.push(id);
    });

    session.endStream();
    await pump.task;
    expect(seen).toHaveLength(0);
    // Session intentionally stays in the registry.
    expect(getSession("natural-exit-2")).toBeDefined();
    expect(getSessionPump("natural-exit-2")).toBeDefined();
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

// ─── Concurrency invariants (Phase C) ──────────────────────────
//
// The pump+forwarder design has a small number of mutating invariants that
// every code path needs to respect. The tests below pin each one as an
// explicit named contract so a future change that violates one fails
// immediately — rather than surfacing as a downstream e2e flake.

describe("session pump concurrency invariants", () => {
  beforeEach(() => {
    for (const session of listAllSessions()) {
      const pump = getSessionPump(session.id);
      if (pump) {
        deleteSessionPump(session.id);
      }
      removeSession(session.id);
    }
  });

  it("invariant: pump.done set in finally, BEFORE wake — sleepers see done on resume", async () => {
    // Forwarders sleep on pump.waiters and re-check pump.done after wake.
    // If pump.finally set done AFTER waking, the awakened forwarder would
    // see done=false, loop back to sleep, and hang forever.
    const session = new ControllableSession("inv-1");
    const pump = startSessionPump(session);
    let observedDoneAtWake: boolean | undefined;
    pump.waiters.add(() => {
      observedDoneAtWake = pump.done;
    });
    session.endStream();
    await pump.task;
    expect(observedDoneAtWake).toBe(true);
  });

  it("invariant: totalForwardersAttached only bumps when registerPumpForwarder is actually called", async () => {
    // The rapid-resubscribe race regression: a cancelled forwarder that
    // never calls registerPumpForwarder must not bump the counter, or
    // the *real* next forwarder will mis-detect itself as a resubscriber.
    const session = new ControllableSession("inv-2");
    const pump = startSessionPump(session);
    expect(pump.totalForwardersAttached).toBe(0);

    const f1: PumpForwarder = { pos: 0, cancelled: true };
    // Per the contract: handlers MUST NOT register a forwarder they've
    // already cancelled. The test enforces by simply not calling register;
    // the counter stays at zero.
    expect(pump.totalForwardersAttached).toBe(0);

    // A real second subscriber registers normally → counter bumps to 1.
    const f2: PumpForwarder = { pos: 0, cancelled: false };
    registerPumpForwarder(pump, f2);
    expect(pump.totalForwardersAttached).toBe(1);

    // Even after f2 detaches, the counter is monotonic — a future
    // resubscribe starts at the tail, not from buffer-start.
    unregisterPumpForwarder(pump, f2);
    expect(pump.totalForwardersAttached).toBe(1);
    // Unused: keep f1 around so the lint rule that disallows unused
    // bindings doesn't trip.
    void f1;

    session.endStream();
    await pump.task;
  });

  it("invariant: cleanup is idempotent — pump-naturally-exits + caller-already-removed = no double-remove", async () => {
    // Mirrors the dispose path: handler tears down session+pump explicitly
    // before the pump's `finally` runs. Then a stale forwarder detaches.
    // No path should crash or re-fire the natural-exit hook.
    const session = new ControllableSession("inv-3");
    const seen: string[] = [];
    const pump = startSessionPump(session, (id) => seen.push(id));
    const f: PumpForwarder = { pos: 0, cancelled: false };
    registerPumpForwarder(pump, f);

    // Handler-driven cleanup (dispose / onDisconnect).
    removeSession("inv-3");
    deleteSessionPump("inv-3");

    // Pump's stream ends naturally afterwards. pump.done becomes true.
    session.endStream();
    await pump.task;

    // Last forwarder detaches. The unregister cleanup checks
    // sessions.has("inv-3") — which is false now — so it doesn't re-remove
    // and doesn't re-fire onNaturalExit.
    unregisterPumpForwarder(pump, f);
    expect(seen).toEqual([]);
    expect(getSession("inv-3")).toBeUndefined();
    expect(getSessionPump("inv-3")).toBeUndefined();
  });

  it("invariant: forwarder.pos in absolute event-index space survives buffer trims", async () => {
    // The trim shifts pump.buffer and bumps bufferStartIndex; forwarder.pos
    // must stay in the absolute index space so the local-index computation
    // (`pos - bufferStartIndex`) keeps pointing at the right event.
    const session = new ControllableSession("inv-4");
    const pump = startSessionPump(session);
    const f: PumpForwarder = { pos: 0, cancelled: false };
    registerPumpForwarder(pump, f);

    // Phase 1: push three events while forwarder lags at pos=0 (no trim).
    for (let i = 0; i < 3; i++) {
      session.push({ type: "text", timestamp: "t", content: `e${String(i)}` });
      await tick();
    }
    expect(pump.bufferStartIndex).toBe(0);
    expect(pump.buffer).toHaveLength(3);

    // Phase 2: catch the forwarder up to the frontier (absolute index 3),
    // then push one more — the next trim sees min=3 and drops [e0,e1,e2].
    f.pos = pump.bufferStartIndex + pump.buffer.length;
    expect(f.pos).toBe(3);
    session.push({ type: "text", timestamp: "t", content: "e3" });
    await tick();
    expect(pump.bufferStartIndex).toBe(3);
    expect(pump.buffer).toHaveLength(1);

    // Phase 3: the forwarder's pos is still 3 (absolute) — translate to
    // local-index space and confirm it addresses e3 (not e0).
    const localIdx = f.pos - pump.bufferStartIndex;
    expect(localIdx).toBe(0);
    expect(pump.buffer[localIdx]?.content).toBe("e3");

    unregisterPumpForwarder(pump, f);
    session.endStream();
    await pump.task;
  });
});

// ─── Long-session memory bounds (Phase D) ─────────────────────

describe("session pump memory bounds (long-running)", () => {
  beforeEach(() => {
    for (const session of listAllSessions()) {
      const pump = getSessionPump(session.id);
      if (pump) {
        deleteSessionPump(session.id);
      }
      removeSession(session.id);
    }
  });

  it("buffer stays bounded by the slowest forwarder's lag across many events", async () => {
    // Models a real long-running session: a slow subscriber stays SLACK
    // events behind the producer; the buffer must hold ≤ SLACK events at
    // any time, not grow proportionally to total events emitted.
    //
    // Batched-push pattern: push BATCH events, advance slow forwarder to
    // frontier-SLACK, then drain the pump task; repeat. This keeps the
    // total tick count low while still exercising the trim watermark.
    const session = new ControllableSession("mem-1");
    const pump = startSessionPump(session);
    const slow: PumpForwarder = { pos: 0, cancelled: false };
    registerPumpForwarder(pump, slow);

    const TOTAL = 2_000;
    const BATCH = 25;
    const SLACK = 10;
    let peakBufferLen = 0;
    let emitted = 0;

    while (emitted < TOTAL) {
      const batchSize = Math.min(BATCH, TOTAL - emitted);
      for (let i = 0; i < batchSize; i++) {
        session.push({ type: "text", timestamp: "t", content: `e${String(emitted + i)}` });
      }
      emitted += batchSize;
      // Drain the pump's for-await of the batch.
      while (pump.bufferStartIndex + pump.buffer.length < emitted) {
        await tick();
      }
      // Slow consumer advances to within SLACK of the current frontier.
      const frontier = pump.bufferStartIndex + pump.buffer.length;
      slow.pos = Math.max(slow.pos, frontier - SLACK);
      // Push one more "trigger" event to fire trim with the updated pos —
      // trim runs after each push, and a pure pos bump doesn't trigger it.
      session.push({ type: "text", timestamp: "t", content: `t${String(emitted)}` });
      emitted += 1;
      while (pump.bufferStartIndex + pump.buffer.length < emitted) {
        await tick();
      }
      if (pump.buffer.length > peakBufferLen) {
        peakBufferLen = pump.buffer.length;
      }
    }

    // Buffer never grew past SLACK + the trigger event + a small epsilon
    // for between-iteration transients.
    expect(peakBufferLen).toBeLessThanOrEqual(SLACK + 5);
    expect(pump.bufferStartIndex + pump.buffer.length).toBe(emitted);

    unregisterPumpForwarder(pump, slow);
    session.endStream();
    await pump.task;
  });
});
