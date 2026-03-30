import db from "./db.js";
import { workspaces, workspaceEnvironmentLinks, type WorkspaceRow } from "./schema.js";
import { eq, and, or, desc, sql } from "drizzle-orm";

export type { WorkspaceRow };

/** Insert a new workspace record. */
export function createWorkspace(
  id: string,
  name: string,
  description: string,
  repoUrl: string,
  environmentId: string,
  useWorktrees: boolean = true,
  workingDirectory: string = "",
  defaultPersonaId: string = "",
  tokenBudget: number = 0,
  costBudgetMillicents: number = 0,
): void {
  db.insert(workspaces).values({
    id,
    name,
    description,
    repoUrl,
    environmentId,
    useWorktrees,
    workingDirectory: workingDirectory.trim(),
    defaultPersonaId,
    tokenBudget,
    costBudgetMillicents,
  }).run();
}

/** Retrieve a single workspace by ID. */
export function getWorkspace(id: string): WorkspaceRow | undefined {
  return db.select().from(workspaces).where(eq(workspaces.id, id)).get();
}

/**
 * Return all active workspaces, newest first. Optionally filter by environment.
 * When environmentId is provided, returns workspaces where the environment is
 * either the primary or a linked environment.
 */
export function listWorkspaces(environmentId?: string): WorkspaceRow[] {
  if (environmentId) {
    // Include workspaces where the env is primary OR linked, using a single query.
    return db.select().from(workspaces)
      .where(
        and(
          eq(workspaces.status, "active"),
          or(
            eq(workspaces.environmentId, environmentId),
            sql`exists (
              select 1
              from ${workspaceEnvironmentLinks}
              where ${workspaceEnvironmentLinks.workspaceId} = ${workspaces.id}
                and ${workspaceEnvironmentLinks.environmentId} = ${environmentId}
            )`,
          ),
        ),
      )
      .orderBy(desc(workspaces.createdAt))
      .all();
  }
  return db.select().from(workspaces)
    .where(eq(workspaces.status, "active"))
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
  workingDirectory?: string;
  /** Default persona for tasks in this workspace. */
  defaultPersonaId?: string;
  /** Total token cap across all tasks in this workspace. 0 = unlimited. */
  tokenBudget?: number;
  /** Total cost cap in millicents across all tasks. 0 = unlimited. */
  costBudgetMillicents?: number;
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
  if (fields.workingDirectory !== undefined) {
    sets.workingDirectory = fields.workingDirectory.trim();
  }
  if (fields.defaultPersonaId !== undefined) {
    sets.defaultPersonaId = fields.defaultPersonaId;
  }
  if (fields.tokenBudget !== undefined) {
    sets.tokenBudget = fields.tokenBudget;
  }
  if (fields.costBudgetMillicents !== undefined) {
    sets.costBudgetMillicents = fields.costBudgetMillicents;
  }
  db.update(workspaces).set(sets).where(eq(workspaces.id, id)).run();
  return getWorkspace(id);
}
