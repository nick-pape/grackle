import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { DB_FILENAME } from "@grackle-ai/common";
import { grackleHome } from "./paths.js";
import * as schema from "./schema.js";

mkdirSync(grackleHome, { recursive: true });

const dbPath: string = join(grackleHome, DB_FILENAME);
const sqlite: InstanceType<typeof Database> = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
sqlite.pragma("journal_mode = WAL");

// Enable foreign key enforcement (off by default in SQLite)
sqlite.pragma("foreign_keys = ON");

/** Initialize all database tables and run migrations. Call once at startup. */
export function initDatabase(): void {
  // Create tables — idempotent, safe to run every startup
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS environments (
      id            TEXT PRIMARY KEY,
      display_name  TEXT NOT NULL,
      adapter_type  TEXT NOT NULL,
      adapter_config TEXT NOT NULL,
      default_runtime TEXT NOT NULL DEFAULT 'claude-code',
      bootstrapped  INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'disconnected',
      last_seen     TEXT,
      env_info      TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      powerline_token TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      env_id        TEXT NOT NULL REFERENCES environments(id),
      runtime       TEXT NOT NULL,
      runtime_session_id TEXT,
      prompt        TEXT NOT NULL,
      model         TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      log_path      TEXT,
      turns         INTEGER NOT NULL DEFAULT 0,
      started_at    TEXT NOT NULL DEFAULT (datetime('now')),
      suspended_at  TEXT,
      ended_at      TEXT,
      error         TEXT,
      task_id       TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS tokens (
      id            TEXT PRIMARY KEY,
      config        TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      repo_url      TEXT NOT NULL DEFAULT '',
      default_env_id TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'active',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id),
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'pending',
      branch        TEXT NOT NULL DEFAULT '',
      env_id        TEXT NOT NULL DEFAULT '',
      session_id    TEXT NOT NULL DEFAULT '',
      depends_on    TEXT NOT NULL DEFAULT '[]',
      assigned_at   TEXT,
      started_at    TEXT,
      completed_at  TEXT,
      review_notes  TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      sort_order    INTEGER NOT NULL DEFAULT 0,
      parent_task_id TEXT NOT NULL DEFAULT '',
      depth         INTEGER NOT NULL DEFAULT 0,
      can_decompose INTEGER NOT NULL DEFAULT 0,
      persona_id    TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS findings (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id),
      task_id       TEXT NOT NULL DEFAULT '',
      session_id    TEXT NOT NULL DEFAULT '',
      category      TEXT NOT NULL DEFAULT 'general',
      title         TEXT NOT NULL,
      content       TEXT NOT NULL,
      tags          TEXT NOT NULL DEFAULT '[]',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS personas (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL UNIQUE,
      description   TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL,
      tool_config   TEXT NOT NULL DEFAULT '{}',
      runtime       TEXT NOT NULL DEFAULT '',
      model         TEXT NOT NULL DEFAULT '',
      max_turns     INTEGER NOT NULL DEFAULT 0,
      mcp_servers   TEXT NOT NULL DEFAULT '[]',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_findings_project ON findings(project_id);
  `);

  // Migration: add powerline_token column if missing (older databases)
  try {
    sqlite.exec(
      "ALTER TABLE environments ADD COLUMN powerline_token TEXT NOT NULL DEFAULT ''",
    );
  } catch {
    /* column already exists */
  }

  // Migration: rename sidecar_token → powerline_token (from older databases)
  try {
    sqlite.exec(
      "ALTER TABLE environments RENAME COLUMN sidecar_token TO powerline_token",
    );
  } catch {
    /* column already renamed or doesn't exist */
  }

  // Migration: backfill NULLs in stage-2 tables from older schemas that lacked NOT NULL
  sqlite.exec(`
    UPDATE projects SET description = '' WHERE description IS NULL;
    UPDATE projects SET repo_url = '' WHERE repo_url IS NULL;
    UPDATE projects SET default_env_id = '' WHERE default_env_id IS NULL;
    UPDATE projects SET status = 'active' WHERE status IS NULL;
    UPDATE projects SET created_at = datetime('now') WHERE created_at IS NULL;
    UPDATE projects SET updated_at = datetime('now') WHERE updated_at IS NULL;

    UPDATE tasks SET description = '' WHERE description IS NULL;
    UPDATE tasks SET status = 'pending' WHERE status IS NULL;
    UPDATE tasks SET branch = '' WHERE branch IS NULL;
    UPDATE tasks SET env_id = '' WHERE env_id IS NULL;
    UPDATE tasks SET session_id = '' WHERE session_id IS NULL;
    UPDATE tasks SET depends_on = '[]' WHERE depends_on IS NULL;
    UPDATE tasks SET review_notes = '' WHERE review_notes IS NULL;
    UPDATE tasks SET created_at = datetime('now') WHERE created_at IS NULL;
    UPDATE tasks SET updated_at = datetime('now') WHERE updated_at IS NULL;
    UPDATE tasks SET sort_order = 0 WHERE sort_order IS NULL;

    UPDATE findings SET task_id = '' WHERE task_id IS NULL;
    UPDATE findings SET session_id = '' WHERE session_id IS NULL;
    UPDATE findings SET category = 'general' WHERE category IS NULL;
    UPDATE findings SET tags = '[]' WHERE tags IS NULL;
    UPDATE findings SET created_at = datetime('now') WHERE created_at IS NULL;
  `);

  // Migration: add parent_task_id and depth columns if missing (older databases)
  try {
    sqlite.exec(
      "ALTER TABLE tasks ADD COLUMN parent_task_id TEXT NOT NULL DEFAULT ''",
    );
  } catch {
    /* column already exists */
  }
  try {
    sqlite.exec(
      "ALTER TABLE tasks ADD COLUMN depth INTEGER NOT NULL DEFAULT 0",
    );
  } catch {
    /* column already exists */
  }

  // Migration: add can_decompose column if missing (older databases)
  try {
    sqlite.exec(
      "ALTER TABLE tasks ADD COLUMN can_decompose INTEGER NOT NULL DEFAULT 0",
    );

    // Backfill: mark root tasks and tasks with existing children as decomposable
    sqlite.exec(`
      UPDATE tasks
      SET can_decompose = 1
      WHERE parent_task_id IS NULL OR parent_task_id = ''
        OR id IN (
          SELECT DISTINCT parent_task_id
          FROM tasks
          WHERE parent_task_id IS NOT NULL AND parent_task_id <> ''
        )
    `);
  } catch {
    /* column already exists */
  }

  // Migration: add persona_id column to tasks if missing
  try {
    sqlite.exec(
      "ALTER TABLE tasks ADD COLUMN persona_id TEXT NOT NULL DEFAULT ''",
    );
  } catch {
    /* column already exists */
  }

  // Migration: add task_id column to sessions if missing
  try {
    sqlite.exec(
      "ALTER TABLE sessions ADD COLUMN task_id TEXT NOT NULL DEFAULT ''",
    );
  } catch {
    /* column already exists */
  }

  // Migration: backfill task_id on existing sessions from tasks.session_id
  sqlite.exec(`
    UPDATE sessions SET task_id = (
      SELECT id FROM tasks WHERE tasks.session_id = sessions.id
    ) WHERE task_id = '' AND EXISTS (
      SELECT 1 FROM tasks WHERE tasks.session_id = sessions.id
    )
  `);
}

// Run init immediately for backwards compatibility — stores import db at module load
initDatabase();

/** Drizzle ORM instance wrapping the SQLite database. */
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
const db: BetterSQLite3Database<typeof schema> & {
  $client: InstanceType<typeof Database>;
} = drizzle(sqlite, { schema });

export default db;
