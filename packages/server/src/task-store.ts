import { rawDb as db } from "./db.js";
import type { TaskStatus } from "@grackle/common";

export interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: string;
  branch: string;
  env_id: string;
  session_id: string;
  depends_on: string; // JSON array of task IDs
  assigned_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  review_notes: string;
  created_at: string;
  updated_at: string;
  sort_order: number;
}

const stmts = {
  create: db.prepare(`
    INSERT INTO tasks (id, project_id, title, description, branch, env_id, depends_on, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  get: db.prepare("SELECT * FROM tasks WHERE id = ?"),
  listByProject: db.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY sort_order, created_at"),
  update: db.prepare(`
    UPDATE tasks SET title = ?, description = ?, status = ?, env_id = ?, depends_on = ?,
    review_notes = ?, updated_at = datetime('now') WHERE id = ?
  `),
  updateStatus: db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?"),
  setSession: db.prepare("UPDATE tasks SET session_id = ?, updated_at = datetime('now') WHERE id = ?"),
  setStarted: db.prepare("UPDATE tasks SET status = 'in_progress', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"),
  setCompleted: db.prepare("UPDATE tasks SET status = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"),
  delete: db.prepare("DELETE FROM tasks WHERE id = ?"),
  maxSortOrder: db.prepare("SELECT MAX(sort_order) as max_order FROM tasks WHERE project_id = ?"),
};

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export function createTask(
  id: string,
  projectId: string,
  title: string,
  description: string,
  envId: string,
  dependsOn: string[],
  projectSlug: string,
): void {
  const branch = `${projectSlug}/${slugify(title)}`;
  const depsJson = JSON.stringify(dependsOn);
  const maxRow = stmts.maxSortOrder.get(projectId) as { max_order: number | null } | undefined;
  const sortOrder = (maxRow?.max_order ?? -1) + 1;
  stmts.create.run(id, projectId, title, description, branch, envId, depsJson, sortOrder);
}

export function getTask(id: string): TaskRow | undefined {
  return stmts.get.get(id) as TaskRow | undefined;
}

export function listTasks(projectId: string): TaskRow[] {
  return stmts.listByProject.all(projectId) as TaskRow[];
}

export function updateTask(
  id: string,
  title: string,
  description: string,
  status: string,
  envId: string,
  dependsOn: string[],
  reviewNotes: string,
): void {
  stmts.update.run(title, description, status, envId, JSON.stringify(dependsOn), reviewNotes, id);
}

export function updateTaskStatus(id: string, status: TaskStatus): void {
  stmts.updateStatus.run(status, id);
}

export function setTaskSession(id: string, sessionId: string): void {
  stmts.setSession.run(sessionId, id);
}

export function markTaskStarted(id: string): void {
  stmts.setStarted.run(id);
}

export function markTaskCompleted(id: string, status: "review" | "done" | "failed"): void {
  stmts.setCompleted.run(status, id);
}

export function deleteTask(id: string): void {
  stmts.delete.run(id);
}

export function getUnblockedTasks(projectId: string): TaskRow[] {
  const all = listTasks(projectId);
  return all.filter((task) => {
    if (task.status !== "pending") return false;
    const deps = JSON.parse(task.depends_on) as string[];
    if (deps.length === 0) return true;
    return deps.every((depId) => {
      const dep = all.find((t) => t.id === depId);
      return dep?.status === "done";
    });
  });
}

export function checkAndUnblock(projectId: string): TaskRow[] {
  return getUnblockedTasks(projectId);
}

export function areDependenciesMet(taskId: string): boolean {
  const task = getTask(taskId);
  if (!task) return false;
  const deps = JSON.parse(task.depends_on) as string[];
  if (deps.length === 0) return true;
  return deps.every((depId) => {
    const dep = getTask(depId);
    return dep?.status === "done";
  });
}
