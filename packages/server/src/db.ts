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
`);

// Migration: add powerline_token column if missing (older databases)
try {
  sqlite.exec("ALTER TABLE environments ADD COLUMN powerline_token TEXT NOT NULL DEFAULT ''");
} catch { /* column already exists */ }

// Migration: rename sidecar_token → powerline_token (from older databases)
try {
  sqlite.exec("ALTER TABLE environments RENAME COLUMN sidecar_token TO powerline_token");
} catch { /* column already renamed or doesn't exist */ }

/** Drizzle ORM instance wrapping the SQLite database. */
const db = drizzle(sqlite, { schema });

export default db;
