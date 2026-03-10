import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// Import modules AFTER mock is set up
import * as taskStore from "./task-store.js";
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
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id),
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'pending',
      branch        TEXT NOT NULL DEFAULT '',
      env_id        TEXT NOT NULL DEFAULT '',
      session_id    TEXT NOT NULL DEFAULT '',
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
      can_decompose INTEGER NOT NULL DEFAULT 0
    );
  `);
}

// ── Tests ────────────────────────────────────────────────────────

describe("task-store tree operations", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS projects");
    applySchema();
    projectStore.createProject("test-proj", "Test Project", "desc", "", "");
  });

  describe("createTask with parentTaskId", () => {
    it("creates a root task with depth 0 and empty parentTaskId", () => {
      taskStore.createTask("t1", "test-proj", "Root Task", "desc", "", [], "test-project");
      const task = taskStore.getTask("t1");
      expect(task).toBeDefined();
      expect(task!.parentTaskId).toBe("");
      expect(task!.depth).toBe(0);
    });

    it("creates a child task with depth = parent.depth + 1", () => {
      taskStore.createTask("t1", "test-proj", "Parent", "desc", "", [], "test-project", "", true);
      taskStore.createTask("t2", "test-proj", "Child", "desc", "", [], "test-project", "t1");
      const child = taskStore.getTask("t2");
      expect(child).toBeDefined();
      expect(child!.parentTaskId).toBe("t1");
      expect(child!.depth).toBe(1);
    });

    it("generates branch name from parent branch when parent exists", () => {
      taskStore.createTask("t1", "test-proj", "Parent Task", "desc", "", [], "test-project", "", true);
      const parent = taskStore.getTask("t1");
      taskStore.createTask("t2", "test-proj", "Child Task", "desc", "", [], "test-project", "t1");
      const child = taskStore.getTask("t2");
      expect(child!.branch).toBe(`${parent!.branch}/child-task`);
    });

    it("rejects creation when parent does not exist", () => {
      expect(() => {
        taskStore.createTask("t1", "test-proj", "Orphan", "desc", "", [], "test-project", "nonexistent");
      }).toThrow("Parent task not found");
    });

    it("rejects creation when depth would exceed MAX_TASK_DEPTH", () => {
      taskStore.createTask("t0", "test-proj", "Level 0", "desc", "", [], "proj", "", true);
      taskStore.createTask("t1", "test-proj", "Level 1", "desc", "", [], "proj", "t0", true);
      taskStore.createTask("t2", "test-proj", "Level 2", "desc", "", [], "proj", "t1", true);
      taskStore.createTask("t3", "test-proj", "Level 3", "desc", "", [], "proj", "t2", true);
      taskStore.createTask("t4", "test-proj", "Level 4", "desc", "", [], "proj", "t3", true);
      taskStore.createTask("t5", "test-proj", "Level 5", "desc", "", [], "proj", "t4", true);

      expect(() => {
        taskStore.createTask("t6", "test-proj", "Level 6", "desc", "", [], "proj", "t5");
      }).toThrow("depth would exceed maximum");
    });
  });

  describe("getChildren", () => {
    it("returns direct children ordered by sort_order", () => {
      taskStore.createTask("t1", "test-proj", "Parent", "desc", "", [], "proj", "", true);
      taskStore.createTask("t2", "test-proj", "Child A", "desc", "", [], "proj", "t1");
      taskStore.createTask("t3", "test-proj", "Child B", "desc", "", [], "proj", "t1");

      const children = taskStore.getChildren("t1");
      expect(children).toHaveLength(2);
      expect(children[0].id).toBe("t2");
      expect(children[1].id).toBe("t3");
    });

    it("returns empty array for leaf tasks", () => {
      taskStore.createTask("t1", "test-proj", "Leaf", "desc", "", [], "proj");
      expect(taskStore.getChildren("t1")).toHaveLength(0);
    });

    it("does not return grandchildren", () => {
      taskStore.createTask("t1", "test-proj", "Root", "desc", "", [], "proj", "", true);
      taskStore.createTask("t2", "test-proj", "Child", "desc", "", [], "proj", "t1", true);
      taskStore.createTask("t3", "test-proj", "Grandchild", "desc", "", [], "proj", "t2");

      const children = taskStore.getChildren("t1");
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe("t2");
    });
  });

  describe("getDescendants", () => {
    it("returns full subtree for a 3-level hierarchy", () => {
      taskStore.createTask("t1", "test-proj", "Root", "desc", "", [], "proj", "", true);
      taskStore.createTask("t2", "test-proj", "Child", "desc", "", [], "proj", "t1", true);
      taskStore.createTask("t3", "test-proj", "Grandchild", "desc", "", [], "proj", "t2");

      const descendants = taskStore.getDescendants("t1");
      expect(descendants).toHaveLength(2);
      const ids = descendants.map(d => d.id);
      expect(ids).toContain("t2");
      expect(ids).toContain("t3");
    });

    it("returns empty array for leaf tasks", () => {
      taskStore.createTask("t1", "test-proj", "Leaf", "desc", "", [], "proj");
      expect(taskStore.getDescendants("t1")).toHaveLength(0);
    });
  });

  describe("getAncestors", () => {
    it("returns path from task to root, root-first", () => {
      taskStore.createTask("t1", "test-proj", "Root", "desc", "", [], "proj", "", true);
      taskStore.createTask("t2", "test-proj", "Child", "desc", "", [], "proj", "t1", true);
      taskStore.createTask("t3", "test-proj", "Grandchild", "desc", "", [], "proj", "t2");

      const ancestors = taskStore.getAncestors("t3");
      expect(ancestors).toHaveLength(2);
      expect(ancestors[0].id).toBe("t1");
      expect(ancestors[1].id).toBe("t2");
    });

    it("returns empty array for root tasks", () => {
      taskStore.createTask("t1", "test-proj", "Root", "desc", "", [], "proj");
      expect(taskStore.getAncestors("t1")).toHaveLength(0);
    });
  });

  describe("getChildStatusCounts", () => {
    it("returns correct counts by status", () => {
      taskStore.createTask("t1", "test-proj", "Parent", "desc", "", [], "proj", "", true);
      taskStore.createTask("t2", "test-proj", "Done Child", "desc", "", [], "proj", "t1");
      taskStore.createTask("t3", "test-proj", "Pending Child", "desc", "", [], "proj", "t1");
      taskStore.createTask("t4", "test-proj", "Another Pending", "desc", "", [], "proj", "t1");

      taskStore.updateTaskStatus("t2", "done");

      const counts = taskStore.getChildStatusCounts("t1");
      expect(counts.done).toBe(1);
      expect(counts.pending).toBe(2);
    });

    it("returns empty record for leaf tasks", () => {
      taskStore.createTask("t1", "test-proj", "Leaf", "desc", "", [], "proj");
      const counts = taskStore.getChildStatusCounts("t1");
      expect(Object.keys(counts)).toHaveLength(0);
    });
  });

  describe("deleteTask", () => {
    it("allows deletion of leaf task", () => {
      taskStore.createTask("t1", "test-proj", "Leaf", "desc", "", [], "proj");
      taskStore.deleteTask("t1");
      expect(taskStore.getTask("t1")).toBeUndefined();
    });
  });

  describe("decomposition rights", () => {
    it("allows child under decomposable parent", () => {
      taskStore.createTask("t1", "test-proj", "Parent", "desc", "", [], "proj", "", true);
      taskStore.createTask("t2", "test-proj", "Child", "desc", "", [], "proj", "t1");
      const child = taskStore.getTask("t2");
      expect(child).toBeDefined();
      expect(child!.parentTaskId).toBe("t1");
    });

    it("rejects child under non-decomposable parent", () => {
      taskStore.createTask("t1", "test-proj", "Parent", "desc", "", [], "proj", "", false);
      expect(() => {
        taskStore.createTask("t2", "test-proj", "Child", "desc", "", [], "proj", "t1");
      }).toThrow("does not have decomposition rights");
    });

    it("persists canDecompose=true on root task", () => {
      taskStore.createTask("t1", "test-proj", "Root", "desc", "", [], "proj", "", true);
      const task = taskStore.getTask("t1");
      expect(task).toBeDefined();
      expect(task!.canDecompose).toBe(true);
    });

    it("persists canDecompose=false on root task and blocks children", () => {
      taskStore.createTask("t1", "test-proj", "Root", "desc", "", [], "proj", "", false);
      const task = taskStore.getTask("t1");
      expect(task!.canDecompose).toBe(false);
      expect(() => {
        taskStore.createTask("t2", "test-proj", "Child", "desc", "", [], "proj", "t1");
      }).toThrow("does not have decomposition rights");
    });

    it("chain: parent true → child false → grandchild rejected", () => {
      taskStore.createTask("t1", "test-proj", "Parent", "desc", "", [], "proj", "", true);
      taskStore.createTask("t2", "test-proj", "Child", "desc", "", [], "proj", "t1", false);
      expect(() => {
        taskStore.createTask("t3", "test-proj", "Grandchild", "desc", "", [], "proj", "t2");
      }).toThrow("does not have decomposition rights");
    });

    it("chain: parent true → child true → grandchild succeeds", () => {
      taskStore.createTask("t1", "test-proj", "Parent", "desc", "", [], "proj", "", true);
      taskStore.createTask("t2", "test-proj", "Child", "desc", "", [], "proj", "t1", true);
      taskStore.createTask("t3", "test-proj", "Grandchild", "desc", "", [], "proj", "t2");
      const grandchild = taskStore.getTask("t3");
      expect(grandchild).toBeDefined();
      expect(grandchild!.depth).toBe(2);
    });

    it("depth limit still enforced even when canDecompose=true", () => {
      taskStore.createTask("t0", "test-proj", "Level 0", "desc", "", [], "proj", "", true);
      taskStore.createTask("t1", "test-proj", "Level 1", "desc", "", [], "proj", "t0", true);
      taskStore.createTask("t2", "test-proj", "Level 2", "desc", "", [], "proj", "t1", true);
      taskStore.createTask("t3", "test-proj", "Level 3", "desc", "", [], "proj", "t2", true);
      taskStore.createTask("t4", "test-proj", "Level 4", "desc", "", [], "proj", "t3", true);
      taskStore.createTask("t5", "test-proj", "Level 5", "desc", "", [], "proj", "t4", true);

      expect(() => {
        taskStore.createTask("t6", "test-proj", "Level 6", "desc", "", [], "proj", "t5", true);
      }).toThrow("depth would exceed maximum");
    });

    it("defaults canDecompose to false when not specified", () => {
      taskStore.createTask("t1", "test-proj", "Task", "desc", "", [], "proj");
      const task = taskStore.getTask("t1");
      expect(task!.canDecompose).toBe(false);
    });
  });
});
