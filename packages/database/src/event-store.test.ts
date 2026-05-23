import { describe, it, expect, beforeEach } from "vitest";
import type { Sequenced } from "@grackle-ai/common";
import { openDatabase, initDatabase, sqlite as _sqlite } from "./db.js";
import { DomainEventSink, DOMAIN_EVENT_CHANNEL, type DomainEventInput } from "./event-store.js";

openDatabase(":memory:");
initDatabase();
const sqlite = _sqlite!;

/** Row shape of a raw SELECT on the domain_events table. */
interface DomainEventRow {
  id: string;
  type: string;
  timestamp: string;
  payload: string;
}

describe("DomainEventSink", () => {
  beforeEach(() => {
    sqlite.exec("DELETE FROM domain_events");
  });

  it("persists a sequenced event, using seq as the row id", () => {
    const sink = new DomainEventSink();
    const entry: Sequenced<DomainEventInput> = {
      seq: "01J000000000000000000SEQ1",
      payload: {
        type: "task.created",
        timestamp: "2026-05-23T00:00:00.000Z",
        payload: { taskId: "t1" },
      },
    };

    sink.append(DOMAIN_EVENT_CHANNEL, entry);

    const row = sqlite.prepare("SELECT * FROM domain_events WHERE id = ?").get(entry.seq) as DomainEventRow;
    expect(row).toBeDefined();
    expect(row.id).toBe(entry.seq);
    expect(row.type).toBe("task.created");
    expect(row.timestamp).toBe("2026-05-23T00:00:00.000Z");
    expect(JSON.parse(row.payload)).toEqual({ taskId: "t1" });
  });

  it("rejects an unexpected channel id", () => {
    const sink = new DomainEventSink();
    expect(() =>
      sink.append("not-domain", {
        seq: "x",
        payload: { type: "task.created", timestamp: "2026-05-23T00:00:00.000Z", payload: {} },
      }),
    ).toThrow(/unexpected channel/);
  });

  it("stores rows whose ascending seq order matches insertion order", () => {
    const sink = new DomainEventSink();
    for (const seq of ["01A", "01B", "01C"]) {
      sink.append(DOMAIN_EVENT_CHANNEL, {
        seq,
        payload: { type: "task.updated", timestamp: "2026-05-23T02:00:00.000Z", payload: { seq } },
      });
    }

    const ids = (sqlite.prepare("SELECT id FROM domain_events ORDER BY id").all() as Array<{ id: string }>)
      .map((r) => r.id);
    expect(ids).toEqual(["01A", "01B", "01C"]);
  });
});
