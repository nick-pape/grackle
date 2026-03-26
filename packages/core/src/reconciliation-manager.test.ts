import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ReconciliationManager, type ReconciliationPhase } from "./reconciliation-manager.js";

function makePhase(name: string, execute?: () => Promise<void>): ReconciliationPhase {
  return { name, execute: execute ?? vi.fn().mockResolvedValue(undefined) };
}

describe("ReconciliationManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── RM-1: Phases run in registered order ─────────────────
  it("runs phases in registered order", async () => {
    const order: string[] = [];
    const phaseA = makePhase("alpha", async () => { order.push("A"); });
    const phaseB = makePhase("bravo", async () => { order.push("B"); });
    const phaseC = makePhase("charlie", async () => { order.push("C"); });

    const mgr = new ReconciliationManager([phaseA, phaseB, phaseC], 50);
    mgr.start();
    await vi.advanceTimersByTimeAsync(60);
    await mgr.stop();

    expect(order).toEqual(["A", "B", "C"]);
  });

  // ── RM-2: Phase error doesn't abort tick ──────────────────
  it("continues to next phase when one throws", async () => {
    const order: string[] = [];
    const phaseA = makePhase("alpha", async () => { throw new Error("boom"); });
    const phaseB = makePhase("bravo", async () => { order.push("B"); });

    const mgr = new ReconciliationManager([phaseA, phaseB], 50);
    mgr.start();
    await vi.advanceTimersByTimeAsync(60);
    await mgr.stop();

    expect(order).toEqual(["B"]);
  });

  // ── RM-3: Re-entry guard ──────────────────────────────────
  it("skips overlapping ticks when previous tick is still running", async () => {
    let tickCount = 0;
    let resolvePhase!: () => void;
    const slowPhase = makePhase("slow", () => {
      tickCount++;
      return new Promise<void>((r) => { resolvePhase = r; });
    });

    const mgr = new ReconciliationManager([slowPhase], 50);
    mgr.start();

    // First tick starts
    await vi.advanceTimersByTimeAsync(60);
    expect(tickCount).toBe(1);

    // Second tick interval fires — should be skipped
    await vi.advanceTimersByTimeAsync(60);
    expect(tickCount).toBe(1);

    resolvePhase();
    await mgr.stop();
  });

  // ── RM-4: stop() awaits in-flight tick ────────────────────
  it("awaits in-flight tick before stop resolves", async () => {
    let resolvePhase!: () => void;
    const slowPhase = makePhase("slow", () =>
      new Promise<void>((r) => { resolvePhase = r; }),
    );

    const mgr = new ReconciliationManager([slowPhase], 50);
    mgr.start();
    await vi.advanceTimersByTimeAsync(60); // trigger tick

    let stopped = false;
    const stopPromise = mgr.stop().then(() => { stopped = true; });

    await vi.advanceTimersByTimeAsync(10);
    expect(stopped).toBe(false);

    resolvePhase();
    await stopPromise;
    expect(stopped).toBe(true);
  });

  // ── RM-5: No ticks after stop ─────────────────────────────
  it("does not tick after stop resolves", async () => {
    let tickCount = 0;
    const phase = makePhase("counter", async () => { tickCount++; });

    const mgr = new ReconciliationManager([phase], 50);
    mgr.start();
    await vi.advanceTimersByTimeAsync(60);
    const countAfterFirstTick = tickCount;

    await mgr.stop();
    await vi.advanceTimersByTimeAsync(200);

    expect(tickCount).toBe(countAfterFirstTick);
  });

  // ── RM-6: Empty phases list ───────────────────────────────
  it("handles empty phases list without error", async () => {
    const mgr = new ReconciliationManager([], 50);
    mgr.start();
    await vi.advanceTimersByTimeAsync(60);
    await mgr.stop();
    // No error thrown = pass
  });

  // ── RM-7: Custom tick interval ────────────────────────────
  it("respects custom tick interval", async () => {
    let tickCount = 0;
    const phase = makePhase("counter", async () => { tickCount++; });

    const mgr = new ReconciliationManager([phase], 200);
    mgr.start();

    // At 150ms: should not have ticked yet
    await vi.advanceTimersByTimeAsync(150);
    expect(tickCount).toBe(0);

    // At 250ms: should have ticked once
    await vi.advanceTimersByTimeAsync(100);
    expect(tickCount).toBe(1);

    await mgr.stop();
  });

  // ── RM-8: Double start is no-op ───────────────────────────
  it("double start does not create a second timer", async () => {
    let tickCount = 0;
    const phase = makePhase("counter", async () => { tickCount++; });

    const mgr = new ReconciliationManager([phase], 50);
    mgr.start();
    mgr.start(); // second call should be no-op

    await vi.advanceTimersByTimeAsync(60);
    await mgr.stop();

    // If two timers were created, we'd see 2 ticks
    expect(tickCount).toBe(1);
  });
});
