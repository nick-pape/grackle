import db from "./db.js";
import { workspaceEnvironmentLinks } from "./schema.js";
import { eq, and, inArray, sql, asc } from "drizzle-orm";

/** Create a link between a workspace and an environment. Throws on duplicate. */
export function linkEnvironment(workspaceId: string, environmentId: string): void {
  db.insert(workspaceEnvironmentLinks).values({ workspaceId, environmentId }).run();
}

/** Remove a link between a workspace and an environment. No-op if not linked. */
export function unlinkEnvironment(workspaceId: string, environmentId: string): void {
  db.delete(workspaceEnvironmentLinks)
    .where(and(
      eq(workspaceEnvironmentLinks.workspaceId, workspaceId),
      eq(workspaceEnvironmentLinks.environmentId, environmentId),
    ))
    .run();
}

/** Return all linked environment IDs for a workspace, ordered deterministically by ID. */
export function getLinkedEnvironmentIds(workspaceId: string): string[] {
  const rows = db.select({ environmentId: workspaceEnvironmentLinks.environmentId })
    .from(workspaceEnvironmentLinks)
    .where(eq(workspaceEnvironmentLinks.workspaceId, workspaceId))
    .orderBy(asc(workspaceEnvironmentLinks.environmentId))
    .all();
  return rows.map((r) => r.environmentId);
}

/** Return all workspace IDs linked to an environment. */
export function getWorkspaceIdsLinkedToEnvironment(environmentId: string): string[] {
  const rows = db.select({ workspaceId: workspaceEnvironmentLinks.workspaceId })
    .from(workspaceEnvironmentLinks)
    .where(eq(workspaceEnvironmentLinks.environmentId, environmentId))
    .all();
  return rows.map((r) => r.workspaceId);
}

/**
 * Batch-fetch linked environment IDs for multiple workspaces in a single query.
 * Returns a Map from workspace ID to its linked environment IDs.
 */
export function getLinkedEnvironmentIdsByWorkspaces(workspaceIds: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (workspaceIds.length === 0) {
    return result;
  }
  const rows = db.select({
    workspaceId: workspaceEnvironmentLinks.workspaceId,
    environmentId: workspaceEnvironmentLinks.environmentId,
  })
    .from(workspaceEnvironmentLinks)
    .where(inArray(workspaceEnvironmentLinks.workspaceId, workspaceIds))
    .orderBy(asc(workspaceEnvironmentLinks.environmentId))
    .all();
  for (const row of rows) {
    const existing = result.get(row.workspaceId);
    if (existing) {
      existing.push(row.environmentId);
    } else {
      result.set(row.workspaceId, [row.environmentId]);
    }
  }
  return result;
}

/** Check whether a specific link exists. */
export function isLinked(workspaceId: string, environmentId: string): boolean {
  const row = db.select({ workspaceId: workspaceEnvironmentLinks.workspaceId })
    .from(workspaceEnvironmentLinks)
    .where(and(
      eq(workspaceEnvironmentLinks.workspaceId, workspaceId),
      eq(workspaceEnvironmentLinks.environmentId, environmentId),
    ))
    .get();
  return row !== undefined;
}

/** Count how many workspaces are linked to an environment. */
export function countLinksForEnvironment(environmentId: string): number {
  const row = db.select({ count: sql<number>`count(*)` })
    .from(workspaceEnvironmentLinks)
    .where(eq(workspaceEnvironmentLinks.environmentId, environmentId))
    .get();
  return row?.count ?? 0;
}

/** Delete all links for an environment (cascade helper for env removal). */
export function deleteLinksForEnvironment(environmentId: string): void {
  db.delete(workspaceEnvironmentLinks)
    .where(eq(workspaceEnvironmentLinks.environmentId, environmentId))
    .run();
}

/** Delete all links for a workspace (cascade helper for workspace archive/delete). */
export function deleteLinksForWorkspace(workspaceId: string): void {
  db.delete(workspaceEnvironmentLinks)
    .where(eq(workspaceEnvironmentLinks.workspaceId, workspaceId))
    .run();
}
