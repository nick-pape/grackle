import db from "./db.js";
import { findings, type FindingRow } from "./schema.js";
import { eq, desc, sql, and } from "drizzle-orm";

export type { FindingRow };

/** Insert a new finding record. */
export function postFinding(
  id: string,
  projectId: string,
  taskId: string,
  sessionId: string,
  category: string,
  title: string,
  content: string,
  tags: string[],
): void {
  db.insert(findings).values({
    id,
    projectId,
    taskId,
    sessionId,
    category,
    title,
    content,
    tags: JSON.stringify(tags),
  }).run();
}

/** Query findings for a project, optionally filtering by categories and tags. */
export function queryFindings(
  projectId: string,
  categories?: string[],
  tags?: string[],
  limit?: number,
): FindingRow[] {
  const maxResults = Math.min(limit || 50, 100);

  let results: FindingRow[];
  if (categories && categories.length > 0) {
    results = db.select().from(findings)
      .where(and(
        eq(findings.projectId, projectId),
        sql`${findings.category} IN (SELECT value FROM json_each(${JSON.stringify(categories)}))`,
      ))
      .orderBy(desc(findings.createdAt))
      .limit(maxResults)
      .all();
  } else {
    results = db.select().from(findings)
      .where(eq(findings.projectId, projectId))
      .orderBy(desc(findings.createdAt))
      .limit(maxResults)
      .all();
  }

  // Client-side tag filtering (simple approach)
  if (tags && tags.length > 0) {
    results = results.filter((r) => {
      const rowTags = JSON.parse(r.tags) as string[];
      return tags.some((t) => rowTags.includes(t));
    });
  }

  return results;
}

/** Build a summarized text context of recent findings for a project. */
export function buildFindingsContext(projectId: string): string {
  const allFindings = queryFindings(projectId, undefined, undefined, 20);
  if (allFindings.length === 0) {
    return "";
  }

  const lines = ["## Project Findings (shared knowledge from other agents)\n"];
  let totalChars = lines[0].length;
  const MAX_CHARS = 8000;
  const MAX_PER_FINDING = 500;

  for (const f of allFindings) {
    const content = f.content.length > MAX_PER_FINDING
      ? f.content.slice(0, MAX_PER_FINDING) + "..."
      : f.content;
    const entry = `### [${f.category}] ${f.title}\n${content}\n`;
    if (totalChars + entry.length > MAX_CHARS) {
      break;
    }
    lines.push(entry);
    totalChars += entry.length;
  }

  return lines.join("\n");
}
