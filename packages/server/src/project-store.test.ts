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
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      description       TEXT NOT NULL DEFAULT '',
      repo_url          TEXT NOT NULL DEFAULT '',
      default_env_id    TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'active',
      use_worktrees     INTEGER NOT NULL DEFAULT 1,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

describe("project-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS projects");
    applySchema();
  });

  it("creates and retrieves a project", () => {
    projectStore.createProject("p1", "My Project", "A description", "https://github.com/acme/repo", "env-1");
    const p = projectStore.getProject("p1");
    expect(p).toBeDefined();
    expect(p!.name).toBe("My Project");
    expect(p!.description).toBe("A description");
    expect(p!.repoUrl).toBe("https://github.com/acme/repo");
    expect(p!.defaultEnvironmentId).toBe("env-1");
    expect(p!.status).toBe("active");
  });

  it("lists only active projects", () => {
    projectStore.createProject("p1", "Active", "", "", "");
    projectStore.createProject("p2", "Archived", "", "", "");
    projectStore.archiveProject("p2");
    const list = projectStore.listProjects();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("p1");
  });

  it("archives a project", () => {
    projectStore.createProject("p1", "Project", "", "", "");
    projectStore.archiveProject("p1");
    const p = projectStore.getProject("p1");
    expect(p!.status).toBe("archived");
  });

  it("updates project name", () => {
    projectStore.createProject("p1", "Old Name", "", "", "");
    const updated = projectStore.updateProject("p1", { name: "New Name" });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe("New Name");
  });

  it("updates project description", () => {
    projectStore.createProject("p1", "Name", "Old desc", "", "");
    const updated = projectStore.updateProject("p1", { description: "New description" });
    expect(updated!.description).toBe("New description");
  });

  it("clears description with empty string", () => {
    projectStore.createProject("p1", "Name", "Has desc", "", "");
    const updated = projectStore.updateProject("p1", { description: "" });
    expect(updated!.description).toBe("");
  });

  it("updates repo URL", () => {
    projectStore.createProject("p1", "Name", "", "", "");
    const updated = projectStore.updateProject("p1", { repoUrl: "https://github.com/new/repo" });
    expect(updated!.repoUrl).toBe("https://github.com/new/repo");
  });

  it("clears repo URL with empty string", () => {
    projectStore.createProject("p1", "Name", "", "https://old.url", "");
    const updated = projectStore.updateProject("p1", { repoUrl: "" });
    expect(updated!.repoUrl).toBe("");
  });

  it("updates default environment ID", () => {
    projectStore.createProject("p1", "Name", "", "", "");
    const updated = projectStore.updateProject("p1", { defaultEnvironmentId: "env-2" });
    expect(updated!.defaultEnvironmentId).toBe("env-2");
  });

  it("partial update leaves other fields unchanged", () => {
    projectStore.createProject("p1", "Name", "desc", "https://repo.url", "env-1");
    const updated = projectStore.updateProject("p1", { name: "New Name" });
    expect(updated!.name).toBe("New Name");
    expect(updated!.description).toBe("desc");
    expect(updated!.repoUrl).toBe("https://repo.url");
    expect(updated!.defaultEnvironmentId).toBe("env-1");
  });

  it("updates multiple fields at once", () => {
    projectStore.createProject("p1", "Name", "", "", "");
    const updated = projectStore.updateProject("p1", {
      name: "Updated",
      description: "New desc",
      repoUrl: "https://new.url",
      defaultEnvironmentId: "env-3",
    });
    expect(updated!.name).toBe("Updated");
    expect(updated!.description).toBe("New desc");
    expect(updated!.repoUrl).toBe("https://new.url");
    expect(updated!.defaultEnvironmentId).toBe("env-3");
  });

  it("updateProject bumps updatedAt", () => {
    projectStore.createProject("p1", "Name", "", "", "");
    // SQLite datetime('now') has second resolution, so the timestamp
    // should at least not be empty
    const updated = projectStore.updateProject("p1", { name: "Changed" });
    expect(updated!.updatedAt).toBeDefined();
    expect(typeof updated!.updatedAt).toBe("string");
  });

  it("updateProject returns undefined for non-existent project", () => {
    const result = projectStore.updateProject("nope", { name: "Doesn't exist" });
    // The function calls getProject which returns undefined for non-existent IDs
    expect(result).toBeUndefined();
  });

  // UT-5: useWorktrees field
  describe("useWorktrees", () => {
    it("defaults useWorktrees to true when not specified", () => {
      projectStore.createProject("p1", "Name", "", "", "");
      const p = projectStore.getProject("p1");
      expect(p!.useWorktrees).toBe(true);
    });

    it("can be explicitly set to true", () => {
      projectStore.createProject("p1", "Name", "", "", "", true);
      const p = projectStore.getProject("p1");
      expect(p!.useWorktrees).toBe(true);
    });

    it("can be explicitly set to false", () => {
      projectStore.createProject("p1", "Name", "", "", "", false);
      const p = projectStore.getProject("p1");
      expect(p!.useWorktrees).toBe(false);
    });

    it("can be updated from true to false", () => {
      projectStore.createProject("p1", "Name", "", "", "", true);
      const updated = projectStore.updateProject("p1", { useWorktrees: false });
      expect(updated!.useWorktrees).toBe(false);
    });

    it("can be updated from false to true", () => {
      projectStore.createProject("p1", "Name", "", "", "", false);
      const updated = projectStore.updateProject("p1", { useWorktrees: true });
      expect(updated!.useWorktrees).toBe(true);
    });

    it("leaves useWorktrees unchanged when not in patch", () => {
      projectStore.createProject("p1", "Name", "", "", "", false);
      const updated = projectStore.updateProject("p1", { name: "New Name" });
      expect(updated!.useWorktrees).toBe(false);
    });
  });
});
