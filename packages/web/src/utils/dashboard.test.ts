import { describe, expect, it } from "vitest";
import type { Environment, Session, TaskData, Workspace } from "../hooks/types.js";
import { computeKpis, getAttentionTasks, getWorkspaceSnapshots } from "./dashboard.js";

function makeWorkspace(id: string, name: string, environmentId: string = "env-1"): Workspace {
  return {
    id,
    name,
    description: "",
    repoUrl: "",
    environmentId,
    status: "active",
    workingDirectory: "",
    useWorktrees: true,
    defaultPersonaId: "",
    createdAt: "",
    updatedAt: "",
  };
}

function makeTask(overrides: Partial<TaskData> & { id: string }): TaskData {
  const { id, ...rest } = overrides;
  return {
    id,
    workspaceId: "ws-1",
    title: id,
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
    ...rest,
  };
}

function makeSession(overrides: Partial<Session> & { id: string }): Session {
  const { id, ...rest } = overrides;
  return {
    id,
    environmentId: "env-1",
    runtime: "stub",
    status: "idle",
    prompt: "prompt",
    startedAt: "",
    ...rest,
  };
}

function makeEnvironment(id: string, displayName: string, status: string): Environment {
  return {
    id,
    displayName,
    adapterType: "local",
    adapterConfig: "{}",
    status,
    bootstrapped: true,
  };
}

describe("dashboard selectors", () => {
  it("treats missing dependency tasks as blocked in KPI counts", () => {
    const tasks: TaskData[] = [makeTask({ id: "task-1", dependsOn: ["missing-task"] })];

    const kpis = computeKpis([], tasks, []);

    expect(kpis.blockedTasks).toBe(1);
    expect(kpis.attentionTasks).toBe(1);
  });

  it("orders attention tasks as failed, blocked, then paused", () => {
    const workspaces: Workspace[] = [makeWorkspace("ws-1", "Alpha")];
    const tasks: TaskData[] = [
      makeTask({ id: "paused-task", title: "Paused task", status: "paused" }),
      makeTask({ id: "dependency-source", title: "Dependency source", status: "working" }),
      makeTask({ id: "blocked-task", title: "Blocked task", dependsOn: ["dependency-source"] }),
      makeTask({ id: "failed-task", title: "Failed task", status: "failed" }),
    ];

    const attentionTasks = getAttentionTasks(tasks, workspaces);

    expect(attentionTasks.map((entry) => entry.reason)).toEqual(["failed", "blocked", "paused"]);
    expect(attentionTasks.map((entry) => entry.task.title)).toEqual([
      "Failed task",
      "Blocked task",
      "Paused task",
    ]);
  });

  it("builds workspace snapshots from grouped task stats", () => {
    const workspaces: Workspace[] = [
      makeWorkspace("ws-1", "Alpha", "env-1"),
      makeWorkspace("ws-2", "Beta", "env-2"),
    ];
    const tasks: TaskData[] = [
      makeTask({ id: "a-1", workspaceId: "ws-1", status: "complete" }),
      makeTask({ id: "a-2", workspaceId: "ws-1", status: "working" }),
      makeTask({ id: "a-3", workspaceId: "ws-1", status: "failed" }),
      makeTask({ id: "b-1", workspaceId: "ws-2", status: "not_started" }),
      makeTask({ id: "root-task", workspaceId: undefined, status: "working" }),
    ];
    const environments: Environment[] = [
      makeEnvironment("env-1", "test-local", "connected"),
      makeEnvironment("env-2", "backup", "connected"),
    ];

    const snapshots = getWorkspaceSnapshots(workspaces, tasks, environments);

    expect(snapshots).toEqual([
      {
        workspace: workspaces[0],
        totalTasks: 3,
        completedTasks: 1,
        workingTasks: 1,
        failedTasks: 1,
      },
      {
        workspace: workspaces[1],
        totalTasks: 1,
        completedTasks: 0,
        workingTasks: 0,
        failedTasks: 0,
      },
    ]);
  });

  it("counts active sessions and unhealthy environments", () => {
    const sessions: Session[] = [
      makeSession({ id: "session-1", status: "running" }),
      makeSession({ id: "session-2", status: "idle" }),
      makeSession({ id: "session-3", status: "waiting" }),
      makeSession({ id: "session-4", status: "stopped" }),
    ];
    const environments: Environment[] = [
      makeEnvironment("env-1", "primary", "connected"),
      makeEnvironment("env-2", "secondary", "disconnected"),
      makeEnvironment("env-3", "tertiary", "error"),
    ];

    const kpis = computeKpis(sessions, [], environments);

    expect(kpis.activeSessions).toBe(3);
    expect(kpis.unhealthyEnvironments).toBe(2);
  });
});
