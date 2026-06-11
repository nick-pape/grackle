import { describe, it, expect, beforeEach } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
import { vi } from "vitest";
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// Import modules AFTER mock is set up
import * as taskStore from "./task-store.js";
import type { InsertTaskFields } from "./task-store.js";
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
      working_directory TEXT NOT NULL DEFAULT '',
      default_persona_id TEXT NOT NULL DEFAULT '',
      token_budget  INTEGER NOT NULL DEFAULT 0,
      cost_budget_millicents INTEGER NOT NULL DEFAULT 0,
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
      inject_knowledge INTEGER NOT NULL DEFAULT 1,
      default_persona_id TEXT NOT NULL DEFAULT '',
      workpad       TEXT NOT NULL DEFAULT '',
      schedule_id   TEXT NOT NULL DEFAULT '',
      token_budget  INTEGER NOT NULL DEFAULT 0,
      cost_budget_millicents INTEGER NOT NULL DEFAULT 0,
      agent_id      TEXT,
      kind          TEXT NOT NULL DEFAULT 'task'
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id                  TEXT PRIMARY KEY,
      title               TEXT NOT NULL,
      description         TEXT NOT NULL DEFAULT '',
      schedule_expression TEXT NOT NULL,
      persona_id          TEXT NOT NULL,
      workspace_id        TEXT NOT NULL DEFAULT '',
      parent_task_id      TEXT NOT NULL DEFAULT '',
      enabled             INTEGER NOT NULL DEFAULT 1,
      last_run_at         TEXT,
      next_run_at         TEXT,
      run_count           INTEGER NOT NULL DEFAULT 0,
      task_id             TEXT REFERENCES tasks(id),
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ── Tests ────────────────────────────────────────────────────────

/**
 * Insert a task row with sensible defaults, bypassing all business logic.
 * Use this helper for fixture setup in store-layer tests.
 */
function makeTask(id: string, opts: Partial<Omit<InsertTaskFields, "id">> = {}): void {
  taskStore.insertTask({
    id,
    workspaceId: opts.workspaceId ?? "test-proj",
    title: opts.title ?? "Test Task",
    description: opts.description ?? "desc",
    branch: opts.branch ?? `proj/${id}`,
    dependsOn: opts.dependsOn ?? [],
    parentTaskId: opts.parentTaskId ?? "",
    depth: opts.depth ?? 0,
    canDecompose: opts.canDecompose ?? true,
    injectKnowledge: opts.injectKnowledge ?? true,
    defaultPersonaId: opts.defaultPersonaId ?? "",
    tokenBudget: opts.tokenBudget ?? 0,
    costBudgetMillicents: opts.costBudgetMillicents ?? 0,
    agentId: opts.agentId,
    kind: opts.kind,
  });
}

describe("task-store persistence", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS schedules");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();
    workspaceStore.createWorkspace("test-proj", "Test Project", "desc", "", "");
  });

  // ── insertTask / getTask ─────────────────────────────────────────

  describe("insertTask / getTask", () => {
    it("inserts and retrieves a task by id", () => {
      makeTask("t1", { title: "My Task" });
      const task = taskStore.getTask("t1");
      expect(task).toBeDefined();
      expect(task!.id).toBe("t1");
      expect(task!.title).toBe("My Task");
    });

    it("returns undefined for unknown id", () => {
      expect(taskStore.getTask("no-such-id")).toBeUndefined();
    });

    it("persists workspaceId", () => {
      makeTask("t1", { workspaceId: "test-proj" });
      expect(taskStore.getTask("t1")!.workspaceId).toBe("test-proj");
    });

    it("persists depth field", () => {
      makeTask("t1", { depth: 3 });
      expect(taskStore.getTask("t1")!.depth).toBe(3);
    });

    it("persists canDecompose=false", () => {
      makeTask("t1", { canDecompose: false });
      expect(taskStore.getTask("t1")!.canDecompose).toBe(false);
    });

    it("persists canDecompose=true", () => {
      makeTask("t1", { canDecompose: true });
      expect(taskStore.getTask("t1")!.canDecompose).toBe(true);
    });

    it("persists parentTaskId", () => {
      makeTask("parent");
      makeTask("child", { parentTaskId: "parent", depth: 1 });
      expect(taskStore.getTask("child")!.parentTaskId).toBe("parent");
    });

    it("defaults kind to 'task'", () => {
      makeTask("t1");
      expect(taskStore.getTask("t1")!.kind).toBe("task");
    });

    it("stores custom kind", () => {
      makeTask("t1", { kind: "schedule_fire" });
      expect(taskStore.getTask("t1")!.kind).toBe("schedule_fire");
    });

    it("stores agentId when provided", () => {
      makeTask("t1", { agentId: "agent-42" });
      expect(taskStore.getTask("t1")!.agentId).toBe("agent-42");
    });

    it("sets agentId to null when omitted", () => {
      makeTask("t1");
      expect(taskStore.getTask("t1")!.agentId).toBeNull();
    });
  });

  // ── getChildren ──────────────────────────────────────────────────

  describe("getChildren", () => {
    it("returns direct children ordered by sort_order", () => {
      makeTask("t1", { canDecompose: true });
      makeTask("t2", { parentTaskId: "t1", depth: 1 });
      makeTask("t3", { parentTaskId: "t1", depth: 1 });

      const children = taskStore.getChildren("t1");
      expect(children).toHaveLength(2);
      expect(children[0].id).toBe("t2");
      expect(children[1].id).toBe("t3");
    });

    it("returns empty array for leaf tasks", () => {
      makeTask("t1");
      expect(taskStore.getChildren("t1")).toHaveLength(0);
    });

    it("does not return grandchildren", () => {
      makeTask("t1", { canDecompose: true });
      makeTask("t2", { parentTaskId: "t1", depth: 1, canDecompose: true });
      makeTask("t3", { parentTaskId: "t2", depth: 2 });

      const children = taskStore.getChildren("t1");
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe("t2");
    });
  });

  // ── listTasks filtering ──────────────────────────────────────────

  describe("listTasks filtering", () => {
    beforeEach(() => {
      makeTask("t1", { title: "Fix login bug", description: "User cannot login with SSO" });
      makeTask("t2", { title: "Add dashboard", description: "Create analytics dashboard" });
      makeTask("t3", {
        title: "Update auth middleware",
        description: "Refactor authentication layer",
      });
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
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("t3");
    });

    it("returns empty array when search has no matches", () => {
      const results = taskStore.listTasks("test-proj", { search: "nonexistent" });
      expect(results).toHaveLength(0);
    });

    it("preserves sort order in filtered results", () => {
      makeTask("t4", { title: "Another login fix", description: "Second login issue" });
      const results = taskStore.listTasks("test-proj", { search: "login" });
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("t1");
      expect(results[1].id).toBe("t4");
    });

    it("escapes LIKE special characters in search", () => {
      makeTask("t5", { title: "100% complete task" });
      const results = taskStore.listTasks("test-proj", { search: "100%" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("t5");
    });

    it("escapes backslashes in search", () => {
      makeTask("t5", { title: "path\\to\\file" });
      const results = taskStore.listTasks("test-proj", { search: "path\\to" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("t5");
    });

    it("escapes underscores in search", () => {
      makeTask("t5", { title: "v2_final" });
      makeTask("t6", { title: "v2Xfinal" });
      const results = taskStore.listTasks("test-proj", { search: "2_f" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("t5");
    });
  });

  // ── deleteTask ───────────────────────────────────────────────────

  describe("deleteTask", () => {
    it("allows deletion of leaf task", () => {
      makeTask("t1");
      taskStore.deleteTask("t1");
      expect(taskStore.getTask("t1")).toBeUndefined();
    });

    it("cascades through heartbeat schedules — deletes schedules where task_id matches (#1438)", () => {
      // Enforce FK constraints to mirror production (better-sqlite3's default).
      // Without the schedules.task_id cleanup, this DELETE would throw with a
      // FK violation when a heartbeat targets the task being removed.
      sqlite.pragma("foreign_keys = ON");
      try {
        makeTask("agent-root");
        // Insert a heartbeat schedule referencing the task.
        sqlite
          .prepare(
            `INSERT INTO schedules (id, title, schedule_expression, persona_id, task_id) VALUES (?, ?, ?, ?, ?)`,
          )
          .run("hb-1", "HB", "30s", "p1", "agent-root");
        const before = sqlite
          .prepare("SELECT COUNT(*) as c FROM schedules WHERE task_id = ?")
          .get("agent-root") as { c: number };
        expect(before.c).toBe(1);

        // Cascade: deleteTask removes the referencing schedule first, then the task.
        const changes = taskStore.deleteTask("agent-root");
        expect(changes).toBe(1);
        expect(taskStore.getTask("agent-root")).toBeUndefined();
        const after = sqlite
          .prepare("SELECT COUNT(*) as c FROM schedules WHERE task_id = ?")
          .get("agent-root") as { c: number };
        expect(after.c).toBe(0);
      } finally {
        sqlite.pragma("foreign_keys = OFF");
      }
    });
  });

  // ── setTaskWorkspace ─────────────────────────────────────────────

  describe("setTaskWorkspace", () => {
    it("reassigns a task to a different workspace", () => {
      workspaceStore.createWorkspace("ws-2", "Second Workspace", "", "", "");
      makeTask("t1");
      expect(taskStore.getTask("t1")!.workspaceId).toBe("test-proj");

      taskStore.setTaskWorkspace("t1", "ws-2");
      expect(taskStore.getTask("t1")!.workspaceId).toBe("ws-2");
    });
  });

  // ── setTaskScheduleId ────────────────────────────────────────────

  describe("setTaskScheduleId", () => {
    it("sets the schedule_id on a task", () => {
      makeTask("t1");
      expect(taskStore.getTask("t1")!.scheduleId).toBe("");

      taskStore.setTaskScheduleId("t1", "sched-1");
      const task = taskStore.getTask("t1");
      expect(task!.scheduleId).toBe("sched-1");
    });
  });

  // ── budget fields ────────────────────────────────────────────────

  describe("budget fields", () => {
    it("defaults token_budget and cost_budget_millicents to 0", () => {
      makeTask("t1");
      const task = taskStore.getTask("t1");
      expect(task!.tokenBudget).toBe(0);
      expect(task!.costBudgetMillicents).toBe(0);
    });

    it("stores budget values via insertTask", () => {
      makeTask("t1", { tokenBudget: 50000, costBudgetMillicents: 100000 });
      const task = taskStore.getTask("t1");
      expect(task!.tokenBudget).toBe(50000);
      expect(task!.costBudgetMillicents).toBe(100000);
    });

    it("updates budget via updateTaskBudget", () => {
      makeTask("t1");
      taskStore.updateTaskBudget("t1", 200000, 500000);
      const task = taskStore.getTask("t1");
      expect(task!.tokenBudget).toBe(200000);
      expect(task!.costBudgetMillicents).toBe(500000);
    });

    it("updateTaskBudget sets updatedAt", () => {
      makeTask("t1");
      const before = taskStore.getTask("t1")!.updatedAt;
      taskStore.updateTaskBudget("t1", 100, 200);
      const after = taskStore.getTask("t1")!.updatedAt;
      expect(after >= before).toBe(true);
    });
  });

  // ── setTaskParentAndDepth ────────────────────────────────────────

  describe("setTaskParentAndDepth", () => {
    it("updates parentTaskId and depth in one call", () => {
      makeTask("parent", { depth: 0 });
      makeTask("child", { depth: 2, parentTaskId: "old-parent" });

      taskStore.setTaskParentAndDepth("child", "parent", 1);

      const child = taskStore.getTask("child");
      expect(child!.parentTaskId).toBe("parent");
      expect(child!.depth).toBe(1);
    });

    it("sets updatedAt timestamp", () => {
      makeTask("parent");
      makeTask("child");
      const before = taskStore.getTask("child")!.updatedAt;

      taskStore.setTaskParentAndDepth("child", "parent", 1);

      const after = taskStore.getTask("child")!.updatedAt;
      expect(after).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(after! >= before!).toBe(true);
    });

    it("preserves other task fields", () => {
      makeTask("parent");
      makeTask("child", { title: "Unique Title", description: "Unique desc" });

      taskStore.setTaskParentAndDepth("child", "parent", 1);

      const child = taskStore.getTask("child");
      expect(child!.title).toBe("Unique Title");
      expect(child!.description).toBe("Unique desc");
    });
  });

  // ── bumpTaskDepths ───────────────────────────────────────────────

  describe("bumpTaskDepths", () => {
    it("increments depth by delta for all specified task ids", () => {
      makeTask("t1", { depth: 2 });
      makeTask("t2", { depth: 3 });

      taskStore.bumpTaskDepths(["t1", "t2"], 2);

      expect(taskStore.getTask("t1")!.depth).toBe(4);
      expect(taskStore.getTask("t2")!.depth).toBe(5);
    });

    it("decrements depth by negative delta", () => {
      makeTask("t1", { depth: 3 });
      makeTask("t2", { depth: 4 });

      taskStore.bumpTaskDepths(["t1", "t2"], -2);

      expect(taskStore.getTask("t1")!.depth).toBe(1);
      expect(taskStore.getTask("t2")!.depth).toBe(2);
    });

    it("leaves unspecified tasks unchanged", () => {
      makeTask("t1", { depth: 2 });
      makeTask("t2", { depth: 5 });

      taskStore.bumpTaskDepths(["t1"], 1);

      expect(taskStore.getTask("t1")!.depth).toBe(3);
      expect(taskStore.getTask("t2")!.depth).toBe(5);
    });

    it("is a no-op for an empty ids array", () => {
      makeTask("t1", { depth: 2 });
      taskStore.bumpTaskDepths([], 10);
      expect(taskStore.getTask("t1")!.depth).toBe(2);
    });

    it("sets updatedAt for bumped tasks", () => {
      makeTask("t1", { depth: 1 });
      const before = taskStore.getTask("t1")!.updatedAt;

      taskStore.bumpTaskDepths(["t1"], 1);

      const after = taskStore.getTask("t1")!.updatedAt;
      expect(after! >= before!).toBe(true);
    });
  });
});
