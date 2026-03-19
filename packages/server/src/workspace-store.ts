import db from "./db.js";
import { workspaces, type WorkspaceRow } from "./schema.js";
import { eq, desc, sql } from "drizzle-orm";

export type { WorkspaceRow };

/** Insert a new workspace record. */
export function createWorkspace(
  id: string,
  name: string,
  description: string,
  repoUrl: string,
  defaultEnvironmentId: string,
  useWorktrees: boolean = true,
  worktreeBasePath: string = "",
  defaultPersonaId: string = "",
): void {
  db.insert(workspaces).values({
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

/** Retrieve a single workspace by ID. */
export function getWorkspace(id: string): WorkspaceRow | undefined {
  return db.select().from(workspaces).where(eq(workspaces.id, id)).get();
}

/** Return all active workspaces, newest first. */
export function listWorkspaces(): WorkspaceRow[] {
  return db.select().from(workspaces)
    .where(eq(workspaces.status, "active"))
    .orderBy(desc(workspaces.createdAt))
    .all();
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
  defaultEnvironmentId?: string;
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
  db.update(workspaces).set(sets).where(eq(workspaces.id, id)).run();
  return getWorkspace(id);
}
