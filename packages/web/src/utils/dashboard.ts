/**
 * Dashboard data selectors — derive KPIs, attention lists, and rollups
 * from the live Grackle state (sessions, tasks, environments, workspaces).
 */

import type { Environment, Session, TaskData, Workspace } from "../hooks/types.js";

// ─── KPI computation ────────────────────────────────────────────────────────

/** Summary KPIs surfaced across the top of the dashboard. */
export interface DashboardKpis {
  activeSessions: number;
  blockedTasks: number;
  attentionTasks: number;
  unhealthyEnvironments: number;
}

/** Compute dashboard KPI counts from live state. */
export function computeKpis(
  sessions: Session[],
  tasks: TaskData[],
  environments: Environment[],
): DashboardKpis {
  const activeSessions = sessions.filter(
    (s) => s.status === "running" || s.status === "idle" || s.status === "waiting",
  ).length;

  const taskStatusById = buildTaskStatusMap(tasks);

  const blockedTasks = tasks.filter((t) => isTaskBlocked(t, taskStatusById)).length;

  const attentionTasks = tasks.filter(
    (t) =>
      t.status === "paused" ||
      t.status === "failed" ||
      isTaskBlocked(t, taskStatusById),
  ).length;

  const unhealthyEnvironments = environments.filter(
    (e) => e.status === "disconnected" || e.status === "error",
  ).length;

  return { activeSessions, blockedTasks, attentionTasks, unhealthyEnvironments };
}

// ─── Task helpers ───────────────────────────────────────────────────────────

/** Build a lookup map of task-id → status. */
function buildTaskStatusMap(tasks: TaskData[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of tasks) {
    map.set(t.id, t.status);
  }
  return map;
}

/** Returns true if the task has unresolved (non-complete) dependencies. */
function isTaskBlocked(task: TaskData, statusMap: Map<string, string>): boolean {
  return task.dependsOn.some((depId) => statusMap.get(depId) !== "complete");
}

/** A task that needs operator attention (blocked, paused, or failed). */
export interface AttentionTask {
  task: TaskData;
  reason: "blocked" | "paused" | "failed";
  workspaceName: string;
}

/** Collect tasks requiring attention, ordered: failed → blocked → paused. */
export function getAttentionTasks(
  tasks: TaskData[],
  workspaces: Workspace[],
): AttentionTask[] {
  const wsMap = new Map<string, Workspace>();
  for (const ws of workspaces) {
    wsMap.set(ws.id, ws);
  }
  const taskStatusMap = buildTaskStatusMap(tasks);

  const result: AttentionTask[] = [];

  for (const task of tasks) {
    const workspaceName = task.workspaceId
      ? (wsMap.get(task.workspaceId)?.name ?? "Unknown")
      : "Unknown";

    if (task.status === "failed") {
      result.push({ task, reason: "failed", workspaceName });
    } else if (isTaskBlocked(task, taskStatusMap)) {
      result.push({ task, reason: "blocked", workspaceName });
    } else if (task.status === "paused") {
      result.push({ task, reason: "paused", workspaceName });
    }
  }

  // Sort: failed first, then blocked, then paused
  const ORDER: Record<string, number> = { failed: 0, blocked: 1, paused: 2 };
  result.sort((a, b) => (ORDER[a.reason] ?? 3) - (ORDER[b.reason] ?? 3));

  return result;
}

// ─── Active sessions with context ───────────────────────────────────────────

/** A session enriched with display context. */
export interface ActiveSession {
  session: Session;
  environmentName: string;
}

/** Get active sessions (running/idle/waiting) with resolved environment names. */
export function getActiveSessions(
  sessions: Session[],
  environments: Environment[],
): ActiveSession[] {
  const envMap = new Map<string, Environment>();
  for (const e of environments) {
    envMap.set(e.id, e);
  }

  return sessions
    .filter((s) => s.status === "running" || s.status === "idle" || s.status === "waiting")
    .map((session) => ({
      session,
      environmentName: envMap.get(session.environmentId)?.displayName ?? "Unknown",
    }));
}

// ─── Workspace snapshots ────────────────────────────────────────────────────

/** Progress rollup for a single workspace. */
export interface WorkspaceSnapshot {
  workspace: Workspace;
  totalTasks: number;
  completedTasks: number;
  workingTasks: number;
  failedTasks: number;
  environmentName: string;
}

/** Build progress snapshots for each workspace. */
export function getWorkspaceSnapshots(
  workspaces: Workspace[],
  tasks: TaskData[],
  environments: Environment[],
): WorkspaceSnapshot[] {
  const envMap = new Map<string, Environment>();
  for (const e of environments) {
    envMap.set(e.id, e);
  }

  return workspaces.map((workspace) => {
    const wsTasks = tasks.filter((t) => t.workspaceId === workspace.id);
    return {
      workspace,
      totalTasks: wsTasks.length,
      completedTasks: wsTasks.filter((t) => t.status === "complete").length,
      workingTasks: wsTasks.filter((t) => t.status === "working").length,
      failedTasks: wsTasks.filter((t) => t.status === "failed").length,
      environmentName: envMap.get(workspace.environmentId)?.displayName ?? "—",
    };
  });
}
