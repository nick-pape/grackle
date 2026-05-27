/**
 * Tests for `SessionStateManager` — mapper + reducer + snapshot pipeline.
 *
 * Each test creates an isolated in-memory `SessionStore` (via `makeTestStore`)
 * and injects it into the manager. No module-level mocks are needed.
 *
 * Tests cover:
 * 1. Event processing through mapper → reducer
 * 2. Context mutation tracking
 * 3. Snapshot threshold flushing
 * 4. Turn-complete auto-flushing
 * 5. getState() returns deep-cloned state
 * 6. clear() resets state
 * 7. reconstruct() wiring (round-trip correctness is in ahp-reconstruct.test.ts)
 */

import { describe, it, expect, vi } from "vitest";
import type { powerline } from "@grackle-ai/common";
import { SessionStateManager, type SessionStore } from "./ahp-session-state.js";

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

/** Creates a fresh `SessionStore` with vi.fn() stubs for each test. */
function makeTestStore(overrides?: Partial<SessionStore>): SessionStore {
  return {
    persistSnapshot: vi.fn(),
    querySnapshot: vi.fn(() => []),
    querySessionActions: vi.fn(() => []),
    ...overrides,
  };
}

describe("SessionStateManager", () => {
  // ─── Event processing ──────────────────────────────────────────

  it("creates initial minimal state", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
    const state = manager.getState();
    expect(state.lifecycle).toBe("creating");
    expect(state.turns).toEqual([]);
  });

  it("processes turn_started and creates active turn", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Hello" }),
      }),
      "0",
    );

    const state = manager.getState();
    expect(state.activeTurn).toBeDefined();
    expect(state.activeTurn?.id).toBe("turn-0");
    expect(state.activeTurn?.userMessage.text).toBe("Hello");
  });

  it("processes text and adds response part", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );
    manager.processEvent(makeEvent("text", { content: "Response text" }), "1");

    const state = manager.getState();
    expect(state.activeTurn?.responseParts.length).toBe(1);
    expect(state.activeTurn?.responseParts[0]).toMatchObject({
      kind: "markdown",
      content: "Response text",
    });
  });

  it("processes tool_use and adds tool call", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
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
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
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

    expect(manager.getState().activeTurn).toBeDefined();
  });

  it("processes turn_complete and moves active turn to turns array", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
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
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
    manager.processEvent(makeEvent("input_needed"), "0");
    expect(manager.getState().turns).toEqual([]);
  });

  it("carries usage cost into _meta", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );
    manager.processEvent(
      makeEvent("usage", { content: JSON.stringify({ cost_millicents: 50 }) }),
      "1",
    );
    expect(manager.getState()._meta?.costMillicents).toBe(50);
  });

  it("carries runtime_session_id into _meta", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
    manager.processEvent(makeEvent("runtime_session_id", { content: "runtime-abc" }), "0");
    expect(manager.getState()._meta?.runtimeSessionId).toBe("runtime-abc");
  });

  it("drops system diagnostic events", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
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

  it("flushes snapshot when threshold is reached", () => {
    const store = makeTestStore();
    const manager = new SessionStateManager("session-001", { store });
    manager.snapshotThreshold = 5;

    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );
    for (let i = 0; i < 5; i++) {
      manager.processEvent(makeEvent("text", { content: `Event ${i}` }), `${i + 1}`);
    }
    expect(manager.getState().activeTurn?.responseParts.length).toBe(5);
  });

  it("does not flush snapshot below threshold", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
    manager.snapshotThreshold = 10;

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
    expect(manager.getState().activeTurn?.responseParts.length).toBe(3);
  });

  it("resets action counter after snapshot flush", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
    manager.snapshotThreshold = 3;

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
    manager.processEvent(makeEvent("text", { content: "Event 3" }), "4");
    manager.processEvent(makeEvent("text", { content: "Event 4" }), "5");

    expect(manager.getState().activeTurn?.responseParts.length).toBe(5);
  });

  // ─── Turn-complete auto-flush ──────────────────────────────────

  it("auto-flushes on turn_complete", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
    manager.snapshotThreshold = 1000;

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
  });

  // ─── getState ──────────────────────────────────────────────────

  it("getState returns current state", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Hello" }),
      }),
      "0",
    );
    expect(manager.getState().activeTurn?.id).toBe("turn-0");
  });

  // ─── clear ─────────────────────────────────────────────────────

  it("clear resets state to initial", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
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
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-abc",
        content: JSON.stringify({ user_message: "Hello" }),
      }),
      "0",
    );
    expect(manager.getContext().turnId).toBe("turn-abc");
  });

  it("tracks openToolCalls in context", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
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
    expect(manager.getContext().openToolCalls).toEqual(["tc-1"]);
  });

  // ─── reconstruct() — wiring tests (round-trip is in ahp-reconstruct.test.ts) ──

  it("returns initial state when no snapshot and no actions", () => {
    const store = makeTestStore();
    const state = SessionStateManager.reconstruct("session-empty", store);
    expect(state.lifecycle).toBe("creating");
    expect(state.turns).toEqual([]);
  });

  it("replays delta actions using stored MapperContext", () => {
    const snapshotCtx = {
      turnId: undefined,
      openToolCalls: [],
      partCounter: 0,
      metaAccumulator: {},
    };
    const store = makeTestStore({
      querySnapshot: vi.fn(() => [
        {
          sessionId: "session-delta",
          seq: "01AAA",
          snapshotAt: "2026-05-27T00:00:00Z",
          state: JSON.stringify({
            lifecycle: "creating",
            turns: [{ id: "turn-0", userMessage: { text: "Hello" }, responseParts: [] }],
            summary: {
              resource: "ahp-session:session-delta",
              provider: "grackle",
              title: "",
              status: "idle",
              createdAt: 0,
              modifiedAt: 0,
            },
          }),
          mapperContext: JSON.stringify(snapshotCtx),
        },
      ]),
      querySessionActions: vi.fn(() => [
        {
          seq: "01AAB",
          sessionId: "session-delta",
          type: "turn_started",
          content: JSON.stringify({ user_message: "Second prompt" }),
          raw: "",
          timestamp: "2026-05-27T00:00:01Z",
          toolCallId: "",
          turnId: "turn-1",
        },
      ]),
    });

    const state = SessionStateManager.reconstruct("session-delta", store);
    expect(state.activeTurn).toBeDefined();
    expect(state.activeTurn?.id).toBe("turn-1");
  });

  it("falls back to full replay when snapshot has no mapperContext", () => {
    const oldState = {
      lifecycle: "creating",
      turns: [],
      summary: {
        resource: "ahp-session:session-old",
        provider: "grackle",
        title: "",
        status: "idle",
        createdAt: 0,
        modifiedAt: 0,
      },
    };
    const store = makeTestStore({
      querySnapshot: vi.fn(() => [
        {
          sessionId: "session-old",
          seq: "01AAA",
          snapshotAt: "2026-05-27T00:00:00Z",
          state: JSON.stringify(oldState),
          mapperContext: null,
        },
      ]),
      querySessionActions: vi.fn(() => [
        {
          seq: "01AAB",
          sessionId: "session-old",
          type: "turn_started",
          content: JSON.stringify({ user_message: "Full replay prompt" }),
          raw: "",
          timestamp: "2026-05-27T00:00:01Z",
          toolCallId: "",
          turnId: "turn-full",
        },
      ]),
    });

    const state = SessionStateManager.reconstruct("session-old", store);
    expect(state.activeTurn?.id).toBe("turn-full");
  });

  // ─── Deep copy (getState) ──────────────────────────────────────

  it("getState returns a deep copy — mutating state.turns.push does not affect manager", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );
    manager.processEvent(makeEvent("text", { content: "Response" }), "1");
    manager.processEvent(makeEvent("turn_complete", { turnId: "turn-0" }), "2");

    const state1 = structuredClone(manager.getState());
    state1.turns.push(state1.turns[0]);

    const state2 = manager.getState();
    expect(state2.turns.length).toBe(1);
  });

  // ─── Distinct turn IDs ─────────────────────────────────────────

  it("two sequential turns without turnId get distinct IDs", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });

    manager.processEvent(
      makeEvent("turn_started", { content: JSON.stringify({ user_message: "First turn" }) }),
      "0",
    );
    manager.processEvent(makeEvent("text", { content: "Response A" }), "1");
    manager.processEvent(makeEvent("turn_complete", {}), "2");

    manager.processEvent(
      makeEvent("turn_started", { content: JSON.stringify({ user_message: "Second turn" }) }),
      "3",
    );
    manager.processEvent(makeEvent("text", { content: "Response B" }), "4");
    manager.processEvent(makeEvent("turn_complete", {}), "5");

    const state = manager.getState();
    expect(state.turns.length).toBe(2);
    expect(state.turns[0].id).toBe("turn-0");
    expect(state.turns[1].id).toBe("turn-3");
  });

  // ─── snapshotThreshold = 0 ─────────────────────────────────────

  it("snapshotThreshold=0 disables count-based flush but turn_complete still flushes", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
    manager.snapshotThreshold = 0;

    manager.processEvent(
      makeEvent("turn_started", { content: JSON.stringify({ user_message: "Prompt" }) }),
      "0",
    );
    for (let i = 0; i < 20; i++) {
      const lastSeq = manager.processEvent(makeEvent("text", { content: `Item ${i}` }), `${i}`);
      expect(lastSeq).toBe(undefined);
    }
    manager.processEvent(makeEvent("turn_complete", { turnId: "turn-0" }), "20");

    const state = manager.getState();
    expect(state.activeTurn).toBeUndefined();
    expect(state.turns.length).toBe(1);
  });

  // ─── Duplicate snapshot() ──────────────────────────────────────

  it("calling snapshot() twice with the same seq does not crash", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });
    manager.snapshotThreshold = 1000;

    manager.processEvent(
      makeEvent("turn_started", {
        turnId: "turn-0",
        content: JSON.stringify({ user_message: "Prompt" }),
      }),
      "0",
    );
    manager.processEvent(makeEvent("text", { content: "Response" }), "1");

    manager.snapshot("dup-1");
    manager.snapshot("dup-1");

    expect(manager.getState().activeTurn?.responseParts.length).toBe(1);
  });

  // ─── Injected prompt dedup ──────────────────────────────────────

  it("skips runtime turn_started when prompt was injected", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });

    manager.processEvent(
      makeEvent("turn_started", { content: JSON.stringify({ user_message: "Injected prompt" }) }),
      "0",
    );
    manager.markInjectedInitialTurn();

    manager.processEvent(
      makeEvent("turn_started", { content: JSON.stringify({ user_message: "Runtime prompt" }) }),
      "1",
    );

    const state = manager.getState();
    expect(state.turns.length).toBe(0);
    expect(state.activeTurn).toBeDefined();
    expect(state.activeTurn?.responseParts.length).toBe(0);
  });

  // ─── Error mid-turn ────────────────────────────────────────────

  it("error event mid-turn ends the turn, subsequent text is dropped", () => {
    const manager = new SessionStateManager("session-001", { store: makeTestStore() });

    manager.processEvent(
      makeEvent("turn_started", { content: JSON.stringify({ user_message: "Prompt" }) }),
      "0",
    );
    manager.processEvent(makeEvent("text", { content: "Partial response" }), "1");
    manager.processEvent(makeEvent("error", { content: "Something failed" }), "2");
    manager.processEvent(makeEvent("text", { content: "After error" }), "3");

    const state = manager.getState();
    expect(state.activeTurn).toBeUndefined();
    expect(state.turns.length).toBe(1);
    expect(state.turns[0].state).toBe("error");
    expect(state.turns[0].responseParts.length).toBe(1);
    expect(state.turns[0].responseParts[0]).toMatchObject({
      kind: "markdown",
      content: "Partial response",
    });
  });

  // ─── snapshot() content ────────────────────────────────────────

  it("snapshot() serializes turns and _meta, and includes mapperContext", () => {
    const store = makeTestStore();
    const manager = new SessionStateManager("session-snap", { store });
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

    // persistSnapshot is called by auto-flush on turn_complete
    const call = (store.persistSnapshot as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
      | { state: string; mapperContext?: string }
      | undefined;
    expect(call).toBeDefined();

    const parsed = JSON.parse(call!.state);
    expect(parsed.turns.length).toBe(1);
    expect(parsed.turns[0].id).toBe("turn-0");
    expect(parsed._meta?.costMillicents).toBe(42);

    // mapperContext is stored alongside state
    expect(call!.mapperContext).toBeDefined();
    const ctx = JSON.parse(call!.mapperContext!);
    expect(ctx.turnId).toBeUndefined();
    expect(ctx.openToolCalls).toEqual([]);
  });
});
