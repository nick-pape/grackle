import { describe, it, expect } from "vitest";
import {
  buildTaskAncestorChain,
  buildHomeBreadcrumbs,
  buildSettingsBreadcrumbs,
  buildWorkspaceBreadcrumbs,
  buildTaskBreadcrumbs,
  buildNewTaskBreadcrumbs,
  buildNewChatBreadcrumbs,
  buildSessionBreadcrumbs,
  type BreadcrumbSegment,
} from "./breadcrumbs.js";
import type { TaskData, Workspace } from "../hooks/useGrackleSocket.js";
import { getStatusBadgeClassKey, getStatusStyle } from "./taskStatus.js";

/** Creates a minimal TaskData for testing. */
function makeTask(overrides: Partial<TaskData> & { id: string; workspaceId: string }): TaskData {
  return {
    title: overrides.id,
    description: "",
    status: "not_started",
    branch: "",
    latestSessionId: "",
    dependsOn: [],
    sortOrder: 0,
    createdAt: "",
    parentTaskId: "",
    depth: 0,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    ...overrides,
  };
}

/** Creates a minimal Workspace for testing. */
function makeWorkspace(overrides: Partial<Workspace> & { id: string; name: string }): Workspace {
  return {
    description: "",
    repoUrl: "",
    defaultEnvironmentId: "",
    status: "active",
    createdAt: "",
    worktreeBasePath: "",
    useWorktrees: false,
    defaultPersonaId: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("buildTaskAncestorChain", () => {
  it("returns single task when no parent", () => {
    const task: TaskData = makeTask({ id: "t1", workspaceId: "p1", title: "Root" });
    const byId: Map<string, TaskData> = new Map([["t1", task]]);

    const chain: TaskData[] = buildTaskAncestorChain("t1", byId);
    expect(chain).toHaveLength(1);
    expect(chain[0].id).toBe("t1");
  });

  it("returns ancestor chain root-first", () => {
    const root: TaskData = makeTask({ id: "t1", workspaceId: "p1", title: "Root" });
    const child: TaskData = makeTask({ id: "t2", workspaceId: "p1", title: "Child", parentTaskId: "t1", depth: 1 });
    const grandchild: TaskData = makeTask({ id: "t3", workspaceId: "p1", title: "Grandchild", parentTaskId: "t2", depth: 2 });
    const byId: Map<string, TaskData> = new Map([["t1", root], ["t2", child], ["t3", grandchild]]);

    const chain: TaskData[] = buildTaskAncestorChain("t3", byId);
    expect(chain).toHaveLength(3);
    expect(chain[0].title).toBe("Root");
    expect(chain[1].title).toBe("Child");
    expect(chain[2].title).toBe("Grandchild");
  });

  it("handles missing parent gracefully", () => {
    const task: TaskData = makeTask({ id: "t1", workspaceId: "p1", title: "Orphan", parentTaskId: "missing" });
    const byId: Map<string, TaskData> = new Map([["t1", task]]);

    const chain: TaskData[] = buildTaskAncestorChain("t1", byId);
    expect(chain).toHaveLength(1);
    expect(chain[0].title).toBe("Orphan");
  });

  it("guards against cycles", () => {
    const t1: TaskData = makeTask({ id: "t1", workspaceId: "p1", parentTaskId: "t2" });
    const t2: TaskData = makeTask({ id: "t2", workspaceId: "p1", parentTaskId: "t1" });
    const byId: Map<string, TaskData> = new Map([["t1", t1], ["t2", t2]]);

    const chain: TaskData[] = buildTaskAncestorChain("t1", byId);
    // Should not infinite-loop; returns at most the 2 tasks
    expect(chain.length).toBeLessThanOrEqual(2);
  });
});

describe("breadcrumb builders", () => {
  it("home returns Home as non-clickable", () => {
    const segments: BreadcrumbSegment[] = buildHomeBreadcrumbs();
    expect(segments).toHaveLength(1);
    expect(segments[0].label).toBe("Home");
    expect(segments[0].url).toBeUndefined();
  });

  it("settings returns Home > Settings when no tab specified", () => {
    const segments: BreadcrumbSegment[] = buildSettingsBreadcrumbs();
    expect(segments).toHaveLength(2);
    expect(segments[0].label).toBe("Home");
    expect(segments[0].url).toBe("/");
    expect(segments[1].label).toBe("Settings");
    expect(segments[1].url).toBeUndefined();
  });

  it("settings with tab returns Home > Settings > TabLabel", () => {
    const segments: BreadcrumbSegment[] = buildSettingsBreadcrumbs("Environments");
    expect(segments).toHaveLength(3);
    expect(segments[0].label).toBe("Home");
    expect(segments[0].url).toBe("/");
    expect(segments[1].label).toBe("Settings");
    expect(segments[1].url).toBe("/settings");
    expect(segments[2].label).toBe("Environments");
    expect(segments[2].url).toBeUndefined();
  });

  it("workspace returns Home > WorkspaceName", () => {
    const workspaces: Workspace[] = [makeWorkspace({ id: "p1", name: "My Workspace" })];
    const segments: BreadcrumbSegment[] = buildWorkspaceBreadcrumbs("p1", workspaces);
    expect(segments).toHaveLength(2);
    expect(segments[0].label).toBe("Home");
    expect(segments[0].url).toBe("/");
    expect(segments[1].label).toBe("My Workspace");
    expect(segments[1].url).toBeUndefined();
  });

  it("task returns Home > Workspace > Task", () => {
    const workspaces: Workspace[] = [makeWorkspace({ id: "p1", name: "Proj" })];
    const task: TaskData = makeTask({ id: "t1", workspaceId: "p1", title: "My Task" });
    const byId: Map<string, TaskData> = new Map([["t1", task]]);

    const segments: BreadcrumbSegment[] = buildTaskBreadcrumbs("t1", workspaces, byId);
    expect(segments).toHaveLength(3);
    expect(segments[0].label).toBe("Home");
    expect(segments[1].label).toBe("Proj");
    expect(segments[1].url).toBe("/workspaces/p1");
    expect(segments[2].label).toBe("My Task");
    expect(segments[2].url).toBeUndefined();
  });

  it("nested task includes ancestor chain", () => {
    const workspaces: Workspace[] = [makeWorkspace({ id: "p1", name: "Proj" })];
    const root: TaskData = makeTask({ id: "t1", workspaceId: "p1", title: "Root" });
    const child: TaskData = makeTask({ id: "t2", workspaceId: "p1", title: "Child", parentTaskId: "t1", depth: 1 });
    const grandchild: TaskData = makeTask({ id: "t3", workspaceId: "p1", title: "Grandchild", parentTaskId: "t2", depth: 2 });
    const byId: Map<string, TaskData> = new Map([["t1", root], ["t2", child], ["t3", grandchild]]);

    const segments: BreadcrumbSegment[] = buildTaskBreadcrumbs("t3", workspaces, byId);
    expect(segments).toHaveLength(5); // Home > Proj > Root > Child > Grandchild
    expect(segments[0].label).toBe("Home");
    expect(segments[1].label).toBe("Proj");
    expect(segments[2].label).toBe("Root");
    expect(segments[2].url).toBe("/tasks/t1");
    expect(segments[3].label).toBe("Child");
    expect(segments[3].url).toBe("/tasks/t2");
    expect(segments[4].label).toBe("Grandchild");
    expect(segments[4].url).toBeUndefined();
  });

  it("new task with parentTaskId shows ancestor chain", () => {
    const workspaces: Workspace[] = [makeWorkspace({ id: "p1", name: "Proj" })];
    const parent: TaskData = makeTask({ id: "t1", workspaceId: "p1", title: "Parent" });
    const byId: Map<string, TaskData> = new Map([["t1", parent]]);

    const segments: BreadcrumbSegment[] = buildNewTaskBreadcrumbs("p1", "t1", workspaces, byId);
    expect(segments).toHaveLength(4); // Home > Proj > Parent > New Task
    expect(segments[2].label).toBe("Parent");
    expect(segments[3].label).toBe("New Task");
    expect(segments[3].url).toBeUndefined();
  });

  it("new chat returns Home > New Chat", () => {
    const segments: BreadcrumbSegment[] = buildNewChatBreadcrumbs();
    expect(segments).toHaveLength(2);
    expect(segments[1].label).toBe("New Chat");
  });

  it("session returns Home > Session prefix", () => {
    const segments: BreadcrumbSegment[] = buildSessionBreadcrumbs("abcdef1234567890");
    expect(segments).toHaveLength(2);
    expect(segments[1].label).toBe("Session abcdef12");
  });
});

describe("task status helpers", () => {
  it("maps legacy task statuses to canonical styles", () => {
    expect(getStatusStyle("pending").label).toBe("Not Started");
    expect(getStatusStyle("in_progress").label).toBe("Working");
    expect(getStatusStyle("review").label).toBe("Paused");
    expect(getStatusStyle("done").label).toBe("Complete");
  });

  it("maps legacy task statuses to canonical badge classes", () => {
    expect(getStatusBadgeClassKey("pending")).toBe("statusPending");
    expect(getStatusBadgeClassKey("in_progress")).toBe("statusInProgress");
    expect(getStatusBadgeClassKey("waiting_input")).toBe("statusWaitingInput");
    expect(getStatusBadgeClassKey("done")).toBe("statusDone");
  });
});
