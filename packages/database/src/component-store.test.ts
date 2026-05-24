import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// Import modules AFTER mock is set up
import * as componentStore from "./component-store.js";
import { sqlite } from "./test-db.js";

/** Apply the schema DDL to the in-memory database. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS components (
      id               TEXT PRIMARY KEY,
      workspace_id     TEXT NOT NULL REFERENCES workspaces(id),
      name             TEXT NOT NULL,
      description      TEXT NOT NULL DEFAULT '',
      renderer_kind    TEXT NOT NULL DEFAULT 'grackle-react',
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

describe("component-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS components");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    seedWorkspace("ws1");
    seedWorkspace("ws2");
  });

  it("registerComponent + getComponent round-trips with defaults", () => {
    componentStore.registerComponent({
      id: "c1",
      workspaceId: "ws1",
      name: "cost-summary",
      body: "render(<div>cost</div>)",
      rendererKind: "grackle-react",
      ownerTaskId: "t1",
      ownerSessionId: "s1",
    });
    const row = componentStore.getComponent("c1");
    expect(row).toBeDefined();
    expect(row!.workspaceId).toBe("ws1");
    expect(row!.name).toBe("cost-summary");
    expect(row!.body).toBe("render(<div>cost</div>)");
    expect(row!.rendererKind).toBe("grackle-react");
    expect(row!.version).toBe(1);
    expect(row!.ownerTaskId).toBe("t1");
    expect(row!.ownerSessionId).toBe("s1");
  });

  it("defaults rendererKind to grackle-react when omitted", () => {
    componentStore.registerComponent({ id: "c1", workspaceId: "ws1", name: "a", body: "render(<i/>)" });
    expect(componentStore.getComponent("c1")!.rendererKind).toBe("grackle-react");
  });

  it("getComponent returns undefined when not found", () => {
    expect(componentStore.getComponent("nope")).toBeUndefined();
  });

  it("findComponentByName resolves within a workspace", () => {
    componentStore.registerComponent({ id: "c1", workspaceId: "ws1", name: "burndown", body: "<a/>" });
    componentStore.registerComponent({ id: "c2", workspaceId: "ws2", name: "burndown", body: "<b/>" });
    const found = componentStore.findComponentByName("ws1", "burndown");
    expect(found?.id).toBe("c1");
    // Same name in a different workspace is isolated.
    expect(componentStore.findComponentByName("ws2", "burndown")?.id).toBe("c2");
    expect(componentStore.findComponentByName("ws1", "missing")).toBeUndefined();
  });

  it("listComponents returns only that workspace's components", () => {
    componentStore.registerComponent({ id: "c1", workspaceId: "ws1", name: "a", body: "x" });
    componentStore.registerComponent({ id: "c2", workspaceId: "ws1", name: "b", body: "y" });
    componentStore.registerComponent({ id: "c3", workspaceId: "ws2", name: "c", body: "z" });
    const ws1 = componentStore.listComponents("ws1");
    expect(ws1.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(componentStore.listComponents("ws2").map((c) => c.id)).toEqual(["c3"]);
  });

  it("updateComponent bumps version and replaces provided fields only", () => {
    componentStore.registerComponent({ id: "c1", workspaceId: "ws1", name: "a", description: "orig", body: "old" });
    const ok = componentStore.updateComponent("c1", { body: "new" });
    expect(ok).toBe(true);
    const row = componentStore.getComponent("c1");
    expect(row!.body).toBe("new");
    expect(row!.description).toBe("orig"); // untouched
    expect(row!.version).toBe(2);
  });

  it("updateComponent returns false for an unknown id", () => {
    expect(componentStore.updateComponent("ghost", { body: "x" })).toBe(false);
  });

  it("deleteComponent removes the row", () => {
    componentStore.registerComponent({ id: "c1", workspaceId: "ws1", name: "a", body: "x" });
    expect(componentStore.deleteComponent("c1")).toBe(true);
    expect(componentStore.getComponent("c1")).toBeUndefined();
    expect(componentStore.deleteComponent("c1")).toBe(false);
  });

  it("rejects a body larger than the size cap", () => {
    const huge = "x".repeat(componentStore.MAX_COMPONENT_BODY_CHARS + 1);
    expect(() => componentStore.registerComponent({ id: "c1", workspaceId: "ws1", name: "a", body: huge })).toThrow(/exceeds/);
  });
});
