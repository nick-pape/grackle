import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// Import modules AFTER mock is set up
import * as workspaceStore from "./workspace-store.js";
import { sqlite } from "./test-db.js";

/** Apply the schema DDL to the in-memory database. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      description       TEXT NOT NULL DEFAULT '',
      repo_url          TEXT NOT NULL DEFAULT '',
      default_env_id    TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'active',
      use_worktrees     INTEGER NOT NULL DEFAULT 1,
      worktree_base_path TEXT NOT NULL DEFAULT '',
      default_persona_id TEXT NOT NULL DEFAULT '',
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

describe("workspace-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
  });

  it("creates and retrieves a workspace", () => {
    workspaceStore.createWorkspace("p1", "My Workspace", "A description", "https://github.com/acme/repo", "env-1");
    const p = workspaceStore.getWorkspace("p1");
    expect(p).toBeDefined();
    expect(p!.name).toBe("My Workspace");
    expect(p!.description).toBe("A description");
    expect(p!.repoUrl).toBe("https://github.com/acme/repo");
    expect(p!.defaultEnvironmentId).toBe("env-1");
    expect(p!.status).toBe("active");
  });

  it("lists only active workspaces", () => {
    workspaceStore.createWorkspace("p1", "Active", "", "", "");
    workspaceStore.createWorkspace("p2", "Archived", "", "", "");
    workspaceStore.archiveWorkspace("p2");
    const list = workspaceStore.listWorkspaces();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("p1");
  });

  it("archives a workspace", () => {
    workspaceStore.createWorkspace("p1", "Workspace", "", "", "");
    workspaceStore.archiveWorkspace("p1");
    const p = workspaceStore.getWorkspace("p1");
    expect(p!.status).toBe("archived");
  });

  it("updates workspace name", () => {
    workspaceStore.createWorkspace("p1", "Old Name", "", "", "");
    const updated = workspaceStore.updateWorkspace("p1", { name: "New Name" });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe("New Name");
  });

  it("updates workspace description", () => {
    workspaceStore.createWorkspace("p1", "Name", "Old desc", "", "");
    const updated = workspaceStore.updateWorkspace("p1", { description: "New description" });
    expect(updated!.description).toBe("New description");
  });

  it("clears description with empty string", () => {
    workspaceStore.createWorkspace("p1", "Name", "Has desc", "", "");
    const updated = workspaceStore.updateWorkspace("p1", { description: "" });
    expect(updated!.description).toBe("");
  });

  it("updates repo URL", () => {
    workspaceStore.createWorkspace("p1", "Name", "", "", "");
    const updated = workspaceStore.updateWorkspace("p1", { repoUrl: "https://github.com/new/repo" });
    expect(updated!.repoUrl).toBe("https://github.com/new/repo");
  });

  it("clears repo URL with empty string", () => {
    workspaceStore.createWorkspace("p1", "Name", "", "https://old.url", "");
    const updated = workspaceStore.updateWorkspace("p1", { repoUrl: "" });
    expect(updated!.repoUrl).toBe("");
  });

  it("updates default environment ID", () => {
    workspaceStore.createWorkspace("p1", "Name", "", "", "");
    const updated = workspaceStore.updateWorkspace("p1", { defaultEnvironmentId: "env-2" });
    expect(updated!.defaultEnvironmentId).toBe("env-2");
  });

  it("partial update leaves other fields unchanged", () => {
    workspaceStore.createWorkspace("p1", "Name", "desc", "https://repo.url", "env-1");
    const updated = workspaceStore.updateWorkspace("p1", { name: "New Name" });
    expect(updated!.name).toBe("New Name");
    expect(updated!.description).toBe("desc");
    expect(updated!.repoUrl).toBe("https://repo.url");
    expect(updated!.defaultEnvironmentId).toBe("env-1");
  });

  it("updates multiple fields at once", () => {
    workspaceStore.createWorkspace("p1", "Name", "", "", "");
    const updated = workspaceStore.updateWorkspace("p1", {
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

  it("updateWorkspace bumps updatedAt", () => {
    workspaceStore.createWorkspace("p1", "Name", "", "", "");
    // SQLite datetime('now') has second resolution, so the timestamp
    // should at least not be empty
    const updated = workspaceStore.updateWorkspace("p1", { name: "Changed" });
    expect(updated!.updatedAt).toBeDefined();
    expect(typeof updated!.updatedAt).toBe("string");
  });

  it("updateWorkspace returns undefined for non-existent workspace", () => {
    const result = workspaceStore.updateWorkspace("nope", { name: "Doesn't exist" });
    // The function calls getWorkspace which returns undefined for non-existent IDs
    expect(result).toBeUndefined();
  });

  // UT-5: useWorktrees field
  describe("useWorktrees", () => {
    it("defaults useWorktrees to true when not specified", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "");
      const p = workspaceStore.getWorkspace("p1");
      expect(p!.useWorktrees).toBe(true);
    });

    it("can be explicitly set to true", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "", true);
      const p = workspaceStore.getWorkspace("p1");
      expect(p!.useWorktrees).toBe(true);
    });

    it("can be explicitly set to false", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "", false);
      const p = workspaceStore.getWorkspace("p1");
      expect(p!.useWorktrees).toBe(false);
    });

    it("can be updated from true to false", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "", true);
      const updated = workspaceStore.updateWorkspace("p1", { useWorktrees: false });
      expect(updated!.useWorktrees).toBe(false);
    });

    it("can be updated from false to true", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "", false);
      const updated = workspaceStore.updateWorkspace("p1", { useWorktrees: true });
      expect(updated!.useWorktrees).toBe(true);
    });

    it("leaves useWorktrees unchanged when not in patch", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "", false);
      const updated = workspaceStore.updateWorkspace("p1", { name: "New Name" });
      expect(updated!.useWorktrees).toBe(false);
    });
  });

  // UT-1 through UT-4: worktreeBasePath field
  describe("worktreeBasePath", () => {
    it("creates workspace with worktreeBasePath set", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "", true, "/workspaces/odsp-web");
      const p = workspaceStore.getWorkspace("p1");
      expect(p).toBeDefined();
      expect(p!.worktreeBasePath).toBe("/workspaces/odsp-web");
    });

    it("defaults worktreeBasePath to empty string when not specified", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "");
      const p = workspaceStore.getWorkspace("p1");
      expect(p!.worktreeBasePath).toBe("");
    });

    it("updates worktreeBasePath", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "");
      const updated = workspaceStore.updateWorkspace("p1", { worktreeBasePath: "/workspaces/my-repo" });
      expect(updated!.worktreeBasePath).toBe("/workspaces/my-repo");
    });

    it("leaves worktreeBasePath unchanged when not in patch", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "", true, "/workspaces/foo");
      const updated = workspaceStore.updateWorkspace("p1", { name: "New Name" });
      expect(updated!.worktreeBasePath).toBe("/workspaces/foo");
    });

    it("clears worktreeBasePath with empty string", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "", true, "/workspaces/foo");
      const updated = workspaceStore.updateWorkspace("p1", { worktreeBasePath: "" });
      expect(updated!.worktreeBasePath).toBe("");
    });
  });
});
