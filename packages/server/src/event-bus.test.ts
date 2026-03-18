import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock dependencies before importing ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { emit, subscribe, _resetForTesting, type GrackleEvent } from "./event-bus.js";
import { sqlite } from "./test-db.js";

/** Apply the minimal schema needed for event-bus tests. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS domain_events (
      id        TEXT PRIMARY KEY,
      type      TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      payload   TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_domain_events_type ON domain_events(type);
    CREATE INDEX IF NOT EXISTS idx_domain_events_timestamp ON domain_events(timestamp);
  `);
}

describe("event-bus", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS domain_events");
    applySchema();
    _resetForTesting();
    vi.clearAllMocks();
  });

  describe("emit()", () => {
    it("returns a well-formed GrackleEvent", () => {
      const event = emit("project.created", { projectId: "p1" });
      expect(event.id).toBeDefined();
      expect(event.id.length).toBeGreaterThan(0);
      expect(event.type).toBe("project.created");
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(event.payload).toEqual({ projectId: "p1" });
    });

    it("generates unique IDs for rapid emits", () => {
      const events: GrackleEvent[] = [];
      for (let i = 0; i < 10; i++) {
        events.push(emit("task.created", { taskId: `t${i}`, projectId: "p1" }));
      }
      const ids = new Set(events.map((e) => e.id));
      expect(ids.size).toBe(10);
    });

    it("persists event to SQLite domain_events table", () => {
      const event = emit("persona.created", { personaId: "per1" });
      const row = sqlite.prepare("SELECT * FROM domain_events WHERE id = ?").get(event.id) as {
        id: string;
        type: string;
        timestamp: string;
        payload: string;
      };
      expect(row).toBeDefined();
      expect(row.type).toBe("persona.created");
      expect(row.timestamp).toBe(event.timestamp);
      expect(JSON.parse(row.payload)).toEqual({ personaId: "per1" });
    });
  });

  describe("subscribe()", () => {
    it("receives emitted events asynchronously", async () => {
      const received: GrackleEvent[] = [];
      subscribe((event) => { received.push(event); });

      emit("task.updated", { taskId: "t1", projectId: "p1" });

      // Wait for queueMicrotask to fire
      await new Promise((r) => setTimeout(r, 10));
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe("task.updated");
    });

    it("delivers to multiple subscribers", async () => {
      const received1: GrackleEvent[] = [];
      const received2: GrackleEvent[] = [];
      subscribe((e) => { received1.push(e); });
      subscribe((e) => { received2.push(e); });

      emit("project.archived", { projectId: "p1" });

      await new Promise((r) => setTimeout(r, 10));
      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });

    it("returns an unsubscribe function that stops delivery", async () => {
      const received: GrackleEvent[] = [];
      const unsub = subscribe((e) => { received.push(e); });

      emit("task.created", { taskId: "t1", projectId: "p1" });
      await new Promise((r) => setTimeout(r, 10));
      expect(received).toHaveLength(1);

      unsub();
      emit("task.deleted", { taskId: "t1", projectId: "p1" });
      await new Promise((r) => setTimeout(r, 10));
      expect(received).toHaveLength(1);
    });

    it("subscriber that throws does not affect other subscribers", async () => {
      const received: GrackleEvent[] = [];
      subscribe(() => { throw new Error("boom"); });
      subscribe((e) => { received.push(e); });

      emit("finding.posted", { projectId: "p1", findingId: "f1" });

      await new Promise((r) => setTimeout(r, 10));
      expect(received).toHaveLength(1);
    });
  });

  describe("_resetForTesting()", () => {
    it("clears all subscribers", async () => {
      const received: GrackleEvent[] = [];
      subscribe((e) => { received.push(e); });

      _resetForTesting();

      emit("token.changed", {});
      await new Promise((r) => setTimeout(r, 10));
      expect(received).toHaveLength(0);
    });
  });
});
