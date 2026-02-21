import db from "./db.js";

export interface FindingRow {
  id: string;
  project_id: string;
  task_id: string;
  session_id: string;
  category: string;
  title: string;
  content: string;
  tags: string; // JSON array
  created_at: string;
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO findings (id, project_id, task_id, session_id, category, title, content, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  queryByProject: db.prepare("SELECT * FROM findings WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"),
  queryByCategory: db.prepare("SELECT * FROM findings WHERE project_id = ? AND category IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC LIMIT ?"),
};

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
  stmts.insert.run(id, projectId, taskId, sessionId, category, title, content, JSON.stringify(tags));
}

export function queryFindings(
  projectId: string,
  categories?: string[],
  tags?: string[],
  limit?: number,
): FindingRow[] {
  const maxResults = Math.min(limit || 50, 100);

  let results: FindingRow[];
  if (categories && categories.length > 0) {
    results = stmts.queryByCategory.all(projectId, JSON.stringify(categories), maxResults) as FindingRow[];
  } else {
    results = stmts.queryByProject.all(projectId, maxResults) as FindingRow[];
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

export function buildFindingsContext(projectId: string): string {
  const findings = queryFindings(projectId, undefined, undefined, 20);
  if (findings.length === 0) return "";

  const lines = ["## Project Findings (shared knowledge from other agents)\n"];
  let totalChars = lines[0].length;
  const MAX_CHARS = 8000;
  const MAX_PER_FINDING = 500;

  for (const f of findings) {
    const content = f.content.length > MAX_PER_FINDING
      ? f.content.slice(0, MAX_PER_FINDING) + "..."
      : f.content;
    const entry = `### [${f.category}] ${f.title}\n${content}\n`;
    if (totalChars + entry.length > MAX_CHARS) break;
    lines.push(entry);
    totalChars += entry.length;
  }

  return lines.join("\n");
}
