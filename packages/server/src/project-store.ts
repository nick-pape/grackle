import db from "./db.js";

export interface ProjectRow {
  id: string;
  name: string;
  description: string;
  repo_url: string;
  default_env_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

const stmts = {
  create: db.prepare(`
    INSERT INTO projects (id, name, description, repo_url, default_env_id)
    VALUES (?, ?, ?, ?, ?)
  `),
  get: db.prepare("SELECT * FROM projects WHERE id = ?"),
  list: db.prepare("SELECT * FROM projects WHERE status = 'active' ORDER BY created_at DESC"),
  listAll: db.prepare("SELECT * FROM projects ORDER BY created_at DESC"),
  archive: db.prepare("UPDATE projects SET status = 'archived', updated_at = datetime('now') WHERE id = ?"),
  update: db.prepare("UPDATE projects SET name = ?, description = ?, repo_url = ?, default_env_id = ?, updated_at = datetime('now') WHERE id = ?"),
};

export function createProject(id: string, name: string, description: string, repoUrl: string, defaultEnvId: string): void {
  stmts.create.run(id, name, description, repoUrl, defaultEnvId);
}

export function getProject(id: string): ProjectRow | undefined {
  return stmts.get.get(id) as ProjectRow | undefined;
}

export function listProjects(): ProjectRow[] {
  return stmts.list.all() as ProjectRow[];
}

export function archiveProject(id: string): void {
  stmts.archive.run(id);
}
