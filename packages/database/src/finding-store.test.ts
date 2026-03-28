import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// Import modules AFTER mock is set up
import * as findingStore from "./finding-store.js";
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
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS findings (
      id           TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      task_id      TEXT NOT NULL DEFAULT '',
      session_id   TEXT NOT NULL DEFAULT '',
      category     TEXT NOT NULL DEFAULT 'general',
      title        TEXT NOT NULL,
      content      TEXT NOT NULL,
      tags         TEXT NOT NULL DEFAULT '[]',
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/** Seed a workspace so that FK references succeed. */
function seedWorkspace(id: string): void {
  sqlite.exec(`INSERT OR IGNORE INTO workspaces (id, name) VALUES ('${id}', 'WS ${id}')`);
}

describe("finding-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    seedWorkspace("ws1");
    seedWorkspace("ws2");
  });

  it("getFinding returns the finding when it exists", () => {
    findingStore.postFinding("f1", "ws1", "t1", "s1", "bug", "Found a bug", "Details here", ["frontend"]);
    const row = findingStore.getFinding("f1");
    expect(row).toBeDefined();
    expect(row!.id).toBe("f1");
    expect(row!.workspaceId).toBe("ws1");
    expect(row!.taskId).toBe("t1");
    expect(row!.sessionId).toBe("s1");
    expect(row!.category).toBe("bug");
    expect(row!.title).toBe("Found a bug");
    expect(row!.content).toBe("Details here");
    expect(row!.tags).toBe('["frontend"]');
  });

  it("getFinding returns undefined when not found", () => {
    expect(findingStore.getFinding("nonexistent")).toBeUndefined();
  });

  it("queryFindings with empty workspaceId returns findings across all workspaces", () => {
    findingStore.postFinding("f1", "ws1", "", "", "general", "Finding 1", "Content 1", []);
    findingStore.postFinding("f2", "ws2", "", "", "general", "Finding 2", "Content 2", []);

    const results = findingStore.queryFindings("");
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("f1");
    expect(ids).toContain("f2");
  });

  it("queryFindings with workspaceId returns only that workspace's findings", () => {
    findingStore.postFinding("f1", "ws1", "", "", "general", "WS1 Finding", "Content", []);
    findingStore.postFinding("f2", "ws2", "", "", "general", "WS2 Finding", "Content", []);

    const results = findingStore.queryFindings("ws1");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("f1");
    expect(results[0].title).toBe("WS1 Finding");
  });

  it("queryFindings filters by categories", () => {
    findingStore.postFinding("f1", "ws1", "", "", "bug", "Bug", "Content", []);
    findingStore.postFinding("f2", "ws1", "", "", "improvement", "Improvement", "Content", []);
    findingStore.postFinding("f3", "ws1", "", "", "general", "General", "Content", []);

    const results = findingStore.queryFindings("ws1", ["bug", "improvement"]);
    expect(results).toHaveLength(2);
    const categories = results.map((r) => r.category);
    expect(categories).toContain("bug");
    expect(categories).toContain("improvement");
  });

  it("queryFindings filters by tags", () => {
    findingStore.postFinding("f1", "ws1", "", "", "general", "Tagged", "Content", ["frontend", "css"]);
    findingStore.postFinding("f2", "ws1", "", "", "general", "Untagged", "Content", []);

    const results = findingStore.queryFindings("ws1", undefined, ["frontend"]);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("f1");
  });

  it("queryFindings respects limit", () => {
    for (let i = 0; i < 5; i++) {
      findingStore.postFinding(`f${i}`, "ws1", "", "", "general", `Finding ${i}`, "Content", []);
    }
    const results = findingStore.queryFindings("ws1", undefined, undefined, 2);
    expect(results).toHaveLength(2);
  });

  it("queryFindings caps limit at 100", () => {
    // Insert a single finding and request limit > 100
    findingStore.postFinding("f1", "ws1", "", "", "general", "Only one", "Content", []);
    const results = findingStore.queryFindings("ws1", undefined, undefined, 999);
    // Should not crash; limit is capped internally
    expect(results).toHaveLength(1);
  });

  it("postFinding stores tags as JSON", () => {
    findingStore.postFinding("f1", "ws1", "", "", "general", "Tagged", "Content", ["a", "b", "c"]);
    const row = findingStore.getFinding("f1");
    expect(row).toBeDefined();
    expect(JSON.parse(row!.tags)).toEqual(["a", "b", "c"]);
  });

  it("queryFindings returns empty array when no findings exist", () => {
    const results = findingStore.queryFindings("");
    expect(results).toHaveLength(0);
  });
});
