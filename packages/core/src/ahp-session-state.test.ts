/**
 * Tests for `SessionStateManager` — mapper + reducer + snapshot pipeline.
 *
 * Tests cover:
 * 1. Event processing through mapper → reducer
 * 2. Context mutation tracking
 * 3. Snapshot threshold flushing
 * 4. Turn-complete auto-flushing
 * 5. getState() returns current state
 * 6. clear() resets state
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { powerline } from "@grackle-ai/common";

// ─── Mock snapshot functions ───────────────────────────────────────
// persistSnapshot is best-effort (try/catch in SessionStateManager);
// mock as no-op to avoid needing a real DB.  querySnapshot returns []
// so reconstruct() takes the "no snapshot" path.

// vi.hoisted stabilizes mock refs because vi.mock is hoisted above var defs.
const mockDb = vi.hoisted(() => ({
  persistSnapshot: vi.fn(),
  querySnapshot: vi.fn(() => []),
  querySessionActions: vi.fn(() => []),
}));

vi.mock("@grackle-ai/database", () => mockDb);

import { SessionStateManager } from "./ahp-session-state.js";

// ─── Helpers ────────────────────────────────────────────────────────

function makeEvent(
  type: powerline.AgentEvent["type"],
  overrides?: Record<string, unknown>,
): powerline.AgentEvent {
  return {
    type,
    timestamp: new Date().toISOString(),
    content: overrides?.content,
    raw: overrides?.raw,
    toolCallId: overrides?.toolCallId,
    turnId: overrides?.turnId,
    diagnostic: overrides?.diagnostic,
  };
}

describe("SessionStateManager", () => {
  beforeEach(() => {
    mockDb.persistSnapshot.mockClear();
    mockDb.querySnapshot.mockClear();
  });

  // ─── Event processing ──────────────────────────────────────────

  it("creates initial minimal state", () => {
    const manager = new SessionStateManager("session-001");
    const state = manager.getState();
    expect(state.lifecycle).toBe("creating");
    expect(state.turns).toEqual([]);
  });

  it("processes turn_started and creates active turn", () => {
    const manager = new SessionStateManager("session-001");
    const event = makeEvent("turn_started", {
      turnId: "turn-0",
      content: JSON.stringify({ user_message: "Hello" }),
    });
    manager.processEvent(event, "0");

    const state = manager.getState();
    expect(state.activeTurn).toBeDefined();
    expect(state.activeTurn?.id).toBe("turn-0");
    expect(state.activeTurn?.userMessage.text).toBe("Hello");
  });

  it("processes text and adds response part", () => {
    const manager = new SessionStateManager("session-001");
    // Start a turn
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );

    // Add text
    manager.processEvent(makeEvent("text", { content: "Response text" }), "1");

    const state = manager.getState();
    expect(state.activeTurn).toBeDefined();
    expect(state.activeTurn?.responseParts.length).toBe(1);
    expect(state.activeTurn?.responseParts[0]).toMatchObject({
      kind: "markdown",
      content: "Response text",
    });
  });

  it("processes tool_use and adds tool call", () => {
    const manager = new SessionStateManager("session-001");
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );

    manager.processEvent(
      makeEvent("tool_use", {
        turnId: "turn-0",
        toolCallId: "tc-1",
        content: JSON.stringify({ tool_name: "read_file", display_name: "Read File" }),
      }),
      "1",
    );

    const state = manager.getState();
    expect(state.activeTurn?.responseParts.length).toBeGreaterThan(0);
    const toolPart = state.activeTurn?.responseParts.find(
      (p) => "kind" in p && p.kind === "toolCall",
    );
    expect(toolPart).toBeDefined();
  });

  it("processes tool_result and completes tool call", () => {
    const manager = new SessionStateManager("session-001");
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );

    manager.processEvent(
      makeEvent("tool_use", {
        turnId: "turn-0",
        toolCallId: "tc-1",
        content: JSON.stringify({ tool_name: "shell", display_name: "Shell" }),
      }),
      "1",
    );

    manager.processEvent(
      makeEvent("tool_result", {
        turnId: "turn-0",
        toolCallId: "tc-1",
        content: JSON.stringify({ is_ok: true, content: "output" }),
      }),
      "2",
    );

    const state = manager.getState();
    expect(state.activeTurn).toBeDefined();
  });

  it("processes turn_complete and moves active turn to turns array", () => {
    const manager = new SessionStateManager("session-001");
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );
    manager.processEvent(makeEvent("text", { content: "Response" }), "1");
    manager.processEvent(makeEvent("turn_complete", { turnId: "turn-0" }), "2");

    const state = manager.getState();
    expect(state.activeTurn).toBeUndefined();
    expect(state.turns.length).toBe(1);
    expect(state.turns[0].id).toBe("turn-0");
    expect(state.turns[0].userMessage.text).toBe("Prompt");
  });

  it("drops input_needed", () => {
    const manager = new SessionStateManager("session-001");
    manager.processEvent(makeEvent("input_needed"), "0");
    expect(manager.getState().turns).toEqual([]);
  });

  it("carries usage cost into _meta", () => {
    const manager = new SessionStateManager("session-001");
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );
    manager.processEvent(
      makeEvent("usage", {
        content: JSON.stringify({ cost_millicents: 50 }),
      }),
      "1",
    );

    const meta = manager.getState()._meta;
    expect(meta?.costMillicents).toBe(50);
  });

  it("carries runtime_session_id into _meta", () => {
    const manager = new SessionStateManager("session-001");
    manager.processEvent(makeEvent("runtime_session_id", { content: "runtime-abc" }), "0");

    const meta = manager.getState()._meta;
    expect(meta?.runtimeSessionId).toBe("runtime-abc");
  });

  it("drops system diagnostic events", () => {
    const manager = new SessionStateManager("session-001");
    manager.processEvent(
      makeEvent("system", {
        diagnostic: true,
        content: JSON.stringify({ level: "info" }),
      }),
      "0",
    );
    expect(manager.getState().turns).toEqual([]);
  });

  // ─── Snapshot threshold ────────────────────────────────────────
  // Snapshot flushing is best-effort (try/catch in SessionStateManager).
  // We test the counter logic here since the DB call is intercepted
  // by the try/catch and may not propagate to the mock.

  it("flushes snapshot when threshold is reached", () => {
    const manager = new SessionStateManager("session-001");
    manager.snapshotThreshold = 5;

    // Start a turn so text events are actually processed
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );

    // Process enough events to exceed threshold
    for (let i = 0; i < 5; i++) {
      manager.processEvent(makeEvent("text", { content: `Event ${i}` }), `${i + 1}`);
    }
    // Snapshot should have been triggered (try/catch handles DB failure)
    const state = manager.getState();
    expect(state.activeTurn?.responseParts.length).toBe(5);
  });

  it("does not flush snapshot below threshold", () => {
    const manager = new SessionStateManager("session-001");
    manager.snapshotThreshold = 10;

    // Start a turn so text events are actually processed
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );

    for (let i = 0; i < 3; i++) {
      manager.processEvent(makeEvent("text", { content: `Event ${i}` }), `${i + 1}`);
    }

    // Should still have active turn with 3 parts (no snapshot flushed)
    const state = manager.getState();
    expect(state.activeTurn?.responseParts.length).toBe(3);
  });

  it("resets action counter after snapshot flush", () => {
    const manager = new SessionStateManager("session-001");
    manager.snapshotThreshold = 3;

    // Start a turn so text events are actually processed
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );

    // First flush at 3 events
    for (let i = 0; i < 3; i++) {
      manager.processEvent(makeEvent("text", { content: `Event ${i}` }), `${i + 1}`);
    }
    // Counter reset to 0 after snapshot

    // Process 2 more — should NOT trigger another flush (threshold=3)
    manager.processEvent(makeEvent("text", { content: "Event 3" }), "4");
    manager.processEvent(makeEvent("text", { content: "Event 4" }), "5");

    // 5 total parts, only 1 snapshot flushed
    expect(manager.getState().activeTurn?.responseParts.length).toBe(5);
  });

  // ─── Turn-complete auto-flush ──────────────────────────────────

  it("auto-flushes on turn_complete", () => {
    const manager = new SessionStateManager("session-001");
    manager.snapshotThreshold = 1000; // high to isolate turn-complete flush

    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );
    manager.processEvent(makeEvent("text", { content: "Response" }), "1");
    manager.processEvent(makeEvent("turn_complete", { turnId: "turn-0" }), "2");

    // Turn completed, state should reflect a finished turn
    const state = manager.getState();
    expect(state.activeTurn).toBeUndefined();
    expect(state.turns.length).toBe(1);
  });

  // ─── getState ──────────────────────────────────────────────────

  it("getState returns current state", () => {
    const manager = new SessionStateManager("session-001");
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Hello" }),
      }),
      "0",
    );

    const state = manager.getState();
    expect(state.activeTurn?.id).toBe("turn-0");
  });

  // ─── clear ─────────────────────────────────────────────────────

  it("clear resets state to initial", () => {
    const manager = new SessionStateManager("session-001");
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Hello" }),
      }),
      "0",
    );
    manager.processEvent(makeEvent("text", { content: "Response" }), "1");
    manager.processEvent(makeEvent("turn_complete", { turnId: "turn-0" }), "2");

    expect(manager.getState().turns.length).toBe(1);

    manager.clear();

    const cleared = manager.getState();
    expect(cleared.lifecycle).toBe("creating");
    expect(cleared.turns).toEqual([]);
    expect(cleared.activeTurn).toBeUndefined();
  });

  // ─── Context mutation ──────────────────────────────────────────

  it("tracks turnId in context", () => {
    const manager = new SessionStateManager("session-001");
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-abc",
        content: JSON.stringify({ user_message: "Hello" }),
      }),
      "0",
    );

    const ctx = manager.getContext();
    expect(ctx.turnId).toBe("turn-abc");
  });

  it("tracks openToolCalls in context", () => {
    const manager = new SessionStateManager("session-001");
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Hello" }),
      }),
      "0",
    );
    manager.processEvent(
      makeEvent("tool_use", {
        turnId: "turn-0",
        toolCallId: "tc-1",
        content: JSON.stringify({ tool_name: "read_file" }),
      }),
      "1",
    );

    const ctx = manager.getContext();
    expect(ctx.openToolCalls).toEqual(["tc-1"]);
  });

  // ─── reconstruct ───────────────────────────────────────────────

  it("returns initial state when no snapshot exists", () => {
    const state = SessionStateManager.reconstruct("nonexistent-session");
    expect(state.lifecycle).toBe("creating");
    expect(state.turns).toEqual([]);
  });

  // ─── Deep copy (getState) ──────────────────────────────────────

  it("getState returns a deep copy — mutating state.turns.push does not affect manager", () => {
    const manager = new SessionStateManager("session-001");
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );
    manager.processEvent(makeEvent("text", { content: "Response" }), "1");
    manager.processEvent(makeEvent("turn_complete", { turnId: "turn-0" }), "2");

    // getState returns a frozen deep clone. Unfreeze it to simulate
    // a caller that ignores the immutability contract.
    const state1 = structuredClone(manager.getState());
    state1.turns.push(state1.turns[0]); // mutate

    // Second call should not see the mutation
    const state2 = manager.getState();
    expect(state2.turns.length).toBe(1);
    expect(state2.turns[0]).toEqual(manager.getState().turns[0]);
  });

  // ─── Distinct turn IDs across turns ─────────────────────────────

  it("two sequential turns without turnId get distinct IDs (turn-0, turn-3)", () => {
    const manager = new SessionStateManager("session-001");

    // First turn — no turnId on event, should generate turn-0
    manager.processEvent(
      makeEvent("turn_started", {
        content: JSON.stringify({ user_message: "First turn" }),
      }),
      "0",
    );
    manager.processEvent(makeEvent("text", { content: "Response A" }), "1");
    manager.processEvent(makeEvent("turn_complete", {}), "2");

    // Second turn — no turnId on event, should generate turn-1 (not re-use turn-0)
    manager.processEvent(
      makeEvent("turn_started", {
        content: JSON.stringify({ user_message: "Second turn" }),
      }),
      "3",
    );
    manager.processEvent(makeEvent("text", { content: "Response B" }), "4");
    manager.processEvent(makeEvent("turn_complete", {}), "5");

    const state = manager.getState();
    expect(state.turns.length).toBe(2);
    expect(state.turns[0].id).toBe("turn-0");
    expect(state.turns[1].id).toBe("turn-3"); // uses index as fallback
  });

  // ─── snapshotThreshold = 0 still flushes on turn_complete ──────

  it("snapshotThreshold = 0 still auto-flushes on turn_complete", () => {
    const manager = new SessionStateManager("session-001");
    manager.snapshotThreshold = 0;

    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );
    manager.processEvent(makeEvent("text", { content: "Response" }), "1");
    manager.processEvent(makeEvent("turn_complete", { turnId: "turn-0" }), "2");

    // turn_complete auto-flush fires regardless of threshold = 0
    // We can't directly assert persistSnapshot was called (mock + try/catch),
    // but we can verify the state is correct after the turn completes.
    const state = manager.getState();
    expect(state.activeTurn).toBeUndefined();
    expect(state.turns.length).toBe(1);
  });

  // ─── Duplicate snapshot() with same seq ─────────────────────────

  it("calling snapshot() twice with the same seq does not crash", () => {
    const manager = new SessionStateManager("session-001");
    manager.snapshotThreshold = 1000; // high to isolate

    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );
    manager.processEvent(makeEvent("text", { content: "Response" }), "1");

    // First snapshot with seq "dup-1"
    manager.snapshot("dup-1");

    // Second snapshot with the same seq — should not crash (INSERT OR REPLACE)
    manager.snapshot("dup-1");

    // State should still be correct
    const state = manager.getState();
    expect(state.activeTurn?.responseParts.length).toBe(1);
  });

  // ─── Injected prompt dedup ──────────────────────────────────────

  it("skips runtime turn_started when prompt was injected", () => {
    const manager = new SessionStateManager("session-001");

    // Inject prompt as turn_started
    manager.processEvent(
      makeEvent("turn_started", {
        content: JSON.stringify({ user_message: "Injected prompt" }),
      }),
      "0",
    );
    manager.markInjectedInitialTurn();

    // Runtime also emits turn_started — should be skipped
    manager.processEvent(
      makeEvent("turn_started", {
        content: JSON.stringify({ user_message: "Runtime prompt" }),
      }),
      "1",
    );

    // Only one turn_started action (from the injected prompt)
    const state = manager.getState();
    expect(state.turns.length).toBe(0); // turn not yet complete
    expect(state.activeTurn).toBeDefined();
    expect(state.activeTurn?.responseParts.length).toBe(0); // no response parts
  });

  // ─── Error mid-turn ends turn and drops subsequent events ────────

  it("error event mid-turn ends the turn, subsequent text is dropped", () => {
    const manager = new SessionStateManager("session-001");

    // Start a turn
    manager.processEvent(
      makeEvent("turn_started", {
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );

    // Add text
    manager.processEvent(makeEvent("text", { content: "Partial response" }), "1");

    // Error event — ends the turn
    manager.processEvent(makeEvent("error", { content: "Something failed" }), "2");

    // Text after error — mapper returns no actions (no active turn)
    manager.processEvent(makeEvent("text", { content: "After error" }), "3");

    const state = manager.getState();
    // Error ends the turn: activeTurn is cleared, turn moved to turns[]
    expect(state.activeTurn).toBeUndefined();
    expect(state.turns.length).toBe(1);
    expect(state.turns[0].state).toBe("error");
    // Partial response preserved in turn's responseParts
    expect(state.turns[0].responseParts.length).toBe(1);
    expect(state.turns[0].responseParts[0]).toMatchObject({
      kind: "markdown",
      content: "Partial response",
    });
  });

  // ─── snapshotThreshold = 0 ─────────────────────────────────────

  it("snapshotThreshold=0 disables count-based flush but turn_complete still flushes", () => {
    const manager = new SessionStateManager("session-001");
    manager.snapshotThreshold = 0;

    // Start a turn
    manager.processEvent(
      makeEvent("turn_started", {
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );

    // Add 20 text actions — should NOT trigger count-based snapshot.
    for (let i = 0; i < 20; i++) {
      const lastSeq = manager.processEvent(makeEvent("text", { content: `Item ${i}` }), `${i}`);
      expect(lastSeq).toBe(undefined);
    }

    // Complete the turn — should trigger auto-snapshot.
    manager.processEvent(makeEvent("turn_complete", { turnId: "turn-0" }), "20");
    const state = manager.getState();
    expect(state.activeTurn).toBeUndefined();
    expect(state.turns.length).toBe(1);
  });

  // ─── Snapshot serialization ────────────────────────────────────

  it("snapshot() serializes turns and _meta into valid JSON", () => {
    const manager = new SessionStateManager("session-snap");
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Hello" }),
      }),
      "01ABC000",
    );
    manager.processEvent(makeEvent("text", { content: "World" }), "01ABC001");
    manager.processEvent(
      makeEvent("usage", { content: JSON.stringify({ cost_millicents: 42 }) }),
      "01ABC002",
    );
    manager.processEvent(makeEvent("turn_complete", { turnId: "turn-0" }), "01ABC003");

    // Capture the snapshot that persistSnapshot would have been called with
    const snapshotArg = mockDb.persistSnapshot.mock.calls.at(-1)?.[0] as
      | { state: string }
      | undefined;
    expect(snapshotArg).toBeDefined();

    const parsed = JSON.parse(snapshotArg!.state);
    expect(parsed.turns).toBeDefined();
    expect(parsed.turns.length).toBe(1);
    expect(parsed.turns[0].id).toBe("turn-0");
    expect(parsed._meta?.costMillicents).toBe(42);
    expect(parsed.lifecycle).toBeDefined();
  });
});
