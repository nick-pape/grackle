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
): void {
  db.insert(projects).values({
    id,
    name,
    description,
    repoUrl,
    defaultEnvironmentId,
    useWorktrees,
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

/** Update mutable project settings. */
export function updateProject(
  id: string,
  patch: { useWorktrees?: boolean },
): void {
  const updates: Record<string, unknown> = {
    updatedAt: sql`datetime('now')`,
  };
  if (patch.useWorktrees !== undefined) {
    updates.useWorktrees = patch.useWorktrees;
  }
  db.update(projects)
    .set(updates)
    .where(eq(projects.id, id))
    .run();
}

/** Mark a project as archived. */
export function archiveProject(id: string): void {
  db.update(projects)
    .set({ status: "archived", updatedAt: sql`datetime('now')` })
    .where(eq(projects.id, id))
    .run();
}
