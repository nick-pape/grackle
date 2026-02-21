import Database, { type Database as DatabaseType } from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { GRACKLE_DIR, DB_FILENAME } from "@grackle/common";

const grackleDir = join(homedir(), GRACKLE_DIR);
mkdirSync(grackleDir, { recursive: true });

const dbPath = join(grackleDir, DB_FILENAME);
const db: DatabaseType = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS environments (
    id            TEXT PRIMARY KEY,
    display_name  TEXT NOT NULL,
    adapter_type  TEXT NOT NULL,
    adapter_config TEXT NOT NULL,
    default_runtime TEXT DEFAULT 'claude-code',
    bootstrapped  INTEGER DEFAULT 0,
    status        TEXT DEFAULT 'disconnected',
    last_seen     TEXT,
    env_info      TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    env_id        TEXT NOT NULL REFERENCES environments(id),
    runtime       TEXT NOT NULL,
    runtime_session_id TEXT,
    prompt        TEXT NOT NULL,
    model         TEXT NOT NULL,
    status        TEXT DEFAULT 'pending',
    log_path      TEXT,
    turns         INTEGER DEFAULT 0,
    started_at    TEXT DEFAULT (datetime('now')),
    suspended_at  TEXT,
    ended_at      TEXT,
    error         TEXT
  );

  CREATE TABLE IF NOT EXISTS tokens (
    id            TEXT PRIMARY KEY,
    config        TEXT NOT NULL,
    created_at    TEXT DEFAULT (datetime('now'))
  );
`);

export default db;
