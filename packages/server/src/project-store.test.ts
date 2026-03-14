import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// Import modules AFTER mock is set up
import * as projectStore from "./project-store.js";
import { sqlite } from "./test-db.js";

/** Apply the schema DDL to the in-memory database. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      repo_url      TEXT NOT NULL DEFAULT '',
      default_env_id TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'active',
      use_worktrees INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ── Tests ────────────────────────────────────────────────────────

describe("project-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS projects");
    applySchema();
  });

  // UT-5: createProject() stores useWorktrees and getProject() returns it
  describe("createProject with useWorktrees", () => {
    it("defaults useWorktrees to true when not specified", () => {
      projectStore.createProject("p1", "My Project", "desc", "", "");
      const row = projectStore.getProject("p1");
      expect(row).toBeDefined();
      expect(row!.useWorktrees).toBe(true);
    });

    it("stores useWorktrees=true when explicitly set", () => {
      projectStore.createProject("p2", "Worktree Project", "desc", "", "", true);
      const row = projectStore.getProject("p2");
      expect(row).toBeDefined();
      expect(row!.useWorktrees).toBe(true);
    });

    it("stores useWorktrees=false when explicitly disabled", () => {
      projectStore.createProject("p3", "No-Worktree Project", "desc", "", "", false);
      const row = projectStore.getProject("p3");
      expect(row).toBeDefined();
      expect(row!.useWorktrees).toBe(false);
    });
  });

  describe("getProject", () => {
    it("returns undefined for a non-existent project", () => {
      expect(projectStore.getProject("nonexistent")).toBeUndefined();
    });

    it("returns the project row including useWorktrees", () => {
      projectStore.createProject("p4", "Test", "", "https://github.com/example/repo", "env-1", false);
      const row = projectStore.getProject("p4");
      expect(row).toBeDefined();
      expect(row!.id).toBe("p4");
      expect(row!.name).toBe("Test");
      expect(row!.repoUrl).toBe("https://github.com/example/repo");
      expect(row!.defaultEnvironmentId).toBe("env-1");
      expect(row!.useWorktrees).toBe(false);
    });
  });

  describe("listProjects", () => {
    it("returns only active projects with useWorktrees field", () => {
      projectStore.createProject("p5", "Active", "", "", "", true);
      projectStore.createProject("p6", "Disabled Worktrees", "", "", "", false);
      projectStore.archiveProject("p6");
      const rows = projectStore.listProjects();
      expect(rows.length).toBe(1);
      expect(rows[0]!.id).toBe("p5");
      expect(rows[0]!.useWorktrees).toBe(true);
    });
  });

  describe("updateProject", () => {
    it("updates useWorktrees from true to false", () => {
      projectStore.createProject("p7", "Togglable", "", "", "", true);
      projectStore.updateProject("p7", { useWorktrees: false });
      const row = projectStore.getProject("p7");
      expect(row!.useWorktrees).toBe(false);
    });

    it("updates useWorktrees from false to true", () => {
      projectStore.createProject("p8", "Re-enable Worktrees", "", "", "", false);
      projectStore.updateProject("p8", { useWorktrees: true });
      const row = projectStore.getProject("p8");
      expect(row!.useWorktrees).toBe(true);
    });

    it("is a no-op patch when useWorktrees is not provided", () => {
      projectStore.createProject("p9", "No Change", "", "", "", false);
      projectStore.updateProject("p9", {}); // no-op patch
      const row = projectStore.getProject("p9");
      expect(row!.useWorktrees).toBe(false); // unchanged
    });
  });

  describe("archiveProject", () => {
    it("archives a project so it no longer appears in listProjects", () => {
      projectStore.createProject("p10", "To Archive", "", "", "");
      projectStore.archiveProject("p10");
      const rows = projectStore.listProjects();
      expect(rows.find((r) => r.id === "p10")).toBeUndefined();
    });
  });
});
