import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

import * as scheduleStore from "./schedule-store.js";
import { sqlite } from "./test-db.js";

/** Apply the schema DDL to the in-memory database. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id                  TEXT PRIMARY KEY,
      title               TEXT NOT NULL,
      description         TEXT NOT NULL DEFAULT '',
      schedule_expression TEXT NOT NULL,
      persona_id          TEXT NOT NULL,
      workspace_id        TEXT NOT NULL DEFAULT '',
      parent_task_id      TEXT NOT NULL DEFAULT '',
      enabled             INTEGER NOT NULL DEFAULT 1,
      last_run_at         TEXT,
      next_run_at         TEXT,
      run_count           INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(enabled, next_run_at);
  `);
}

describe("schedule-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS schedules");
    applySchema();
  });

  it("creates and retrieves a schedule", () => {
    scheduleStore.createSchedule(
      "sched-1",
      "Reconciliation",
      "Check stalled tasks",
      "30s",
      "recon-persona",
      "",
      "",
      "2026-03-25T10:00:30Z",
    );
    const s = scheduleStore.getSchedule("sched-1");
    expect(s).toBeDefined();
    expect(s!.title).toBe("Reconciliation");
    expect(s!.description).toBe("Check stalled tasks");
    expect(s!.scheduleExpression).toBe("30s");
    expect(s!.personaId).toBe("recon-persona");
    expect(s!.enabled).toBe(true);
    expect(s!.nextRunAt).toBe("2026-03-25T10:00:30Z");
    expect(s!.runCount).toBe(0);
  });

  it("returns undefined for nonexistent schedule", () => {
    expect(scheduleStore.getSchedule("nope")).toBeUndefined();
  });

  it("lists all schedules", () => {
    scheduleStore.createSchedule("s1", "A", "", "30s", "p1", "", "", null);
    scheduleStore.createSchedule("s2", "B", "", "5m", "p2", "", "", null);
    const all = scheduleStore.listSchedules();
    expect(all).toHaveLength(2);
  });

  it("lists schedules filtered by workspaceId", () => {
    scheduleStore.createSchedule("s1", "A", "", "30s", "p1", "ws-1", "", null);
    scheduleStore.createSchedule("s2", "B", "", "5m", "p2", "ws-2", "", null);
    scheduleStore.createSchedule("s3", "C", "", "1h", "p3", "", "", null);
    const ws1 = scheduleStore.listSchedules("ws-1");
    expect(ws1).toHaveLength(1);
    expect(ws1[0].title).toBe("A");
  });

  it("updates mutable fields", () => {
    scheduleStore.createSchedule("s1", "Original", "", "30s", "p1", "", "", null);
    scheduleStore.updateSchedule("s1", {
      title: "Updated",
      description: "new desc",
      scheduleExpression: "1m",
      personaId: "p2",
      enabled: false,
    });
    const s = scheduleStore.getSchedule("s1");
    expect(s!.title).toBe("Updated");
    expect(s!.description).toBe("new desc");
    expect(s!.scheduleExpression).toBe("1m");
    expect(s!.personaId).toBe("p2");
    expect(s!.enabled).toBe(false);
  });

  it("updates only provided fields", () => {
    scheduleStore.createSchedule("s1", "Keep", "desc", "30s", "p1", "", "", null);
    scheduleStore.updateSchedule("s1", { title: "Changed" });
    const s = scheduleStore.getSchedule("s1");
    expect(s!.title).toBe("Changed");
    expect(s!.description).toBe("desc");
    expect(s!.scheduleExpression).toBe("30s");
  });

  it("deletes a schedule", () => {
    scheduleStore.createSchedule("s1", "A", "", "30s", "p1", "", "", null);
    scheduleStore.deleteSchedule("s1");
    expect(scheduleStore.getSchedule("s1")).toBeUndefined();
  });

  it("getDueSchedules returns enabled schedules with nextRunAt in the past", () => {
    const past = "2020-01-01T00:00:00Z";
    const future = "2099-01-01T00:00:00Z";
    scheduleStore.createSchedule("due", "Due", "", "30s", "p1", "", "", past);
    scheduleStore.createSchedule("not-due", "NotDue", "", "30s", "p2", "", "", future);
    scheduleStore.createSchedule("disabled", "Disabled", "", "30s", "p3", "", "", past);
    scheduleStore.updateSchedule("disabled", { enabled: false });

    const due = scheduleStore.getDueSchedules();
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe("due");
  });

  it("getDueSchedules returns empty when no schedules are due", () => {
    const future = "2099-01-01T00:00:00Z";
    scheduleStore.createSchedule("s1", "A", "", "30s", "p1", "", "", future);
    expect(scheduleStore.getDueSchedules()).toHaveLength(0);
  });

  it("advanceSchedule updates lastRunAt, nextRunAt, and runCount", () => {
    scheduleStore.createSchedule("s1", "A", "", "30s", "p1", "", "", "2026-03-25T10:00:00Z");
    const now = "2026-03-25T10:00:30Z";
    const nextRun = "2026-03-25T10:01:00Z";
    scheduleStore.advanceSchedule("s1", now, nextRun);
    const s = scheduleStore.getSchedule("s1");
    expect(s!.lastRunAt).toBe(now);
    expect(s!.nextRunAt).toBe(nextRun);
    expect(s!.runCount).toBe(1);
  });

  it("advanceSchedule increments runCount cumulatively", () => {
    scheduleStore.createSchedule("s1", "A", "", "30s", "p1", "", "", "2026-03-25T10:00:00Z");
    scheduleStore.advanceSchedule("s1", "2026-03-25T10:00:30Z", "2026-03-25T10:01:00Z");
    scheduleStore.advanceSchedule("s1", "2026-03-25T10:01:00Z", "2026-03-25T10:01:30Z");
    const s = scheduleStore.getSchedule("s1");
    expect(s!.runCount).toBe(2);
  });

  it("setScheduleEnabled enables and sets nextRunAt", () => {
    scheduleStore.createSchedule("s1", "A", "", "30s", "p1", "", "", null);
    scheduleStore.updateSchedule("s1", { enabled: false });
    expect(scheduleStore.getSchedule("s1")!.enabled).toBe(false);

    scheduleStore.setScheduleEnabled("s1", true, "2026-03-25T10:00:30Z");
    const s = scheduleStore.getSchedule("s1");
    expect(s!.enabled).toBe(true);
    expect(s!.nextRunAt).toBe("2026-03-25T10:00:30Z");
  });

  it("setScheduleEnabled disables and clears nextRunAt", () => {
    scheduleStore.createSchedule("s1", "A", "", "30s", "p1", "", "", "2026-03-25T10:00:30Z");
    scheduleStore.setScheduleEnabled("s1", false, null);
    const s = scheduleStore.getSchedule("s1");
    expect(s!.enabled).toBe(false);
    expect(s!.nextRunAt).toBeNull();
  });
});
