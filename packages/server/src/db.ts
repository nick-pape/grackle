import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { DB_FILENAME } from "@grackle/common";
import { grackleHome } from "./paths.js";
import * as schema from "./schema.js";

mkdirSync(grackleHome, { recursive: true });

const dbPath = join(grackleHome, DB_FILENAME);
const sqlite = new Database(dbPath);

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
      error         TEXT
    );

    CREATE TABLE IF NOT EXISTS tokens (
      id            TEXT PRIMARY KEY,
      config        TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT DEFAULT '',
      repo_url      TEXT DEFAULT '',
      default_env_id TEXT DEFAULT '',
      status        TEXT DEFAULT 'active',
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id),
      title         TEXT NOT NULL,
      description   TEXT DEFAULT '',
      status        TEXT DEFAULT 'pending',
      branch        TEXT DEFAULT '',
      env_id        TEXT DEFAULT '',
      session_id    TEXT DEFAULT '',
      depends_on    TEXT DEFAULT '[]',
      assigned_at   TEXT,
      started_at    TEXT,
      completed_at  TEXT,
      review_notes  TEXT DEFAULT '',
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now')),
      sort_order    INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS findings (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id),
      task_id       TEXT DEFAULT '',
      session_id    TEXT DEFAULT '',
      category      TEXT DEFAULT 'general',
      title         TEXT NOT NULL,
      content       TEXT NOT NULL,
      tags          TEXT DEFAULT '[]',
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_findings_project ON findings(project_id);
  `);

  // Migration: add powerline_token column if missing (older databases)
  try {
    sqlite.exec("ALTER TABLE environments ADD COLUMN powerline_token TEXT NOT NULL DEFAULT ''");
  } catch { /* column already exists */ }

  // Migration: rename sidecar_token → powerline_token (from older databases)
  try {
    sqlite.exec("ALTER TABLE environments RENAME COLUMN sidecar_token TO powerline_token");
  } catch { /* column already renamed or doesn't exist */ }
}

// Run init immediately for backwards compatibility — stores import db at module load
initDatabase();

/** Drizzle ORM instance wrapping the SQLite database. */
const db = drizzle(sqlite, { schema });

export default db;
