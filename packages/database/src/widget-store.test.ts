import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// Import modules AFTER mock is set up
import * as widgetStore from "./widget-store.js";
import { sqlite } from "./test-db.js";

/** Apply the schema DDL to the in-memory database. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS widgets (
      id               TEXT PRIMARY KEY,
      workspace_id     TEXT NOT NULL REFERENCES workspaces(id),
      name             TEXT NOT NULL,
      description      TEXT NOT NULL DEFAULT '',
      renderer_kind    TEXT NOT NULL DEFAULT 'mcp-app-html',
      body             TEXT NOT NULL,
      props_schema     TEXT NOT NULL DEFAULT '',
      version          INTEGER NOT NULL DEFAULT 1,
      owner_task_id    TEXT NOT NULL DEFAULT '',
      owner_session_id TEXT NOT NULL DEFAULT '',
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/** Seed a workspace so that FK references succeed. */
function seedWorkspace(id: string): void {
  sqlite.exec(`INSERT OR IGNORE INTO workspaces (id, name) VALUES ('${id}', 'WS ${id}')`);
}

describe("widget-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS widgets");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    seedWorkspace("ws1");
    seedWorkspace("ws2");
  });

  it("registerWidget + getWidget round-trips with defaults", () => {
    widgetStore.registerWidget({
      id: "w1",
      workspaceId: "ws1",
      name: "cost-summary",
      body: "<div>cost</div>",
      ownerTaskId: "t1",
      ownerSessionId: "s1",
    });
    const row = widgetStore.getWidget("w1");
    expect(row).toBeDefined();
    expect(row!.workspaceId).toBe("ws1");
    expect(row!.name).toBe("cost-summary");
    expect(row!.body).toBe("<div>cost</div>");
    expect(row!.rendererKind).toBe("mcp-app-html");
    expect(row!.version).toBe(1);
    expect(row!.ownerTaskId).toBe("t1");
    expect(row!.ownerSessionId).toBe("s1");
  });

  it("getWidget returns undefined when not found", () => {
    expect(widgetStore.getWidget("nope")).toBeUndefined();
  });

  it("findWidgetByName resolves within a workspace", () => {
    widgetStore.registerWidget({ id: "w1", workspaceId: "ws1", name: "burndown", body: "<a/>" });
    widgetStore.registerWidget({ id: "w2", workspaceId: "ws2", name: "burndown", body: "<b/>" });
    const found = widgetStore.findWidgetByName("ws1", "burndown");
    expect(found?.id).toBe("w1");
    // Same name in a different workspace is isolated.
    expect(widgetStore.findWidgetByName("ws2", "burndown")?.id).toBe("w2");
    expect(widgetStore.findWidgetByName("ws1", "missing")).toBeUndefined();
  });

  it("listWidgets returns only that workspace's widgets", () => {
    widgetStore.registerWidget({ id: "w1", workspaceId: "ws1", name: "a", body: "x" });
    widgetStore.registerWidget({ id: "w2", workspaceId: "ws1", name: "b", body: "y" });
    widgetStore.registerWidget({ id: "w3", workspaceId: "ws2", name: "c", body: "z" });
    const ws1 = widgetStore.listWidgets("ws1");
    expect(ws1.map((w) => w.id).sort()).toEqual(["w1", "w2"]);
    expect(widgetStore.listWidgets("ws2").map((w) => w.id)).toEqual(["w3"]);
  });

  it("updateWidget bumps version and replaces provided fields only", () => {
    widgetStore.registerWidget({ id: "w1", workspaceId: "ws1", name: "a", description: "orig", body: "old" });
    const ok = widgetStore.updateWidget("w1", { body: "new" });
    expect(ok).toBe(true);
    const row = widgetStore.getWidget("w1");
    expect(row!.body).toBe("new");
    expect(row!.description).toBe("orig"); // untouched
    expect(row!.version).toBe(2);
  });

  it("updateWidget returns false for an unknown id", () => {
    expect(widgetStore.updateWidget("ghost", { body: "x" })).toBe(false);
  });

  it("deleteWidget removes the row", () => {
    widgetStore.registerWidget({ id: "w1", workspaceId: "ws1", name: "a", body: "x" });
    expect(widgetStore.deleteWidget("w1")).toBe(true);
    expect(widgetStore.getWidget("w1")).toBeUndefined();
    expect(widgetStore.deleteWidget("w1")).toBe(false);
  });

  it("rejects a body larger than the size cap", () => {
    const huge = "x".repeat(widgetStore.MAX_WIDGET_BODY_CHARS + 1);
    expect(() => widgetStore.registerWidget({ id: "w1", workspaceId: "ws1", name: "a", body: huge })).toThrow(/exceeds/);
  });
});
