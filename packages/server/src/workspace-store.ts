import db from "./db.js";
import { workspaces, type WorkspaceRow } from "./schema.js";
import { eq, and, desc, sql } from "drizzle-orm";

export type { WorkspaceRow };

/** Insert a new workspace record. */
export function createWorkspace(
  id: string,
  name: string,
  description: string,
  repoUrl: string,
  environmentId: string,
  useWorktrees: boolean = true,
  worktreeBasePath: string = "",
  defaultPersonaId: string = "",
): void {
  db.insert(workspaces).values({
    id,
    name,
    description,
    repoUrl,
    environmentId,
    useWorktrees,
    worktreeBasePath: worktreeBasePath.trim(),
    defaultPersonaId,
  }).run();
}

/** Retrieve a single workspace by ID. */
export function getWorkspace(id: string): WorkspaceRow | undefined {
  return db.select().from(workspaces).where(eq(workspaces.id, id)).get();
}

/** Return all active workspaces, newest first. Optionally filter by environment. */
export function listWorkspaces(environmentId?: string): WorkspaceRow[] {
  const conditions = [eq(workspaces.status, "active")];
  if (environmentId) {
    conditions.push(eq(workspaces.environmentId, environmentId));
  }
  return db.select().from(workspaces)
    .where(and(...conditions))
    .orderBy(desc(workspaces.createdAt))
    .all();
}

/** Count all workspaces (active and archived) belonging to an environment. */
export function countWorkspacesByEnvironment(environmentId: string): number {
  const row = db.select({ count: sql<number>`count(*)` })
    .from(workspaces)
    .where(eq(workspaces.environmentId, environmentId))
    .get();
  return row?.count ?? 0;
}

/** Mark a workspace as archived. */
export function archiveWorkspace(id: string): void {
  db.update(workspaces)
    .set({ status: "archived", updatedAt: sql`datetime('now')` })
    .where(eq(workspaces.id, id))
    .run();
}

/** Partial-update fields for a workspace. Undefined means "no change"; empty string means "clear". */
export interface UpdateWorkspaceFields {
  name?: string;
  description?: string;
  repoUrl?: string;
  /** Reparent workspace to a different environment. */
  environmentId?: string;
  /** When false, agents work directly in the main checkout instead of creating a worktree. */
  useWorktrees?: boolean;
  /** Custom base path for worktrees (e.g. /workspaces/my-repo). Empty means use default. */
  worktreeBasePath?: string;
  /** Default persona for tasks in this workspace. */
  defaultPersonaId?: string;
}

/** Update one or more fields on an existing workspace. Returns the updated row, or undefined if not found. */
export function updateWorkspace(id: string, fields: UpdateWorkspaceFields): WorkspaceRow | undefined {
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
  if (fields.environmentId !== undefined) {
    sets.environmentId = fields.environmentId;
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
  db.update(workspaces).set(sets).where(eq(workspaces.id, id)).run();
  return getWorkspace(id);
}
