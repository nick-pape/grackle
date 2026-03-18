import db from "./db.js";
import { projects, type ProjectRow } from "./schema.js";
import { eq, desc, sql } from "drizzle-orm";

export type { ProjectRow };

/** Insert a new project record. */
export function createProject(
  id: string,
  name: string,
  description: string,
  repoUrl: string,
  defaultEnvironmentId: string,
  useWorktrees: boolean = true,
  worktreeBasePath: string = "",
  defaultPersonaId: string = "",
): void {
  db.insert(projects).values({
    id,
    name,
    description,
    repoUrl,
    defaultEnvironmentId,
    useWorktrees,
    worktreeBasePath: worktreeBasePath.trim(),
    defaultPersonaId,
  }).run();
}

/** Retrieve a single project by ID. */
export function getProject(id: string): ProjectRow | undefined {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

/** Return all active projects, newest first. */
export function listProjects(): ProjectRow[] {
  return db.select().from(projects)
    .where(eq(projects.status, "active"))
    .orderBy(desc(projects.createdAt))
    .all();
}

/** Mark a project as archived. */
export function archiveProject(id: string): void {
  db.update(projects)
    .set({ status: "archived", updatedAt: sql`datetime('now')` })
    .where(eq(projects.id, id))
    .run();
}

/** Partial-update fields for a project. Undefined means "no change"; empty string means "clear". */
export interface UpdateProjectFields {
  name?: string;
  description?: string;
  repoUrl?: string;
  defaultEnvironmentId?: string;
  /** When false, agents work directly in the main checkout instead of creating a worktree. */
  useWorktrees?: boolean;
  /** Custom base path for worktrees (e.g. /workspaces/my-repo). Empty means use default. */
  worktreeBasePath?: string;
  /** Default persona for tasks in this project. */
  defaultPersonaId?: string;
}

/** Update one or more fields on an existing project. Returns the updated row, or undefined if not found. */
export function updateProject(id: string, fields: UpdateProjectFields): ProjectRow | undefined {
  const sets: Record<string, unknown> = { updatedAt: sql`datetime('now')` };
  if (fields.name !== undefined) {
    sets.name = fields.name;
  }
  if (fields.description !== undefined) {
    sets.description = fields.description;
  }
  if (fields.repoUrl !== undefined) {
    sets.repoUrl = fields.repoUrl;
  }
  if (fields.defaultEnvironmentId !== undefined) {
    sets.defaultEnvironmentId = fields.defaultEnvironmentId;
  }
  if (fields.useWorktrees !== undefined) {
    sets.useWorktrees = fields.useWorktrees;
  }
  if (fields.worktreeBasePath !== undefined) {
    sets.worktreeBasePath = fields.worktreeBasePath.trim();
  }
  if (fields.defaultPersonaId !== undefined) {
    sets.defaultPersonaId = fields.defaultPersonaId;
  }
  db.update(projects).set(sets).where(eq(projects.id, id)).run();
  return getProject(id);
}
