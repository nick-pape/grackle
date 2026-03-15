import { test, expect } from "@playwright/test";
import {
  buildBreadcrumbs,
  buildTaskAncestorChain,
  type BreadcrumbSegment,
} from "../src/utils/breadcrumbs.js";
import type { TaskData, Project } from "../src/hooks/useGrackleSocket.js";

/** Creates a minimal TaskData for testing. */
function makeTask(overrides: Partial<TaskData> & { id: string; projectId: string }): TaskData {
  return {
    title: overrides.id,
    description: "",
    status: "pending",
    branch: "",
    latestSessionId: "",
    dependsOn: [],
    reviewNotes: "",
    sortOrder: 0,
    createdAt: "",
    parentTaskId: "",
    depth: 0,
    childTaskIds: [],
    canDecompose: false,
    ...overrides,
  };
}

/** Creates a minimal Project for testing. */
function makeProject(overrides: Partial<Project> & { id: string; name: string }): Project {
  return {
    description: "",
    repoUrl: "",
    defaultEnvironmentId: "",
    status: "active",
    createdAt: "",
    ...overrides,
  };
}

test.describe("buildTaskAncestorChain", () => {
  test("returns single task when no parent", () => {
    const task: TaskData = makeTask({ id: "t1", projectId: "p1", title: "Root" });
    const byId: Map<string, TaskData> = new Map([["t1", task]]);

    const chain: TaskData[] = buildTaskAncestorChain("t1", byId);
    expect(chain).toHaveLength(1);
    expect(chain[0].id).toBe("t1");
  });

  test("returns ancestor chain root-first", () => {
    const root: TaskData = makeTask({ id: "t1", projectId: "p1", title: "Root" });
    const child: TaskData = makeTask({ id: "t2", projectId: "p1", title: "Child", parentTaskId: "t1", depth: 1 });
    const grandchild: TaskData = makeTask({ id: "t3", projectId: "p1", title: "Grandchild", parentTaskId: "t2", depth: 2 });
    const byId: Map<string, TaskData> = new Map([["t1", root], ["t2", child], ["t3", grandchild]]);

    const chain: TaskData[] = buildTaskAncestorChain("t3", byId);
    expect(chain).toHaveLength(3);
    expect(chain[0].title).toBe("Root");
    expect(chain[1].title).toBe("Child");
    expect(chain[2].title).toBe("Grandchild");
  });

  test("handles missing parent gracefully", () => {
    const task: TaskData = makeTask({ id: "t1", projectId: "p1", title: "Orphan", parentTaskId: "missing" });
    const byId: Map<string, TaskData> = new Map([["t1", task]]);

    const chain: TaskData[] = buildTaskAncestorChain("t1", byId);
    expect(chain).toHaveLength(1);
    expect(chain[0].title).toBe("Orphan");
  });

  test("guards against cycles", () => {
    const t1: TaskData = makeTask({ id: "t1", projectId: "p1", parentTaskId: "t2" });
    const t2: TaskData = makeTask({ id: "t2", projectId: "p1", parentTaskId: "t1" });
    const byId: Map<string, TaskData> = new Map([["t1", t1], ["t2", t2]]);

    const chain: TaskData[] = buildTaskAncestorChain("t1", byId);
    // Should not infinite-loop; returns at most the 2 tasks
    expect(chain.length).toBeLessThanOrEqual(2);
  });
});

test.describe("buildBreadcrumbs", () => {
  const emptyById: Map<string, TaskData> = new Map();
  const emptyProjects: Project[] = [];

  test("empty mode returns Home as non-clickable", () => {
    const segments: BreadcrumbSegment[] = buildBreadcrumbs({ kind: "empty" }, emptyProjects, emptyById);
    expect(segments).toHaveLength(1);
    expect(segments[0].label).toBe("Home");
    expect(segments[0].viewMode).toBeUndefined();
  });

  test("settings mode returns Home > Settings", () => {
    const segments: BreadcrumbSegment[] = buildBreadcrumbs({ kind: "settings" }, emptyProjects, emptyById);
    expect(segments).toHaveLength(2);
    expect(segments[0].label).toBe("Home");
    expect(segments[0].viewMode).toEqual({ kind: "empty" });
    expect(segments[1].label).toBe("Settings");
    expect(segments[1].viewMode).toBeUndefined();
  });

  test("persona_management returns Home > Personas", () => {
    const segments: BreadcrumbSegment[] = buildBreadcrumbs({ kind: "persona_management" }, emptyProjects, emptyById);
    expect(segments).toHaveLength(2);
    expect(segments[1].label).toBe("Personas");
  });

  test("project mode returns Home > ProjectName", () => {
    const projects: Project[] = [makeProject({ id: "p1", name: "My Project" })];
    const segments: BreadcrumbSegment[] = buildBreadcrumbs({ kind: "project", projectId: "p1" }, projects, emptyById);
    expect(segments).toHaveLength(2);
    expect(segments[0].label).toBe("Home");
    expect(segments[0].viewMode).toEqual({ kind: "empty" });
    expect(segments[1].label).toBe("My Project");
    expect(segments[1].viewMode).toBeUndefined();
  });

  test("task mode returns Home > Project > Task", () => {
    const projects: Project[] = [makeProject({ id: "p1", name: "Proj" })];
    const task: TaskData = makeTask({ id: "t1", projectId: "p1", title: "My Task" });
    const byId: Map<string, TaskData> = new Map([["t1", task]]);

    const segments: BreadcrumbSegment[] = buildBreadcrumbs({ kind: "task", taskId: "t1" }, projects, byId);
    expect(segments).toHaveLength(3);
    expect(segments[0].label).toBe("Home");
    expect(segments[1].label).toBe("Proj");
    expect(segments[1].viewMode).toEqual({ kind: "project", projectId: "p1" });
    expect(segments[2].label).toBe("My Task");
    expect(segments[2].viewMode).toBeUndefined();
  });

  test("nested task mode includes ancestor chain", () => {
    const projects: Project[] = [makeProject({ id: "p1", name: "Proj" })];
    const root: TaskData = makeTask({ id: "t1", projectId: "p1", title: "Root" });
    const child: TaskData = makeTask({ id: "t2", projectId: "p1", title: "Child", parentTaskId: "t1", depth: 1 });
    const grandchild: TaskData = makeTask({ id: "t3", projectId: "p1", title: "Grandchild", parentTaskId: "t2", depth: 2 });
    const byId: Map<string, TaskData> = new Map([["t1", root], ["t2", child], ["t3", grandchild]]);

    const segments: BreadcrumbSegment[] = buildBreadcrumbs({ kind: "task", taskId: "t3" }, projects, byId);
    expect(segments).toHaveLength(5); // Home > Proj > Root > Child > Grandchild
    expect(segments[0].label).toBe("Home");
    expect(segments[1].label).toBe("Proj");
    expect(segments[2].label).toBe("Root");
    expect(segments[2].viewMode).toEqual({ kind: "task", taskId: "t1" });
    expect(segments[3].label).toBe("Child");
    expect(segments[3].viewMode).toEqual({ kind: "task", taskId: "t2" });
    expect(segments[4].label).toBe("Grandchild");
    expect(segments[4].viewMode).toBeUndefined();
  });

  test("new_task with parentTaskId shows ancestor chain", () => {
    const projects: Project[] = [makeProject({ id: "p1", name: "Proj" })];
    const parent: TaskData = makeTask({ id: "t1", projectId: "p1", title: "Parent" });
    const byId: Map<string, TaskData> = new Map([["t1", parent]]);

    const segments: BreadcrumbSegment[] = buildBreadcrumbs(
      { kind: "new_task", projectId: "p1", parentTaskId: "t1" },
      projects,
      byId,
    );
    expect(segments).toHaveLength(4); // Home > Proj > Parent > New Task
    expect(segments[2].label).toBe("Parent");
    expect(segments[3].label).toBe("New Task");
    expect(segments[3].viewMode).toBeUndefined();
  });

  test("new_chat returns Home > New Chat", () => {
    const segments: BreadcrumbSegment[] = buildBreadcrumbs(
      { kind: "new_chat", environmentId: "e1", runtime: "test" },
      emptyProjects,
      emptyById,
    );
    expect(segments).toHaveLength(2);
    expect(segments[1].label).toBe("New Chat");
  });

  test("session mode returns Home > Session prefix", () => {
    const segments: BreadcrumbSegment[] = buildBreadcrumbs(
      { kind: "session", sessionId: "abcdef1234567890" },
      emptyProjects,
      emptyById,
    );
    expect(segments).toHaveLength(2);
    expect(segments[1].label).toBe("Session abcdef12");
  });
});
