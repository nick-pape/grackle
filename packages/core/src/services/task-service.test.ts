/**
 * Task service tests — business logic for task creation, dependency resolution,
 * and tree operations. Uses a real in-memory SQLite database (no vi.mock for
 * @grackle-ai/database) to verify actual behavior end-to-end.
 *
 * DO NOT add `vi.mock("@grackle-ai/database")` to this file — mixing that mock
 * with setupTestDatabase() causes a vitest worker deadlock.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDatabase } from "@grackle-ai/test-utils/db";
import {
  createTask,
  getUnblockedTasks,
  checkAndUnblock,
  areDependenciesMet,
  detectDependencyCycle,
  buildChildIdsMap,
  getDescendants,
  getAncestors,
  getChildStatusCounts,
  getOrphanedTasks,
  reparentTask,
} from "./task-service.js";
import { taskStore, workspaceStore } from "@grackle-ai/database";
import type { TaskRow } from "@grackle-ai/database";
import { GrackleError } from "@grackle-ai/common";
import { Code } from "@connectrpc/connect";

// ── Test DB ────────────────────────────────────────────────────────────────────

const testDb = setupTestDatabase();
afterAll(() => testDb.cleanup());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Create a workspace for fixture seeding (idempotent per test). */
function setupWorkspace(id: string = "test-proj", name: string = "Test Project"): void {
  workspaceStore.createWorkspace(id, name, "desc", "");
}

// ── createTask ─────────────────────────────────────────────────────────────────

describe("createTask", () => {
  beforeEach(() => {
    testDb.truncateAll();
    setupWorkspace();
  });

  it("creates a root task with depth 0 and empty parentTaskId", () => {
    const row = createTask({ workspaceId: "test-proj", title: "Root Task" });
    expect(row.depth).toBe(0);
    expect(row.parentTaskId).toBe("");
  });

  it("generates a branch from workspace slug and title", () => {
    const row = createTask({ workspaceId: "test-proj", title: "Root Task" });
    expect(row.branch).toBe("test-project/root-task");
  });

  it("creates a child task with depth = parent.depth + 1", () => {
    const parent = createTask({ workspaceId: "test-proj", title: "Parent", canDecompose: true });
    const child = createTask({
      workspaceId: "test-proj",
      title: "Child",
      parentTaskId: parent.id,
    });
    expect(child.depth).toBe(1);
    expect(child.parentTaskId).toBe(parent.id);
  });

  it("generates branch name from parent branch when parent exists", () => {
    const parent = createTask({
      workspaceId: "test-proj",
      title: "Parent Task",
      canDecompose: true,
    });
    const child = createTask({
      workspaceId: "test-proj",
      title: "Child Task",
      parentTaskId: parent.id,
    });
    expect(child.branch).toBe(`${parent.branch}/child-task`);
  });

  it("throws NotFoundError when parent does not exist", () => {
    expect(() =>
      createTask({ workspaceId: "test-proj", title: "Orphan", parentTaskId: "nonexistent" }),
    ).toThrow(GrackleError);
    try {
      createTask({ workspaceId: "test-proj", title: "Orphan", parentTaskId: "nonexistent" });
    } catch (e) {
      expect((e as GrackleError).code).toBe(Code.NotFound);
    }
  });

  it("throws PreconditionError when depth would exceed MAX_TASK_DEPTH", () => {
    let parentId = "";
    // Build a 9-level chain (0..8)
    for (let i = 0; i <= 8; i++) {
      const t = createTask({
        workspaceId: "test-proj",
        title: `Level ${i}`,
        canDecompose: true,
        parentTaskId: parentId || undefined,
      });
      parentId = t.id;
    }
    expect(() =>
      createTask({ workspaceId: "test-proj", title: "Level 9", parentTaskId: parentId }),
    ).toThrow(GrackleError);
    try {
      createTask({ workspaceId: "test-proj", title: "Level 9", parentTaskId: parentId });
    } catch (e) {
      expect((e as GrackleError).code).toBe(Code.FailedPrecondition);
    }
  });

  it("throws PreconditionError when parent lacks decomposition rights", () => {
    const parent = createTask({
      workspaceId: "test-proj",
      title: "Non-decomposable Parent",
      canDecompose: false,
    });
    expect(() =>
      createTask({ workspaceId: "test-proj", title: "Child", parentTaskId: parent.id }),
    ).toThrow(GrackleError);
  });

  it("throws NotFoundError when a dependsOn task does not exist", () => {
    expect(() =>
      createTask({
        workspaceId: "test-proj",
        title: "Task",
        dependsOn: ["nonexistent-dep"],
      }),
    ).toThrow(GrackleError);
  });

  it("allows child under decomposable parent", () => {
    const parent = createTask({ workspaceId: "test-proj", title: "Parent", canDecompose: true });
    const child = createTask({
      workspaceId: "test-proj",
      title: "Child",
      parentTaskId: parent.id,
    });
    expect(child.parentTaskId).toBe(parent.id);
  });

  it("defaults canDecompose to true for root tasks when not specified", () => {
    const task = createTask({ workspaceId: "test-proj", title: "Task" });
    expect(task.canDecompose).toBe(true);
  });

  it("defaults canDecompose to false for child tasks when not specified", () => {
    const parent = createTask({ workspaceId: "test-proj", title: "Parent", canDecompose: true });
    const child = createTask({
      workspaceId: "test-proj",
      title: "Child",
      parentTaskId: parent.id,
    });
    expect(child.canDecompose).toBe(false);
  });

  it("persists explicit canDecompose=true on child", () => {
    const parent = createTask({ workspaceId: "test-proj", title: "Parent", canDecompose: true });
    const child = createTask({
      workspaceId: "test-proj",
      title: "Child",
      parentTaskId: parent.id,
      canDecompose: true,
    });
    expect(child.canDecompose).toBe(true);
  });

  it("chain: parent true → child false → grandchild rejected", () => {
    const parent = createTask({ workspaceId: "test-proj", title: "Parent", canDecompose: true });
    const child = createTask({
      workspaceId: "test-proj",
      title: "Child",
      parentTaskId: parent.id,
      canDecompose: false,
    });
    expect(() =>
      createTask({ workspaceId: "test-proj", title: "Grandchild", parentTaskId: child.id }),
    ).toThrow(GrackleError);
  });

  it("chain: parent true → child true → grandchild succeeds", () => {
    const parent = createTask({ workspaceId: "test-proj", title: "Parent", canDecompose: true });
    const child = createTask({
      workspaceId: "test-proj",
      title: "Child",
      parentTaskId: parent.id,
      canDecompose: true,
    });
    const grandchild = createTask({
      workspaceId: "test-proj",
      title: "Grandchild",
      parentTaskId: child.id,
    });
    expect(grandchild.depth).toBe(2);
  });

  it("uses provided id when supplied", () => {
    const row = createTask({ workspaceId: "test-proj", title: "Task", id: "my-custom-id" });
    expect(row.id).toBe("my-custom-id");
  });

  it("auto-generates id when not supplied", () => {
    const row = createTask({ workspaceId: "test-proj", title: "Task" });
    expect(row.id).toBeTruthy();
    expect(row.id.length).toBe(8);
  });
});

// ── areDependenciesMet ─────────────────────────────────────────────────────────

describe("areDependenciesMet", () => {
  beforeEach(() => {
    testDb.truncateAll();
    setupWorkspace();
  });

  it("returns true when task has no dependencies", () => {
    const t = createTask({ workspaceId: "test-proj", title: "Task" });
    expect(areDependenciesMet(t.id)).toBe(true);
  });

  it("returns true when all dependencies are complete", () => {
    const a = createTask({ workspaceId: "test-proj", title: "Dep A" });
    const b = createTask({ workspaceId: "test-proj", title: "Dep B" });
    const c = createTask({
      workspaceId: "test-proj",
      title: "Task",
      dependsOn: [a.id, b.id],
    });
    taskStore.markTaskComplete(a.id);
    taskStore.markTaskComplete(b.id);
    expect(areDependenciesMet(c.id)).toBe(true);
  });

  it("returns false when some dependencies are not complete", () => {
    const a = createTask({ workspaceId: "test-proj", title: "Dep A" });
    const b = createTask({ workspaceId: "test-proj", title: "Dep B" });
    const c = createTask({
      workspaceId: "test-proj",
      title: "Task",
      dependsOn: [a.id, b.id],
    });
    taskStore.markTaskComplete(a.id);
    expect(areDependenciesMet(c.id)).toBe(false);
  });

  it("returns false when a dependency does not exist", () => {
    // Use insertTask directly to bypass createTask's dep validation — we want to
    // test areDependenciesMet when the stored dep ID no longer resolves.
    taskStore.insertTask({
      id: "c1",
      workspaceId: "test-proj",
      title: "Task",
      description: "",
      branch: "test-proj/task",
      dependsOn: ["nonexistent"],
      parentTaskId: "",
      depth: 0,
      canDecompose: true,
      injectKnowledge: true,
      defaultPersonaId: "",
      tokenBudget: 0,
      costBudgetMillicents: 0,
    });
    expect(areDependenciesMet("c1")).toBe(false);
  });

  it("returns false when task itself does not exist", () => {
    expect(areDependenciesMet("nonexistent")).toBe(false);
  });

  it("returns false when dependency is in working status", () => {
    const a = createTask({ workspaceId: "test-proj", title: "Dep A" });
    const b = createTask({ workspaceId: "test-proj", title: "Task", dependsOn: [a.id] });
    taskStore.updateTaskStatus(a.id, "working");
    expect(areDependenciesMet(b.id)).toBe(false);
  });

  it("handles duplicate dependency IDs correctly", () => {
    const a = createTask({ workspaceId: "test-proj", title: "Dep A" });
    const b = createTask({
      workspaceId: "test-proj",
      title: "Task",
      dependsOn: [a.id, a.id],
    });
    taskStore.markTaskComplete(a.id);
    expect(areDependenciesMet(b.id)).toBe(true);
  });

  it("returns false for tasks in a circular dependency (A→B→A)", () => {
    // We need to insert with raw insertTask since createTask validates deps
    const a = createTask({ workspaceId: "test-proj", title: "Task A" });
    const b = createTask({ workspaceId: "test-proj", title: "Task B" });
    // Manually wire the circular dep via setTaskDependsOn
    taskStore.setTaskDependsOn(a.id, [b.id]);
    taskStore.setTaskDependsOn(b.id, [a.id]);
    expect(areDependenciesMet(a.id)).toBe(false);
    expect(areDependenciesMet(b.id)).toBe(false);
  });
});

// ── getUnblockedTasks / checkAndUnblock ────────────────────────────────────────

describe("getUnblockedTasks", () => {
  beforeEach(() => {
    testDb.truncateAll();
    setupWorkspace();
  });

  it("returns not_started tasks with no dependencies", () => {
    const t1 = createTask({ workspaceId: "test-proj", title: "Task A" });
    const t2 = createTask({ workspaceId: "test-proj", title: "Task B" });
    taskStore.updateTaskStatus(t2.id, "working");

    const unblocked = getUnblockedTasks("test-proj");
    expect(unblocked.map((t) => t.id)).toContain(t1.id);
    expect(unblocked.find((t) => t.id === t2.id)).toBeUndefined();
  });

  it("returns tasks whose deps are all complete", () => {
    const a = createTask({ workspaceId: "test-proj", title: "Dep A" });
    const b = createTask({ workspaceId: "test-proj", title: "Task B", dependsOn: [a.id] });
    taskStore.markTaskComplete(a.id);

    const unblocked = getUnblockedTasks("test-proj");
    expect(unblocked.map((t) => t.id)).toContain(b.id);
  });

  it("excludes tasks with incomplete deps", () => {
    const a = createTask({ workspaceId: "test-proj", title: "Dep A" });
    const b = createTask({ workspaceId: "test-proj", title: "Task B", dependsOn: [a.id] });
    taskStore.updateTaskStatus(a.id, "working");

    const unblocked = getUnblockedTasks("test-proj");
    expect(unblocked.find((t) => t.id === b.id)).toBeUndefined();
  });

  it("excludes tasks not in not_started status", () => {
    const a = createTask({ workspaceId: "test-proj", title: "Dep A" });
    const b = createTask({ workspaceId: "test-proj", title: "Task B", dependsOn: [a.id] });
    taskStore.markTaskComplete(a.id);
    taskStore.updateTaskStatus(b.id, "working");

    const unblocked = getUnblockedTasks("test-proj");
    expect(unblocked.find((t) => t.id === b.id)).toBeUndefined();
  });

  it("handles mixed deps — some complete, some not", () => {
    const a = createTask({ workspaceId: "test-proj", title: "Dep A" });
    const c = createTask({ workspaceId: "test-proj", title: "Dep C" });
    const b = createTask({
      workspaceId: "test-proj",
      title: "Task B",
      dependsOn: [a.id, c.id],
    });
    taskStore.markTaskComplete(a.id);

    const unblocked = getUnblockedTasks("test-proj");
    expect(unblocked.find((t) => t.id === b.id)).toBeUndefined();
  });

  it("scopes to workspaceId when provided", () => {
    setupWorkspace("ws-2", "Second");
    const t1 = createTask({ workspaceId: "test-proj", title: "Task 1" });
    createTask({ workspaceId: "ws-2", title: "Task 2" });

    const unblocked = getUnblockedTasks("test-proj");
    expect(unblocked).toHaveLength(1);
    expect(unblocked[0].id).toBe(t1.id);
  });

  it("excludes tasks in a circular dependency (neither task surfaces)", () => {
    const a = createTask({ workspaceId: "test-proj", title: "Task A" });
    const b = createTask({ workspaceId: "test-proj", title: "Task B" });
    taskStore.setTaskDependsOn(a.id, [b.id]);
    taskStore.setTaskDependsOn(b.id, [a.id]);

    const unblocked = getUnblockedTasks("test-proj");
    expect(unblocked.find((t) => t.id === a.id)).toBeUndefined();
    expect(unblocked.find((t) => t.id === b.id)).toBeUndefined();
  });
});

describe("checkAndUnblock", () => {
  beforeEach(() => {
    testDb.truncateAll();
    setupWorkspace();
  });

  it("returns the same set as getUnblockedTasks (alias contract)", () => {
    const a = createTask({ workspaceId: "test-proj", title: "Dep A" });
    createTask({ workspaceId: "test-proj", title: "Blocked", dependsOn: [a.id] });
    taskStore.markTaskComplete(a.id);

    const viaAlias = checkAndUnblock("test-proj");
    const viaOriginal = getUnblockedTasks("test-proj");

    expect(viaAlias.map((t: TaskRow) => t.id)).toEqual(viaOriginal.map((t: TaskRow) => t.id));
  });

  it("returns no tasks when all pending tasks have incomplete deps", () => {
    const a = createTask({ workspaceId: "test-proj", title: "Dep A" });
    createTask({ workspaceId: "test-proj", title: "Blocked", dependsOn: [a.id] });
    taskStore.updateTaskStatus(a.id, "working");

    expect(checkAndUnblock("test-proj")).toHaveLength(0);
  });
});

// ── detectDependencyCycle ──────────────────────────────────────────────────────

describe("detectDependencyCycle", () => {
  beforeEach(() => {
    testDb.truncateAll();
    setupWorkspace();
  });

  it("detects self-dependency", () => {
    const t1 = createTask({ workspaceId: "test-proj", title: "Task A" });
    const result = detectDependencyCycle(t1.id, [t1.id]);
    expect(result).toEqual([t1.id]);
  });

  it("detects direct cycle (A->B, B->A)", () => {
    const t1 = createTask({ workspaceId: "test-proj", title: "Task A" });
    const t2 = createTask({ workspaceId: "test-proj", title: "Task B", dependsOn: [t1.id] });
    const result = detectDependencyCycle(t1.id, [t2.id]);
    expect(result).toEqual([t2.id]);
  });

  it("detects transitive cycle (A->B->C->A)", () => {
    const t1 = createTask({ workspaceId: "test-proj", title: "Task A" });
    const t2 = createTask({ workspaceId: "test-proj", title: "Task B", dependsOn: [t1.id] });
    const t3 = createTask({ workspaceId: "test-proj", title: "Task C", dependsOn: [t2.id] });
    const result = detectDependencyCycle(t1.id, [t3.id]);
    expect(result).toEqual([t3.id, t2.id]);
  });

  it("returns undefined for valid dependencies (no cycle)", () => {
    const t1 = createTask({ workspaceId: "test-proj", title: "Task A" });
    const t2 = createTask({ workspaceId: "test-proj", title: "Task B" });
    createTask({ workspaceId: "test-proj", title: "Task C", dependsOn: [t1.id] });
    const result = detectDependencyCycle(t1.id, [t2.id]);
    expect(result).toBeUndefined();
  });

  it("returns undefined for diamond dependency (no cycle)", () => {
    const t1 = createTask({ workspaceId: "test-proj", title: "Task D" });
    const t2 = createTask({ workspaceId: "test-proj", title: "Task B", dependsOn: [t1.id] });
    const t3 = createTask({ workspaceId: "test-proj", title: "Task C", dependsOn: [t1.id] });
    const t4 = createTask({
      workspaceId: "test-proj",
      title: "Task A",
      dependsOn: [t2.id, t3.id],
    });
    const result = detectDependencyCycle(t4.id, [t2.id, t3.id]);
    expect(result).toBeUndefined();
  });

  it("handles nonexistent dependency gracefully", () => {
    const t1 = createTask({ workspaceId: "test-proj", title: "Task A" });
    const result = detectDependencyCycle(t1.id, ["nonexistent"]);
    expect(result).toBeUndefined();
  });
});

// ── buildChildIdsMap ───────────────────────────────────────────────────────────

describe("buildChildIdsMap", () => {
  beforeEach(() => {
    testDb.truncateAll();
    setupWorkspace();
  });

  it("maps parent ids to child id arrays", () => {
    const parent = createTask({ workspaceId: "test-proj", title: "Parent", canDecompose: true });
    const c1 = createTask({
      workspaceId: "test-proj",
      title: "Child 1",
      parentTaskId: parent.id,
    });
    const c2 = createTask({
      workspaceId: "test-proj",
      title: "Child 2",
      parentTaskId: parent.id,
    });

    const all = taskStore.listTasks("test-proj");
    const map = buildChildIdsMap(all);

    expect(map.get(parent.id)).toEqual(expect.arrayContaining([c1.id, c2.id]));
  });

  it("returns empty map for flat task list", () => {
    createTask({ workspaceId: "test-proj", title: "Task A" });
    createTask({ workspaceId: "test-proj", title: "Task B" });

    const all = taskStore.listTasks("test-proj");
    const map = buildChildIdsMap(all);

    expect(map.size).toBe(0);
  });
});

// ── getDescendants ─────────────────────────────────────────────────────────────

describe("getDescendants", () => {
  beforeEach(() => {
    testDb.truncateAll();
    setupWorkspace();
  });

  it("returns full subtree for a 3-level hierarchy", () => {
    const root = createTask({ workspaceId: "test-proj", title: "Root", canDecompose: true });
    const child = createTask({
      workspaceId: "test-proj",
      title: "Child",
      parentTaskId: root.id,
      canDecompose: true,
    });
    const grandchild = createTask({
      workspaceId: "test-proj",
      title: "Grandchild",
      parentTaskId: child.id,
    });

    const descendants = getDescendants(root.id);
    expect(descendants).toHaveLength(2);
    const ids = descendants.map((d) => d.id);
    expect(ids).toContain(child.id);
    expect(ids).toContain(grandchild.id);
  });

  it("returns empty array for leaf tasks", () => {
    const leaf = createTask({ workspaceId: "test-proj", title: "Leaf" });
    expect(getDescendants(leaf.id)).toHaveLength(0);
  });

  it("returns empty array for unknown task id", () => {
    expect(getDescendants("no-such-id")).toHaveLength(0);
  });
});

// ── getAncestors ───────────────────────────────────────────────────────────────

describe("getAncestors", () => {
  beforeEach(() => {
    testDb.truncateAll();
    setupWorkspace();
  });

  it("returns path from task to root, root-first", () => {
    const root = createTask({ workspaceId: "test-proj", title: "Root", canDecompose: true });
    const child = createTask({
      workspaceId: "test-proj",
      title: "Child",
      parentTaskId: root.id,
      canDecompose: true,
    });
    const grandchild = createTask({
      workspaceId: "test-proj",
      title: "Grandchild",
      parentTaskId: child.id,
    });

    const ancestors = getAncestors(grandchild.id);
    expect(ancestors).toHaveLength(2);
    expect(ancestors[0].id).toBe(root.id);
    expect(ancestors[1].id).toBe(child.id);
  });

  it("returns empty array for root tasks", () => {
    const root = createTask({ workspaceId: "test-proj", title: "Root" });
    expect(getAncestors(root.id)).toHaveLength(0);
  });

  it("returns empty array for unknown task id", () => {
    expect(getAncestors("no-such-id")).toHaveLength(0);
  });
});

// ── getChildStatusCounts ───────────────────────────────────────────────────────

describe("getChildStatusCounts", () => {
  beforeEach(() => {
    testDb.truncateAll();
    setupWorkspace();
  });

  it("returns correct counts by status", () => {
    const parent = createTask({ workspaceId: "test-proj", title: "Parent", canDecompose: true });
    const done = createTask({
      workspaceId: "test-proj",
      title: "Done Child",
      parentTaskId: parent.id,
    });
    createTask({ workspaceId: "test-proj", title: "Pending Child", parentTaskId: parent.id });
    createTask({ workspaceId: "test-proj", title: "Another Pending", parentTaskId: parent.id });

    taskStore.updateTaskStatus(done.id, "complete");

    const counts = getChildStatusCounts(parent.id);
    expect(counts.complete).toBe(1);
    expect(counts.not_started).toBe(2);
  });

  it("returns empty record for leaf tasks", () => {
    const leaf = createTask({ workspaceId: "test-proj", title: "Leaf" });
    const counts = getChildStatusCounts(leaf.id);
    expect(Object.keys(counts)).toHaveLength(0);
  });
});

// ── getOrphanedTasks ───────────────────────────────────────────────────────────

describe("getOrphanedTasks", () => {
  beforeEach(() => {
    testDb.truncateAll();
    setupWorkspace();
  });

  it("returns non-terminal children of a parent", () => {
    const parent = createTask({ workspaceId: "test-proj", title: "Parent", canDecompose: true });
    createTask({ workspaceId: "test-proj", title: "Working Child", parentTaskId: parent.id });
    createTask({ workspaceId: "test-proj", title: "Pending Child", parentTaskId: parent.id });

    const orphans = getOrphanedTasks(parent.id);
    expect(orphans).toHaveLength(2);
  });

  it("excludes already-terminal children (complete)", () => {
    const parent = createTask({ workspaceId: "test-proj", title: "Parent", canDecompose: true });
    const done = createTask({
      workspaceId: "test-proj",
      title: "Done Child",
      parentTaskId: parent.id,
    });
    createTask({ workspaceId: "test-proj", title: "Pending Child", parentTaskId: parent.id });

    taskStore.markTaskComplete(done.id, "complete");

    const orphans = getOrphanedTasks(parent.id);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].id).not.toBe(done.id);
  });

  it("excludes failed children", () => {
    const parent = createTask({ workspaceId: "test-proj", title: "Parent", canDecompose: true });
    const failed = createTask({
      workspaceId: "test-proj",
      title: "Failed Child",
      parentTaskId: parent.id,
    });
    createTask({ workspaceId: "test-proj", title: "Active Child", parentTaskId: parent.id });

    taskStore.markTaskComplete(failed.id, "failed");

    const orphans = getOrphanedTasks(parent.id);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].id).not.toBe(failed.id);
  });

  it("returns empty array when parent has no children", () => {
    const leaf = createTask({ workspaceId: "test-proj", title: "Leaf" });
    expect(getOrphanedTasks(leaf.id)).toHaveLength(0);
  });

  it("returns empty array when all children are terminal", () => {
    const parent = createTask({ workspaceId: "test-proj", title: "Parent", canDecompose: true });
    const c1 = createTask({ workspaceId: "test-proj", title: "Done", parentTaskId: parent.id });
    const c2 = createTask({ workspaceId: "test-proj", title: "Failed", parentTaskId: parent.id });
    taskStore.markTaskComplete(c1.id, "complete");
    taskStore.markTaskComplete(c2.id, "failed");

    expect(getOrphanedTasks(parent.id)).toHaveLength(0);
  });
});

// ── reparentTask ───────────────────────────────────────────────────────────────

describe("reparentTask", () => {
  beforeEach(() => {
    testDb.truncateAll();
    setupWorkspace();
  });

  it("moves a child to a new parent and updates parentTaskId", () => {
    const gp = createTask({ workspaceId: "test-proj", title: "Grandparent", canDecompose: true });
    const p = createTask({
      workspaceId: "test-proj",
      title: "Parent",
      parentTaskId: gp.id,
      canDecompose: true,
    });
    const c = createTask({ workspaceId: "test-proj", title: "Child", parentTaskId: p.id });

    reparentTask(c.id, gp.id);

    const child = taskStore.getTask(c.id);
    expect(child!.parentTaskId).toBe(gp.id);
  });

  it("recalculates depth based on new parent", () => {
    const gp = createTask({ workspaceId: "test-proj", title: "Grandparent", canDecompose: true });
    const p = createTask({
      workspaceId: "test-proj",
      title: "Parent",
      parentTaskId: gp.id,
      canDecompose: true,
    });
    const c = createTask({ workspaceId: "test-proj", title: "Child", parentTaskId: p.id });

    // Child was depth 2, moving to grandparent (depth 0) → depth becomes 1
    reparentTask(c.id, gp.id);

    expect(taskStore.getTask(c.id)!.depth).toBe(1);
  });

  it("recalculates depth for entire subtree", () => {
    const gp = createTask({ workspaceId: "test-proj", title: "Grandparent", canDecompose: true });
    const p = createTask({
      workspaceId: "test-proj",
      title: "Parent",
      parentTaskId: gp.id,
      canDecompose: true,
    });
    const c = createTask({
      workspaceId: "test-proj",
      title: "Child",
      parentTaskId: p.id,
      canDecompose: true,
    });
    const gc = createTask({ workspaceId: "test-proj", title: "Grandchild", parentTaskId: c.id });

    // Move child (depth 2) + grandchild (depth 3) up to grandparent (depth 0)
    reparentTask(c.id, gp.id);

    expect(taskStore.getTask(c.id)!.depth).toBe(1);
    expect(taskStore.getTask(gc.id)!.depth).toBe(2);
  });

  it("preserves other task fields", () => {
    const gp = createTask({ workspaceId: "test-proj", title: "Grandparent", canDecompose: true });
    const p = createTask({
      workspaceId: "test-proj",
      title: "Parent",
      parentTaskId: gp.id,
      canDecompose: true,
    });
    const c = createTask({
      workspaceId: "test-proj",
      title: "Child",
      description: "my description",
      parentTaskId: p.id,
    });

    reparentTask(c.id, gp.id);

    const child = taskStore.getTask(c.id);
    expect(child!.title).toBe("Child");
    expect(child!.description).toBe("my description");
    expect(child!.workspaceId).toBe("test-proj");
  });

  it("throws NotFoundError when task does not exist", () => {
    const gp = createTask({ workspaceId: "test-proj", title: "Grandparent", canDecompose: true });
    expect(() => reparentTask("nonexistent", gp.id)).toThrow(GrackleError);
  });

  it("throws NotFoundError when new parent does not exist", () => {
    const c = createTask({ workspaceId: "test-proj", title: "Child" });
    expect(() => reparentTask(c.id, "nonexistent-parent")).toThrow(GrackleError);
  });
});
