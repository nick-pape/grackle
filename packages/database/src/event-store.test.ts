import { describe, it, expect, beforeEach, vi } from "vitest";

// Replace the production db module with the in-memory test db before imports.
vi.mock("./db.js", async () => await import("./test-db.js"));

import { sqlite } from "./test-db.js";
import { persistEvent, queryDomainEvents } from "./event-store.js";

/** Create the domain_events table (mirrors db.ts baseline + indexes). */
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

/** Seed a domain event with explicit id/type/timestamp. */
function seed(id: string, type: string, timestamp: string): void {
  persistEvent({ id, type, timestamp, payload: { marker: id } });
}

describe("queryDomainEvents", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS domain_events");
    applySchema();
  });

  it("returns events most recent first (id descending), regardless of insertion order", () => {
    seed("01C", "task.updated", "2026-05-23T03:00:00.000Z");
    seed("01A", "task.created", "2026-05-23T01:00:00.000Z");
    seed("01B", "task.updated", "2026-05-23T02:00:00.000Z");

    const ids = queryDomainEvents().map((e) => e.id);
    expect(ids).toEqual(["01C", "01B", "01A"]);
  });

  it("beforeId returns only older events (exclusive), newest first", () => {
    seed("01A", "task.created", "2026-05-23T01:00:00.000Z");
    seed("01B", "task.created", "2026-05-23T02:00:00.000Z");
    seed("01C", "task.created", "2026-05-23T03:00:00.000Z");

    expect(queryDomainEvents({ beforeId: "01C" }).map((e) => e.id)).toEqual(["01B", "01A"]);
    expect(queryDomainEvents({ beforeId: "01A" })).toEqual([]);
  });

  it("filters by exact type", () => {
    seed("01A", "task.created", "2026-05-23T01:00:00.000Z");
    seed("01B", "workspace.created", "2026-05-23T02:00:00.000Z");
    seed("01C", "task.created", "2026-05-23T03:00:00.000Z");

    expect(queryDomainEvents({ type: "task.created" }).map((e) => e.id)).toEqual(["01C", "01A"]);
  });

  it("filters by since/until timestamp range (inclusive)", () => {
    seed("01A", "task.created", "2026-05-23T01:00:00.000Z");
    seed("01B", "task.created", "2026-05-23T02:00:00.000Z");
    seed("01C", "task.created", "2026-05-23T03:00:00.000Z");

    const ids = queryDomainEvents({
      since: "2026-05-23T02:00:00.000Z",
      until: "2026-05-23T02:59:59.999Z",
    }).map((e) => e.id);
    expect(ids).toEqual(["01B"]);
  });

  it("caps results at the requested limit, most recent first", () => {
    seed("01A", "task.created", "2026-05-23T01:00:00.000Z");
    seed("01B", "task.created", "2026-05-23T02:00:00.000Z");
    seed("01C", "task.created", "2026-05-23T03:00:00.000Z");
    seed("01D", "task.created", "2026-05-23T04:00:00.000Z");

    expect(queryDomainEvents({ limit: 2 }).map((e) => e.id)).toEqual(["01D", "01C"]);
  });

  it("round-trips the persisted payload as a JSON string", () => {
    seed("01A", "task.created", "2026-05-23T01:00:00.000Z");
    const [row] = queryDomainEvents();
    expect(JSON.parse(row.payload)).toEqual({ marker: "01A" });
  });
});
