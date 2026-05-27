/**
 * Round-trip tests for `SessionStateManager.reconstruct()`.
 *
 * These tests exercise the full processEvent → snapshot → reconstruct pipeline
 * using an in-memory `SessionStore` — no mocks, no SQLite, no external deps.
 * They validate that `reconstruct()` produces state equal to the live `getState()`
 * after the same sequence of events, covering both delta-replay and full-replay paths.
 */

import { describe, it, expect } from "vitest";
import type { powerline } from "@grackle-ai/common";
import { SessionStateManager, type SessionStore } from "./ahp-session-state.js";
import type {
  SessionActionQuery,
  SessionActionRow,
  SessionSnapshotRow,
  SnapshotRecord,
} from "@grackle-ai/database";

// ─── MemorySessionStore ─────────────────────────────────────────────────────

/**
 * Pure in-memory implementation of `SessionStore` for testing.
 * Mirrors the real SQLite store semantics (composite-PK upsert,
 * DESC seq ordering for querySnapshot, ASC for querySessionActions).
 */
class MemorySessionStore implements SessionStore {
  private snapshots: SessionSnapshotRow[] = [];
  readonly actions: SessionActionRow[] = [];

  persistSnapshot(record: SnapshotRecord): void {
    const row: SessionSnapshotRow = {
      sessionId: record.sessionId,
      seq: record.seq,
      snapshotAt: record.snapshotAt,
      state: record.state,
      mapperContext: record.mapperContext ?? null,
    };
    const idx = this.snapshots.findIndex(
      (s) => s.sessionId === record.sessionId && s.seq === record.seq,
    );
    if (idx >= 0) {
      this.snapshots[idx] = row;
    } else {
      this.snapshots.push(row);
    }
  }

  querySnapshot(sessionId: string, limit = 10): SessionSnapshotRow[] {
    return this.snapshots
      .filter((s) => s.sessionId === sessionId)
      .sort((a, b) => b.seq.localeCompare(a.seq))
      .slice(0, limit);
  }

  querySessionActions({ sessionId, fromSeq, limit = 500 }: SessionActionQuery): SessionActionRow[] {
    return this.actions
      .filter((a) => a.sessionId === sessionId && (!fromSeq || a.seq > fromSeq))
      .sort((a, b) => a.seq.localeCompare(b.seq))
      .slice(0, Math.min(limit, 5000));
  }

  /** Record a session action (mirrors what event-processor.ts does via recordSessionAction). */
  recordAction(row: SessionActionRow): void {
    this.actions.push(row);
  }
}

// ─── Test helpers ───────────────────────────────────────────────────────────

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

interface EventSpec {
  seq: string;
  type: powerline.AgentEvent["type"];
  content?: string;
  turnId?: string;
  toolCallId?: string;
}

/**
 * Drive a `SessionStateManager` through a sequence of events, recording each
 * one to the store to simulate what `event-processor.ts` does.
 */
function drive(manager: SessionStateManager, store: MemorySessionStore, events: EventSpec[]): void {
  for (const spec of events) {
    store.recordAction({
      seq: spec.seq,
      sessionId: "sess",
      type: spec.type,
      content: spec.content ?? "",
      raw: "",
      timestamp: new Date().toISOString(),
      toolCallId: spec.toolCallId ?? "",
      turnId: spec.turnId ?? "",
      diagnostic: false,
    });
    manager.processEvent(
      makeEvent(spec.type, {
        content: spec.content,
        turnId: spec.turnId,
        toolCallId: spec.toolCallId,
      }),
      spec.seq,
    );
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("SessionStateManager.reconstruct() — round-trip", () => {
  it("delta replay: reconstructed state matches live state after one turn", () => {
    const store = new MemorySessionStore();
    const manager = new SessionStateManager("sess", { store });

    drive(manager, store, [
      {
        seq: "01A",
        type: "turn_started",
        content: JSON.stringify({ user_message: "Hello" }),
        turnId: "t0",
      },
      { seq: "01B", type: "text", content: "Response text", turnId: "t0" },
      { seq: "01C", type: "usage", content: JSON.stringify({ cost_millicents: 250 }) },
      { seq: "01D", type: "turn_complete", turnId: "t0" },
      // turn_complete auto-snapshots — snapshot is at seq "01D"
    ]);

    const live = manager.getState();
    const reconstructed = SessionStateManager.reconstruct("sess", store);

    // Structural equality
    expect(reconstructed.turns.length).toBe(1);
    expect(reconstructed.turns[0].id).toBe(live.turns[0].id);
    expect(reconstructed.turns[0].userMessage.text).toBe("Hello");
    expect(reconstructed.activeTurn).toBeUndefined();
    expect(reconstructed._meta?.costMillicents).toBe(250);
  });

  it("delta replay: events after snapshot are replayed onto snapshot baseline", () => {
    const store = new MemorySessionStore();
    const manager = new SessionStateManager("sess", { store });
    manager.snapshotThreshold = 1000; // prevent count-based flush

    // First turn — turn_complete triggers snapshot at "01D"
    drive(manager, store, [
      {
        seq: "01A",
        type: "turn_started",
        content: JSON.stringify({ user_message: "First" }),
        turnId: "t0",
      },
      { seq: "01B", type: "text", content: "First response", turnId: "t0" },
      { seq: "01D", type: "turn_complete", turnId: "t0" },
    ]);

    // Delta events after the snapshot
    drive(manager, store, [
      {
        seq: "01E",
        type: "turn_started",
        content: JSON.stringify({ user_message: "Second" }),
        turnId: "t1",
      },
      { seq: "01F", type: "text", content: "Second response", turnId: "t1" },
    ]);

    const live = manager.getState();
    const reconstructed = SessionStateManager.reconstruct("sess", store);

    // Snapshot captured completed turn-0; delta added in-progress turn-1
    expect(reconstructed.turns.length).toBe(1);
    expect(reconstructed.turns[0].id).toBe("t0");
    expect(reconstructed.activeTurn?.id).toBe(live.activeTurn?.id);
    expect(reconstructed.activeTurn?.responseParts.length).toBe(
      live.activeTurn?.responseParts.length,
    );
  });

  it("full replay: produces correct state when no snapshot exists", () => {
    const store = new MemorySessionStore();
    const manager = new SessionStateManager("sess", { store });
    manager.snapshotThreshold = 0; // disables count-based flush; no turn_complete → no snapshot

    drive(manager, store, [
      {
        seq: "01A",
        type: "turn_started",
        content: JSON.stringify({ user_message: "Hi" }),
        turnId: "t0",
      },
      { seq: "01B", type: "text", content: "Hello back", turnId: "t0" },
    ]);

    // No snapshot was written (threshold=0, no turn_complete)
    expect(store.querySnapshot("sess")).toHaveLength(0);

    const live = manager.getState();
    const reconstructed = SessionStateManager.reconstruct("sess", store);

    // Full replay from all session_actions
    expect(reconstructed.activeTurn?.id).toBe(live.activeTurn?.id);
    expect(reconstructed.activeTurn?.responseParts.length).toBe(1);
  });

  it("tool call pairing: toolCallId and turnId correctly thread through reconstruction", () => {
    const store = new MemorySessionStore();
    const manager = new SessionStateManager("sess", { store });
    manager.snapshotThreshold = 1000;

    drive(manager, store, [
      {
        seq: "01A",
        type: "turn_started",
        content: JSON.stringify({ user_message: "Run" }),
        turnId: "t0",
      },
      {
        seq: "01B",
        type: "tool_use",
        content: JSON.stringify({ tool_name: "bash", display_name: "Bash" }),
        turnId: "t0",
        toolCallId: "tc-explicit",
      },
      {
        seq: "01C",
        type: "tool_result",
        content: JSON.stringify({ is_ok: true, content: "output" }),
        turnId: "t0",
        toolCallId: "tc-explicit",
      },
      { seq: "01D", type: "turn_complete", turnId: "t0" },
    ]);

    const live = manager.getState();
    const reconstructed = SessionStateManager.reconstruct("sess", store);

    // The completed turn should be present in both
    expect(reconstructed.turns.length).toBe(1);
    expect(reconstructed.turns[0].id).toBe(live.turns[0].id);
    // No open tool calls after turn_complete
    expect(reconstructed.activeTurn).toBeUndefined();
  });

  it("cost accumulates correctly across full replay", () => {
    const store = new MemorySessionStore();
    const manager = new SessionStateManager("sess", { store });
    manager.snapshotThreshold = 0; // force full replay path

    drive(manager, store, [
      {
        seq: "01A",
        type: "turn_started",
        content: JSON.stringify({ user_message: "Q" }),
        turnId: "t0",
      },
      { seq: "01B", type: "usage", content: JSON.stringify({ cost_millicents: 100 }) },
      { seq: "01C", type: "usage", content: JSON.stringify({ cost_millicents: 75 }) },
    ]);

    const reconstructed = SessionStateManager.reconstruct("sess", store);
    expect(reconstructed._meta?.costMillicents).toBe(175);
  });
});
