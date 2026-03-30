import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// Import modules AFTER mock is set up
import * as escalationStore from "./escalation-store.js";
import { sqlite } from "./test-db.js";

/** Apply the schema DDL to the in-memory database. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      description       TEXT NOT NULL DEFAULT '',
      repo_url          TEXT NOT NULL DEFAULT '',
      environment_id    TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'active',
      use_worktrees     INTEGER NOT NULL DEFAULT 1,
      working_directory TEXT NOT NULL DEFAULT '',
      default_persona_id TEXT NOT NULL DEFAULT '',
      token_budget  INTEGER NOT NULL DEFAULT 0,
      cost_budget_millicents INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS escalations (
      id              TEXT PRIMARY KEY,
      workspace_id    TEXT NOT NULL DEFAULT '',
      task_id         TEXT NOT NULL DEFAULT '',
      title           TEXT NOT NULL,
      message         TEXT NOT NULL DEFAULT '',
      source          TEXT NOT NULL DEFAULT 'explicit',
      urgency         TEXT NOT NULL DEFAULT 'normal',
      status          TEXT NOT NULL DEFAULT 'pending',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      delivered_at    TEXT,
      acknowledged_at TEXT,
      task_url        TEXT NOT NULL DEFAULT ''
    );
  `);
}

/** Seed a workspace so that references make sense. */
function seedWorkspace(id: string): void {
  sqlite.exec(`INSERT OR IGNORE INTO workspaces (id, name) VALUES ('${id}', 'WS ${id}')`);
}

describe("escalation-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS escalations");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    seedWorkspace("ws1");
    seedWorkspace("ws2");
  });

  it("createEscalation inserts a row retrievable by getEscalation", () => {
    escalationStore.createEscalation(
      "esc1", "ws1", "task1", "Need help", "What auth method?", "explicit", "normal", "http://localhost:3000/tasks/task1",
    );
    const row = escalationStore.getEscalation("esc1");
    expect(row).toBeDefined();
    expect(row!.id).toBe("esc1");
    expect(row!.workspaceId).toBe("ws1");
    expect(row!.taskId).toBe("task1");
    expect(row!.title).toBe("Need help");
    expect(row!.message).toBe("What auth method?");
    expect(row!.source).toBe("explicit");
    expect(row!.urgency).toBe("normal");
    expect(row!.status).toBe("pending");
    expect(row!.taskUrl).toBe("http://localhost:3000/tasks/task1");
    expect(row!.deliveredAt).toBeNull();
    expect(row!.acknowledgedAt).toBeNull();
  });

  it("getEscalation returns undefined for non-existent ID", () => {
    expect(escalationStore.getEscalation("nonexistent")).toBeUndefined();
  });

  it("listEscalations returns rows for a workspace ordered by createdAt desc", () => {
    // Insert with explicit timestamps to ensure ordering
    sqlite.exec(`INSERT INTO escalations (id, workspace_id, task_id, title, source, urgency, created_at)
      VALUES ('esc1', 'ws1', 't1', 'First', 'auto', 'normal', '2026-01-01T00:00:00Z')`);
    sqlite.exec(`INSERT INTO escalations (id, workspace_id, task_id, title, source, urgency, created_at)
      VALUES ('esc2', 'ws1', 't2', 'Second', 'auto', 'normal', '2026-01-01T00:01:00Z')`);
    sqlite.exec(`INSERT INTO escalations (id, workspace_id, task_id, title, source, urgency, created_at)
      VALUES ('esc3', 'ws2', 't3', 'Other WS', 'auto', 'normal', '2026-01-01T00:02:00Z')`);

    const results = escalationStore.listEscalations("ws1");
    expect(results).toHaveLength(2);
    // Most recent first
    expect(results[0].id).toBe("esc2");
    expect(results[1].id).toBe("esc1");
  });

  it("listEscalations filters by status when provided", () => {
    escalationStore.createEscalation("esc1", "ws1", "t1", "Pending one", "", "auto", "normal", "");
    escalationStore.createEscalation("esc2", "ws1", "t2", "Delivered one", "", "auto", "normal", "");
    escalationStore.updateEscalationStatus("esc2", "delivered");

    const pending = escalationStore.listEscalations("ws1", "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("esc1");

    const delivered = escalationStore.listEscalations("ws1", "delivered");
    expect(delivered).toHaveLength(1);
    expect(delivered[0].id).toBe("esc2");
  });

  it("listEscalations with empty workspaceId returns all escalations", () => {
    escalationStore.createEscalation("esc1", "ws1", "t1", "WS1", "", "auto", "normal", "");
    escalationStore.createEscalation("esc2", "ws2", "t2", "WS2", "", "auto", "normal", "");

    const results = escalationStore.listEscalations("");
    expect(results).toHaveLength(2);
  });

  it("listPendingEscalations returns only pending rows oldest first", () => {
    escalationStore.createEscalation("esc1", "ws1", "t1", "First", "", "auto", "normal", "");
    escalationStore.createEscalation("esc2", "ws1", "t2", "Second", "", "auto", "normal", "");
    escalationStore.createEscalation("esc3", "ws1", "t3", "Third", "", "auto", "normal", "");
    escalationStore.updateEscalationStatus("esc2", "delivered");

    const pending = escalationStore.listPendingEscalations();
    expect(pending).toHaveLength(2);
    // Oldest first for delivery order
    expect(pending[0].id).toBe("esc1");
    expect(pending[1].id).toBe("esc3");
  });

  it("updateEscalationStatus sets status and deliveredAt timestamp", () => {
    escalationStore.createEscalation("esc1", "ws1", "t1", "Test", "", "auto", "normal", "");
    escalationStore.updateEscalationStatus("esc1", "delivered");

    const row = escalationStore.getEscalation("esc1");
    expect(row!.status).toBe("delivered");
    expect(row!.deliveredAt).toBeTruthy();
  });

  it("updateEscalationStatus to acknowledged sets acknowledgedAt", () => {
    escalationStore.createEscalation("esc1", "ws1", "t1", "Test", "", "auto", "normal", "");
    escalationStore.updateEscalationStatus("esc1", "delivered");
    escalationStore.updateEscalationStatus("esc1", "acknowledged");

    const row = escalationStore.getEscalation("esc1");
    expect(row!.status).toBe("acknowledged");
    expect(row!.acknowledgedAt).toBeTruthy();
  });

  it("createEscalation defaults status to pending and urgency to normal", () => {
    escalationStore.createEscalation("esc1", "ws1", "t1", "Defaults test", "", "explicit", "normal", "");
    const row = escalationStore.getEscalation("esc1");
    expect(row!.status).toBe("pending");
    expect(row!.urgency).toBe("normal");
  });

  it("listEscalations respects limit", () => {
    for (let i = 0; i < 5; i++) {
      escalationStore.createEscalation(`esc${i}`, "ws1", `t${i}`, `Esc ${i}`, "", "auto", "normal", "");
    }
    const results = escalationStore.listEscalations("ws1", undefined, 2);
    expect(results).toHaveLength(2);
  });
});
