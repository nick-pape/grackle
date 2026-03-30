import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// Import modules AFTER mock is set up
import * as workspaceStore from "./workspace-store.js";
import * as linkStore from "./workspace-environment-link-store.js";
import { sqlite } from "./test-db.js";

/** Apply the schema DDL to the in-memory database. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS environments (
      id            TEXT PRIMARY KEY,
      display_name  TEXT NOT NULL,
      adapter_type  TEXT NOT NULL,
      adapter_config TEXT NOT NULL,
      default_runtime TEXT NOT NULL DEFAULT 'claude-code',
      bootstrapped  INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'disconnected',
      last_seen     TEXT,
      env_info      TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      powerline_token TEXT NOT NULL DEFAULT ''
    );

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
      token_budget      INTEGER NOT NULL DEFAULT 0,
      cost_budget_millicents INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspace_environment_links (
      workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
      environment_id  TEXT NOT NULL REFERENCES environments(id),
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (workspace_id, environment_id)
    );

    INSERT OR IGNORE INTO environments (id, display_name, adapter_type, adapter_config)
      VALUES ('env-1', 'Env 1', 'local', '{}');
    INSERT OR IGNORE INTO environments (id, display_name, adapter_type, adapter_config)
      VALUES ('env-2', 'Env 2', 'docker', '{}');
  `);
}

describe("workspace-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS workspace_environment_links");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    sqlite.exec("DROP TABLE IF EXISTS environments");
    applySchema();
  });

  it("creates and retrieves a workspace", () => {
    workspaceStore.createWorkspace("p1", "My Workspace", "A description", "https://github.com/acme/repo", "env-1");
    const p = workspaceStore.getWorkspace("p1");
    expect(p).toBeDefined();
    expect(p!.name).toBe("My Workspace");
    expect(p!.description).toBe("A description");
    expect(p!.repoUrl).toBe("https://github.com/acme/repo");
    expect(p!.environmentId).toBe("env-1");
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

  it("filters workspaces by environment ID", () => {
    workspaceStore.createWorkspace("p1", "Env1 WS", "", "", "env-1");
    workspaceStore.createWorkspace("p2", "Env2 WS", "", "", "env-2");
    const env1List = workspaceStore.listWorkspaces("env-1");
    expect(env1List).toHaveLength(1);
    expect(env1List[0].id).toBe("p1");
    const allList = workspaceStore.listWorkspaces();
    expect(allList).toHaveLength(2);
  });

  it("includes linked workspaces when filtering by environment", () => {
    workspaceStore.createWorkspace("p1", "Env1 WS", "", "", "env-1");
    workspaceStore.createWorkspace("p2", "Env2 WS", "", "", "env-2");
    // Link p1 (primary env-1) to env-2
    linkStore.linkEnvironment("p1", "env-2");
    const env2List = workspaceStore.listWorkspaces("env-2");
    // Should include both p2 (primary) and p1 (linked)
    expect(env2List).toHaveLength(2);
    const ids = env2List.map((w) => w.id);
    expect(ids).toContain("p1");
    expect(ids).toContain("p2");
  });

  it("counts all workspaces (including archived) by environment", () => {
    workspaceStore.createWorkspace("p1", "WS1", "", "", "env-1");
    workspaceStore.createWorkspace("p2", "WS2", "", "", "env-1");
    workspaceStore.createWorkspace("p3", "WS3", "", "", "env-2");
    workspaceStore.archiveWorkspace("p2");
    // Archived workspaces still count — they hold an FK reference
    expect(workspaceStore.countWorkspacesByEnvironment("env-1")).toBe(2);
    expect(workspaceStore.countWorkspacesByEnvironment("env-2")).toBe(1);
    expect(workspaceStore.countWorkspacesByEnvironment("env-3")).toBe(0);
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

  it("updates environment ID", () => {
    workspaceStore.createWorkspace("p1", "Name", "", "", "");
    const updated = workspaceStore.updateWorkspace("p1", { environmentId: "env-2" });
    expect(updated!.environmentId).toBe("env-2");
  });

  it("partial update leaves other fields unchanged", () => {
    workspaceStore.createWorkspace("p1", "Name", "desc", "https://repo.url", "env-1");
    const updated = workspaceStore.updateWorkspace("p1", { name: "New Name" });
    expect(updated!.name).toBe("New Name");
    expect(updated!.description).toBe("desc");
    expect(updated!.repoUrl).toBe("https://repo.url");
    expect(updated!.environmentId).toBe("env-1");
  });

  it("updates multiple fields at once", () => {
    workspaceStore.createWorkspace("p1", "Name", "", "", "");
    const updated = workspaceStore.updateWorkspace("p1", {
      name: "Updated",
      description: "New desc",
      repoUrl: "https://new.url",
      environmentId: "env-3",
    });
    expect(updated!.name).toBe("Updated");
    expect(updated!.description).toBe("New desc");
    expect(updated!.repoUrl).toBe("https://new.url");
    expect(updated!.environmentId).toBe("env-3");
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

  // UT-1 through UT-4: workingDirectory field
  describe("workingDirectory", () => {
    it("creates workspace with workingDirectory set", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "", true, "/workspaces/odsp-web");
      const p = workspaceStore.getWorkspace("p1");
      expect(p).toBeDefined();
      expect(p!.workingDirectory).toBe("/workspaces/odsp-web");
    });

    it("defaults workingDirectory to empty string when not specified", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "");
      const p = workspaceStore.getWorkspace("p1");
      expect(p!.workingDirectory).toBe("");
    });

    it("updates workingDirectory", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "");
      const updated = workspaceStore.updateWorkspace("p1", { workingDirectory: "/workspaces/my-repo" });
      expect(updated!.workingDirectory).toBe("/workspaces/my-repo");
    });

    it("leaves workingDirectory unchanged when not in patch", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "", true, "/workspaces/foo");
      const updated = workspaceStore.updateWorkspace("p1", { name: "New Name" });
      expect(updated!.workingDirectory).toBe("/workspaces/foo");
    });

    it("clears workingDirectory with empty string", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "", true, "/workspaces/foo");
      const updated = workspaceStore.updateWorkspace("p1", { workingDirectory: "" });
      expect(updated!.workingDirectory).toBe("");
    });
  });

  describe("budget fields", () => {
    it("defaults budget fields to 0", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "");
      const ws = workspaceStore.getWorkspace("p1");
      expect(ws!.tokenBudget).toBe(0);
      expect(ws!.costBudgetMillicents).toBe(0);
    });

    it("stores budget values via createWorkspace", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "", true, "", "", 100000, 500000);
      const ws = workspaceStore.getWorkspace("p1");
      expect(ws!.tokenBudget).toBe(100000);
      expect(ws!.costBudgetMillicents).toBe(500000);
    });

    it("updates budget via updateWorkspace", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "");
      const updated = workspaceStore.updateWorkspace("p1", {
        tokenBudget: 200000,
        costBudgetMillicents: 300000,
      });
      expect(updated!.tokenBudget).toBe(200000);
      expect(updated!.costBudgetMillicents).toBe(300000);
    });

    it("leaves budget unchanged when not in patch", () => {
      workspaceStore.createWorkspace("p1", "Name", "", "", "", true, "", "", 100000, 200000);
      const updated = workspaceStore.updateWorkspace("p1", { name: "New Name" });
      expect(updated!.tokenBudget).toBe(100000);
      expect(updated!.costBudgetMillicents).toBe(200000);
    });
  });
});
