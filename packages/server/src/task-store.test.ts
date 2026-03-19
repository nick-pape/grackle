import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// Import modules AFTER mock is set up
import * as taskStore from "./task-store.js";
import * as workspaceStore from "./workspace-store.js";
import { sqlite } from "./test-db.js";

/** Apply the schema DDL to the in-memory database. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      repo_url      TEXT NOT NULL DEFAULT '',
      environment_id TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'active',
      use_worktrees INTEGER NOT NULL DEFAULT 1,
      worktree_base_path TEXT NOT NULL DEFAULT '',
      default_persona_id TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT REFERENCES workspaces(id),
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'not_started',
      branch        TEXT NOT NULL DEFAULT '',
      depends_on    TEXT NOT NULL DEFAULT '[]',
      assigned_at   TEXT,
      started_at    TEXT,
      completed_at  TEXT,
      review_notes  TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      sort_order    INTEGER NOT NULL DEFAULT 0,
      parent_task_id TEXT NOT NULL DEFAULT '',
      depth         INTEGER NOT NULL DEFAULT 0,
      can_decompose INTEGER NOT NULL DEFAULT 0,
      default_persona_id TEXT NOT NULL DEFAULT ''
    );
  `);
}

// ── Tests ────────────────────────────────────────────────────────

describe("task-store tree operations", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    workspaceStore.createWorkspace("test-proj", "Test Project", "desc", "", "");
  });

  describe("createTask with parentTaskId", () => {
    it("creates a root task with depth 0 and empty parentTaskId", () => {
      taskStore.createTask("t1", "test-proj", "Root Task", "desc", [], "test-workspace");
      const task = taskStore.getTask("t1");
      expect(task).toBeDefined();
      expect(task!.parentTaskId).toBe("");
      expect(task!.depth).toBe(0);
    });

    it("creates a child task with depth = parent.depth + 1", () => {
      taskStore.createTask("t1", "test-proj", "Parent", "desc", [], "test-workspace", "", true);
      taskStore.createTask("t2", "test-proj", "Child", "desc", [], "test-workspace", "t1");
      const child = taskStore.getTask("t2");
      expect(child).toBeDefined();
      expect(child!.parentTaskId).toBe("t1");
      expect(child!.depth).toBe(1);
    });

    it("generates branch name from parent branch when parent exists", () => {
      taskStore.createTask("t1", "test-proj", "Parent Task", "desc", [], "test-workspace", "", true);
      const parent = taskStore.getTask("t1");
      taskStore.createTask("t2", "test-proj", "Child Task", "desc", [], "test-workspace", "t1");
      const child = taskStore.getTask("t2");
      expect(child!.branch).toBe(`${parent!.branch}/child-task`);
    });

    it("rejects creation when parent does not exist", () => {
      expect(() => {
        taskStore.createTask("t1", "test-proj", "Orphan", "desc", [], "test-workspace", "nonexistent");
      }).toThrow("Parent task not found");
    });

    it("rejects creation when depth would exceed MAX_TASK_DEPTH", () => {
      for (let i = 0; i <= 8; i++) {
        taskStore.createTask(`t${i}`, "test-proj", `Level ${i}`, "desc", [], "proj", i === 0 ? "" : `t${i - 1}`, true);
      }

      expect(() => {
        taskStore.createTask("t9", "test-proj", "Level 9", "desc", [], "proj", "t8");
      }).toThrow("depth would exceed maximum");
    });
  });

  describe("getChildren", () => {
    it("returns direct children ordered by sort_order", () => {
      taskStore.createTask("t1", "test-proj", "Parent", "desc", [], "proj", "", true);
      taskStore.createTask("t2", "test-proj", "Child A", "desc", [], "proj", "t1");
      taskStore.createTask("t3", "test-proj", "Child B", "desc", [], "proj", "t1");

      const children = taskStore.getChildren("t1");
      expect(children).toHaveLength(2);
      expect(children[0].id).toBe("t2");
      expect(children[1].id).toBe("t3");
    });

    it("returns empty array for leaf tasks", () => {
      taskStore.createTask("t1", "test-proj", "Leaf", "desc", [], "proj");
      expect(taskStore.getChildren("t1")).toHaveLength(0);
    });

    it("does not return grandchildren", () => {
      taskStore.createTask("t1", "test-proj", "Root", "desc", [], "proj", "", true);
      taskStore.createTask("t2", "test-proj", "Child", "desc", [], "proj", "t1", true);
      taskStore.createTask("t3", "test-proj", "Grandchild", "desc", [], "proj", "t2");

      const children = taskStore.getChildren("t1");
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe("t2");
    });
  });

  describe("getDescendants", () => {
    it("returns full subtree for a 3-level hierarchy", () => {
      taskStore.createTask("t1", "test-proj", "Root", "desc", [], "proj", "", true);
      taskStore.createTask("t2", "test-proj", "Child", "desc", [], "proj", "t1", true);
      taskStore.createTask("t3", "test-proj", "Grandchild", "desc", [], "proj", "t2");

      const descendants = taskStore.getDescendants("t1");
      expect(descendants).toHaveLength(2);
      const ids = descendants.map(d => d.id);
      expect(ids).toContain("t2");
      expect(ids).toContain("t3");
    });

    it("returns empty array for leaf tasks", () => {
      taskStore.createTask("t1", "test-proj", "Leaf", "desc", [], "proj");
      expect(taskStore.getDescendants("t1")).toHaveLength(0);
    });
  });

  describe("getAncestors", () => {
    it("returns path from task to root, root-first", () => {
      taskStore.createTask("t1", "test-proj", "Root", "desc", [], "proj", "", true);
      taskStore.createTask("t2", "test-proj", "Child", "desc", [], "proj", "t1", true);
      taskStore.createTask("t3", "test-proj", "Grandchild", "desc", [], "proj", "t2");

      const ancestors = taskStore.getAncestors("t3");
      expect(ancestors).toHaveLength(2);
      expect(ancestors[0].id).toBe("t1");
      expect(ancestors[1].id).toBe("t2");
    });

    it("returns empty array for root tasks", () => {
      taskStore.createTask("t1", "test-proj", "Root", "desc", [], "proj");
      expect(taskStore.getAncestors("t1")).toHaveLength(0);
    });
  });

  describe("getChildStatusCounts", () => {
    it("returns correct counts by status", () => {
      taskStore.createTask("t1", "test-proj", "Parent", "desc", [], "proj", "", true);
      taskStore.createTask("t2", "test-proj", "Done Child", "desc", [], "proj", "t1");
      taskStore.createTask("t3", "test-proj", "Pending Child", "desc", [], "proj", "t1");
      taskStore.createTask("t4", "test-proj", "Another Pending", "desc", [], "proj", "t1");

      taskStore.updateTaskStatus("t2", "complete");

      const counts = taskStore.getChildStatusCounts("t1");
      expect(counts.complete).toBe(1);
      expect(counts.not_started).toBe(2);
    });

    it("returns empty record for leaf tasks", () => {
      taskStore.createTask("t1", "test-proj", "Leaf", "desc", [], "proj");
      const counts = taskStore.getChildStatusCounts("t1");
      expect(Object.keys(counts)).toHaveLength(0);
    });
  });

  describe("listTasks filtering", () => {
    beforeEach(() => {
      taskStore.createTask("t1", "test-proj", "Fix login bug", "User cannot login with SSO", [], "test-workspace");
      taskStore.createTask("t2", "test-proj", "Add dashboard", "Create analytics dashboard", [], "test-workspace");
      taskStore.createTask("t3", "test-proj", "Update auth middleware", "Refactor authentication layer", [], "test-workspace");
      taskStore.updateTaskStatus("t2", "working");
      taskStore.updateTaskStatus("t3", "complete");
    });

    it("returns only tasks matching search in title", () => {
      const results = taskStore.listTasks("test-proj", { search: "login" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("t1");
    });

    it("returns all tasks when search is empty", () => {
      const results = taskStore.listTasks("test-proj", { search: "" });
      expect(results).toHaveLength(3);
    });

    it("search is case-insensitive", () => {
      const results = taskStore.listTasks("test-proj", { search: "FIX LOGIN" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("t1");
    });

    it("search matches against description", () => {
      const results = taskStore.listTasks("test-proj", { search: "analytics" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("t2");
    });

    it("filters by status", () => {
      const results = taskStore.listTasks("test-proj", { status: "working" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("t2");
    });

    it("normalizes legacy status aliases", () => {
      const results = taskStore.listTasks("test-proj", { status: "in_progress" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("t2");
    });

    it("returns empty array for unknown status values", () => {
      const results = taskStore.listTasks("test-proj", { status: "bogus" });
      expect(results).toHaveLength(0);
    });

    it("combines search and status filters", () => {
      const results = taskStore.listTasks("test-proj", { search: "auth", status: "complete" });
      // "auth" matches t3 (title: "Update auth middleware") which is complete
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("t3");
    });

    it("returns empty array when search has no matches", () => {
      const results = taskStore.listTasks("test-proj", { search: "nonexistent" });
      expect(results).toHaveLength(0);
    });

    it("preserves sort order in filtered results", () => {
      taskStore.createTask("t4", "test-proj", "Another login fix", "Second login issue", [], "test-workspace");
      const results = taskStore.listTasks("test-proj", { search: "login" });
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("t1");
      expect(results[1].id).toBe("t4");
    });

    it("escapes LIKE special characters in search", () => {
      taskStore.createTask("t5", "test-proj", "100% complete task", "desc", [], "test-workspace");
      const results = taskStore.listTasks("test-proj", { search: "100%" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("t5");
    });

    it("escapes backslashes in search", () => {
      taskStore.createTask("t5", "test-proj", "path\\to\\file", "desc", [], "test-workspace");
      const results = taskStore.listTasks("test-proj", { search: "path\\to" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("t5");
    });

    it("escapes underscores in search", () => {
      taskStore.createTask("t5", "test-proj", "v2_final", "desc", [], "test-workspace");
      taskStore.createTask("t6", "test-proj", "v2Xfinal", "desc", [], "test-workspace");
      const results = taskStore.listTasks("test-proj", { search: "2_f" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("t5");
    });
  });

  describe("deleteTask", () => {
    it("allows deletion of leaf task", () => {
      taskStore.createTask("t1", "test-proj", "Leaf", "desc", [], "proj");
      taskStore.deleteTask("t1");
      expect(taskStore.getTask("t1")).toBeUndefined();
    });
  });

  describe("decomposition rights", () => {
    it("allows child under decomposable parent", () => {
      taskStore.createTask("t1", "test-proj", "Parent", "desc", [], "proj", "", true);
      taskStore.createTask("t2", "test-proj", "Child", "desc", [], "proj", "t1");
      const child = taskStore.getTask("t2");
      expect(child).toBeDefined();
      expect(child!.parentTaskId).toBe("t1");
    });

    it("rejects child under non-decomposable parent", () => {
      taskStore.createTask("t1", "test-proj", "Parent", "desc", [], "proj", "", false);
      expect(() => {
        taskStore.createTask("t2", "test-proj", "Child", "desc", [], "proj", "t1");
      }).toThrow("does not have decomposition rights");
    });

    it("persists canDecompose=true on root task", () => {
      taskStore.createTask("t1", "test-proj", "Root", "desc", [], "proj", "", true);
      const task = taskStore.getTask("t1");
      expect(task).toBeDefined();
      expect(task!.canDecompose).toBe(true);
    });

    it("persists canDecompose=false on root task and blocks children", () => {
      taskStore.createTask("t1", "test-proj", "Root", "desc", [], "proj", "", false);
      const task = taskStore.getTask("t1");
      expect(task!.canDecompose).toBe(false);
      expect(() => {
        taskStore.createTask("t2", "test-proj", "Child", "desc", [], "proj", "t1");
      }).toThrow("does not have decomposition rights");
    });

    it("chain: parent true → child false → grandchild rejected", () => {
      taskStore.createTask("t1", "test-proj", "Parent", "desc", [], "proj", "", true);
      taskStore.createTask("t2", "test-proj", "Child", "desc", [], "proj", "t1", false);
      expect(() => {
        taskStore.createTask("t3", "test-proj", "Grandchild", "desc", [], "proj", "t2");
      }).toThrow("does not have decomposition rights");
    });

    it("chain: parent true → child true → grandchild succeeds", () => {
      taskStore.createTask("t1", "test-proj", "Parent", "desc", [], "proj", "", true);
      taskStore.createTask("t2", "test-proj", "Child", "desc", [], "proj", "t1", true);
      taskStore.createTask("t3", "test-proj", "Grandchild", "desc", [], "proj", "t2");
      const grandchild = taskStore.getTask("t3");
      expect(grandchild).toBeDefined();
      expect(grandchild!.depth).toBe(2);
    });

    it("depth limit still enforced even when canDecompose=true", () => {
      for (let i = 0; i <= 8; i++) {
        taskStore.createTask(`t${i}`, "test-proj", `Level ${i}`, "desc", [], "proj", i === 0 ? "" : `t${i - 1}`, true);
      }

      expect(() => {
        taskStore.createTask("t9", "test-proj", "Level 9", "desc", [], "proj", "t8", true);
      }).toThrow("depth would exceed maximum");
    });

    it("defaults canDecompose to true for root tasks when not specified", () => {
      taskStore.createTask("t1", "test-proj", "Task", "desc", [], "proj");
      const task = taskStore.getTask("t1");
      expect(task!.canDecompose).toBe(true);
    });

    it("defaults canDecompose to false for child tasks when not specified", () => {
      taskStore.createTask("t1", "test-proj", "Parent", "desc", [], "proj", "", true);
      taskStore.createTask("t2", "test-proj", "Child", "desc", [], "proj", "t1");
      const child = taskStore.getTask("t2");
      expect(child!.canDecompose).toBe(false);
    });
  });

});
