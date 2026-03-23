import db from "./db.js";
import { findings, type FindingRow } from "./schema.js";
import { eq, desc, sql, and } from "drizzle-orm";
import { safeParseJsonArray } from "./json-helpers.js";

export type { FindingRow };

/** Insert a new finding record. */
export function postFinding(
  id: string,
  workspaceId: string,
  taskId: string,
  sessionId: string,
  category: string,
  title: string,
  content: string,
  tags: string[],
): void {
  db.insert(findings).values({
    id,
    workspaceId,
    taskId,
    sessionId,
    category,
    title,
    content,
    tags: JSON.stringify(tags),
  }).run();
}

/** Query findings for a workspace, optionally filtering by categories and tags. */
export function queryFindings(
  workspaceId: string,
  categories?: string[],
  tags?: string[],
  limit?: number,
): FindingRow[] {
  const maxResults = Math.min(limit || 50, 100);

  let results: FindingRow[];
  if (categories && categories.length > 0) {
    results = db.select().from(findings)
      .where(and(
        eq(findings.workspaceId, workspaceId),
        sql`${findings.category} IN (SELECT value FROM json_each(${JSON.stringify(categories)}))`,
      ))
      .orderBy(desc(findings.createdAt))
      .limit(maxResults)
      .all();
  } else {
    results = db.select().from(findings)
      .where(eq(findings.workspaceId, workspaceId))
      .orderBy(desc(findings.createdAt))
      .limit(maxResults)
      .all();
  }

  // Client-side tag filtering (simple approach)
  if (tags && tags.length > 0) {
    results = results.filter((r) => {
      const rowTags = safeParseJsonArray(r.tags);
      return tags.some((t) => rowTags.includes(t));
    });
  }

  return results;
}

