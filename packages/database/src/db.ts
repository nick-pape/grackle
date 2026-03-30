import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { join, dirname } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { DB_FILENAME } from "@grackle-ai/common";
import { grackleHome } from "./paths.js";
import * as schema from "./schema.js";

// ─── Schema Versioning ──────────────────────────────────────

/**
 * Schema version representing the consolidated baseline.
 * All historical migrations (pre-versioning) are collapsed into this version.
 */
const BASELINE_VERSION: number = 1;

/** A versioned database migration. */
interface Migration {
  /** Version this migration brings the schema to. Must be > BASELINE_VERSION. */
  version: number;
  /** Human-readable name for logging. */
  name: string;
  /** Forward migration function. Runs inside a transaction. */
  up: (conn: InstanceType<typeof Database>) => void;
}

/**
 * Ordered list of versioned migrations.
 * Add new migrations to the end with incrementing version numbers.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 2,
    name: "add-workspace-environment-links",
    up: (conn) => {
      conn.exec(`
        CREATE TABLE IF NOT EXISTS workspace_environment_links (
          workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
          environment_id  TEXT NOT NULL REFERENCES environments(id),
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (workspace_id, environment_id)
        );

        CREATE INDEX IF NOT EXISTS idx_workspace_environment_links_environment_id
          ON workspace_environment_links(environment_id);
      `);
    },
  },
  {
    version: 3,
    name: "dispatch-queue",
    up: (conn) => {
      conn.exec(`
        CREATE TABLE IF NOT EXISTS dispatch_queue (
          id                TEXT PRIMARY KEY,
          task_id           TEXT NOT NULL UNIQUE,
          environment_id    TEXT NOT NULL DEFAULT '',
          persona_id        TEXT NOT NULL DEFAULT '',
          notes             TEXT NOT NULL DEFAULT '',
          pipe              TEXT NOT NULL DEFAULT '',
          parent_session_id TEXT NOT NULL DEFAULT '',
          enqueued_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_dispatch_queue_enqueued ON dispatch_queue(enqueued_at);
      `);
      // ALTER TABLE fails if column already exists (fresh installs include it in baseline).
      const cols = conn
        .prepare("PRAGMA table_info(environments)")
        .all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "max_concurrent_sessions")) {
        conn.exec("ALTER TABLE environments ADD COLUMN max_concurrent_sessions INTEGER NOT NULL DEFAULT 0");
      }
    },
  },
];

/** The highest schema version defined by BASELINE + MIGRATIONS. */
const CURRENT_VERSION: number = MIGRATIONS.length > 0
  ? MIGRATIONS[MIGRATIONS.length - 1]!.version
  : BASELINE_VERSION;

// ─── Legacy Schema Validation ───────────────────────────────

/**
 * Columns that must exist in a database to be considered baseline-compatible.
 * These were added at various points during the historical migration sequence.
 */
const BASELINE_SCHEMA_CHECKS: Array<{ table: string; column: string }> = [
  { table: "sessions", column: "cost_usd" },
  { table: "tasks", column: "schedule_id" },
  { table: "workspaces", column: "working_directory" },
];

/**
 * Verify that an unversioned database has all columns expected by the baseline schema.
 * Throws if tables exist but are missing columns, indicating the database predates
 * historical migrations that have been removed.
 */
function validateBaselineSchema(conn: InstanceType<typeof Database>): void {
  const tables = conn
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;

  // No tables = fresh install, nothing to validate
  if (tables.length === 0) {
    return;
  }

  for (const { table, column } of BASELINE_SCHEMA_CHECKS) {
    const cols = conn
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;

    // Table exists but is missing a required column
    if (cols.length > 0 && !cols.some((c) => c.name === column)) {
      throw new Error(
        `Database schema is too old: table "${table}" is missing column "${column}". ` +
        `Delete your database file and restart to create a fresh one.`,
      );
    }
  }
}

// ─── Database Singleton ─────────────────────────────────────

/** Raw better-sqlite3 instance. Available after {@link openDatabase} has been called. */
let sqlite: InstanceType<typeof Database> | undefined;

/** Resolved path of the database file. Set by {@link openDatabase}. */
let resolvedDbPath: string | undefined;

/**
 * Drizzle ORM instance wrapping the SQLite database.
 * Available after {@link openDatabase} has been called.
 * Exported as the default export via ESM live binding so that store modules
 * that do `import db from "./db.js"` see the initialized value after startup.
 */
let db!: BetterSQLite3Database<typeof schema> & {
  $client: InstanceType<typeof Database>;
};

/**
 * Open the SQLite database and initialize the Drizzle ORM instance.
 * Call once at startup before using `db` or `sqlite`.
 * If already initialized, returns silently.
 *
 * @param dbPath - Optional path to the database file. Defaults to `~/.grackle/grackle.db`.
 */
export function openDatabase(dbPath?: string): void {
  if (sqlite) {
    return;
  }

  resolvedDbPath = dbPath ?? join(grackleHome, DB_FILENAME);

  // Ensure the grackle home directory exists (skip when a custom path is provided,
  // e.g. tests that point at an in-memory or temp-dir database).
  if (!dbPath) {
    mkdirSync(grackleHome, { recursive: true });
  }

  try {
    sqlite = new Database(resolvedDbPath);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Could not locate the bindings file")) {
      process.stderr.write(
        [
          "",
          "ERROR: better-sqlite3 native binding not found.",
          "",
          "The install script for better-sqlite3 was skipped, so the required native",
          "module was never built. This commonly happens with pnpm v8+, which blocks",
          "package install scripts by default.",
          "",
          "To fix this, run one of the following:",
          "",
          "  Option 1 — approve builds interactively:",
          "    pnpm approve-builds",
          "",
          "  Option 2 — add to your project's package.json, then reinstall:",
          '    { "pnpm": { "onlyBuiltDependencies": ["better-sqlite3"] } }',
          "    pnpm install",
          "",
          "After fixing, restart grackle.",
          "",
        ].join("\n"),
      );
      process.exit(1);
    }
    if (err instanceof Error && err.message.includes("NODE_MODULE_VERSION")) {
      process.stderr.write(
        [
          "",
          "ERROR: better-sqlite3 was compiled for a different Node.js version.",
          `(Current NODE_MODULE_VERSION: ${process.versions.modules})`,
          "",
          "This usually means grackle was installed with one Node version but is",
          "being run with another. Grackle requires Node >= 22.",
          "",
          "To fix: reinstall grackle with your current Node version:",
          "  npm install -g @grackle-ai/cli",
          "",
          `Original error: ${err.message}`,
          "",
        ].join("\n"),
      );
      process.exit(1);
    }
    throw err;
  }

  // Enable WAL mode for better concurrent read performance
  sqlite.pragma("journal_mode = WAL");

  // Enable foreign key enforcement (off by default in SQLite)
  sqlite.pragma("foreign_keys = ON");

  db = drizzle(sqlite, { schema });
}

/**
 * Initialize all database tables and run any pending migrations.
 * Call once at startup after {@link openDatabase}, or pass an in-memory
 * SQLite instance for testing.
 *
 * Uses `PRAGMA user_version` to track schema versions. Each migration runs
 * exactly once, in order, inside a transaction.
 *
 * @param sqliteOverride - Optional SQLite instance to use instead of the module-level one.
 */
export function initDatabase(sqliteOverride?: InstanceType<typeof Database>): void {
  const conn = sqliteOverride ?? sqlite;
  if (!conn) {
    throw new Error(
      "Database not initialized. Call openDatabase() first or provide a sqliteOverride.",
    );
  }

  // Check current schema version before creating tables — an ancient database
  // with missing columns would cause index creation to fail with a confusing error.
  const currentVersion = conn.pragma("user_version", { simple: true }) as number;

  // Prevent running an older binary against a database upgraded by a newer version.
  if (currentVersion > CURRENT_VERSION) {
    throw new Error(
      `Database schema version (${currentVersion}) is newer than this application supports (${CURRENT_VERSION}). ` +
      "Please upgrade the application or use a compatible database file.",
    );
  }

  if (currentVersion < BASELINE_VERSION) {
    validateBaselineSchema(conn);
  }

  // Create all tables and indices — IF NOT EXISTS makes this safe for both
  // fresh installs and existing databases.
  conn.exec(`
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
      powerline_token TEXT NOT NULL DEFAULT '',
      max_concurrent_sessions INTEGER NOT NULL DEFAULT 0
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
      started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      suspended_at  TEXT,
      ended_at      TEXT,
      end_reason    TEXT,
      error         TEXT,
      task_id       TEXT NOT NULL DEFAULT '',
      persona_id    TEXT NOT NULL DEFAULT '',
      parent_session_id TEXT NOT NULL DEFAULT '',
      pipe_mode     TEXT NOT NULL DEFAULT '',
      input_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd      REAL NOT NULL DEFAULT 0,
      sigterm_sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tokens (
      id            TEXT PRIMARY KEY,
      config        TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      repo_url      TEXT NOT NULL DEFAULT '',
      environment_id TEXT NOT NULL DEFAULT '' REFERENCES environments(id),
      status        TEXT NOT NULL DEFAULT 'active',
      use_worktrees INTEGER NOT NULL DEFAULT 1,
      working_directory TEXT NOT NULL DEFAULT '',
      default_persona_id TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT REFERENCES workspaces(id),
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'not_started',
      branch        TEXT NOT NULL DEFAULT '',
      depends_on    TEXT NOT NULL DEFAULT '[]',
      started_at    TEXT,
      completed_at  TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      sort_order    INTEGER NOT NULL DEFAULT 0,
      parent_task_id TEXT NOT NULL DEFAULT '',
      depth         INTEGER NOT NULL DEFAULT 0,
      can_decompose INTEGER NOT NULL DEFAULT 0,
      default_persona_id TEXT NOT NULL DEFAULT '',
      workpad       TEXT NOT NULL DEFAULT '',
      schedule_id   TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS findings (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
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
      type          TEXT NOT NULL DEFAULT 'agent',
      script        TEXT NOT NULL DEFAULT '',
      allowed_mcp_tools TEXT NOT NULL DEFAULT '[]',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS escalations (
      id              TEXT PRIMARY KEY,
      workspace_id    TEXT NOT NULL DEFAULT '',
      task_id         TEXT NOT NULL DEFAULT '',
      title           TEXT NOT NULL,
      message         TEXT NOT NULL DEFAULT '',
      source          TEXT NOT NULL DEFAULT 'explicit',
      urgency         TEXT NOT NULL DEFAULT 'normal',
      status          TEXT NOT NULL DEFAULT 'pending',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      delivered_at    TEXT,
      acknowledged_at TEXT,
      task_url        TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS domain_events (
      id        TEXT PRIMARY KEY,
      type      TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      payload   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id                  TEXT PRIMARY KEY,
      title               TEXT NOT NULL,
      description         TEXT NOT NULL DEFAULT '',
      schedule_expression TEXT NOT NULL,
      persona_id          TEXT NOT NULL,
      environment_id      TEXT NOT NULL DEFAULT '',
      workspace_id        TEXT NOT NULL DEFAULT '',
      parent_task_id      TEXT NOT NULL DEFAULT '',
      enabled             INTEGER NOT NULL DEFAULT 1,
      last_run_at         TEXT,
      next_run_at         TEXT,
      run_count           INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspace_environment_links (
      workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
      environment_id  TEXT NOT NULL REFERENCES environments(id),
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (workspace_id, environment_id)
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_environment_links_environment_id
      ON workspace_environment_links(environment_id);

    CREATE TABLE IF NOT EXISTS dispatch_queue (
      id                TEXT PRIMARY KEY,
      task_id           TEXT NOT NULL UNIQUE,
      environment_id    TEXT NOT NULL DEFAULT '',
      persona_id        TEXT NOT NULL DEFAULT '',
      notes             TEXT NOT NULL DEFAULT '',
      pipe              TEXT NOT NULL DEFAULT '',
      parent_session_id TEXT NOT NULL DEFAULT '',
      enqueued_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_dispatch_queue_enqueued ON dispatch_queue(enqueued_at);
    CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations(status);
    CREATE INDEX IF NOT EXISTS idx_escalations_workspace ON escalations(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_findings_workspace ON findings(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_domain_events_type ON domain_events(type);
    CREATE INDEX IF NOT EXISTS idx_domain_events_timestamp ON domain_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_task_id ON sessions(task_id);
    CREATE INDEX IF NOT EXISTS idx_workspaces_environment_id ON workspaces(environment_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(enabled, next_run_at);
  `);

  // Mark unversioned databases as baseline now that tables are confirmed
  if (currentVersion < BASELINE_VERSION) {
    conn.pragma(`user_version = ${BASELINE_VERSION}`);
  }

  // Back up the database before running any pending migrations.
  // Skip for in-memory databases (tests) and fresh installs (no data to lose).
  const hasPendingMigrations = MIGRATIONS.some((m) => m.version > currentVersion);
  if (hasPendingMigrations && resolvedDbPath && currentVersion >= BASELINE_VERSION) {
    const dbDir = dirname(resolvedDbPath);
    const backupPath = join(dbDir, `grackle.db.backup-v${currentVersion}`);
    writeFileSync(backupPath, conn.serialize());
  }

  // Run any pending versioned migrations
  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) {
      continue;
    }
    const run = conn.transaction(() => {
      migration.up(conn);
      conn.pragma(`user_version = ${migration.version}`);
    });
    try {
      run();
    } catch (error) {
      const label = `Migration v${migration.version} ("${migration.name}") failed`;
      if (error instanceof Error) {
        error.message = `${label}: ${error.message}`;
        throw error;
      }
      throw new Error(`${label}: ${String(error)}`);
    }
  }
}

// ─── Integrity Check ────────────────────────────────────────

/**
 * Run `PRAGMA quick_check` to verify the database B-tree structure.
 * Throws if the database is corrupt.
 *
 * @param conn - Optional SQLite instance. Defaults to the module-level singleton.
 */
export function checkDatabaseIntegrity(conn?: InstanceType<typeof Database>): void {
  const c = conn ?? sqlite;
  if (!c) {
    return;
  }
  const result = c.pragma("quick_check", { simple: true }) as string;
  if (result !== "ok") {
    throw new Error(
      `Database integrity check failed: ${result}. ` +
      "The database file may be corrupt. " +
      "Restore from a backup or delete the database file and restart.",
    );
  }
}

// ─── Backup ─────────────────────────────────────────────────

/**
 * Create a consistent backup of the database using the SQLite backup API.
 * Handles WAL correctly (unlike a raw file copy).
 *
 * @param targetPath - Path to write the backup file.
 * @param conn - Optional SQLite instance. Defaults to the module-level singleton.
 */
export async function backupDatabase(targetPath: string, conn?: InstanceType<typeof Database>): Promise<void> {
  const c = conn ?? sqlite;
  if (!c) {
    return;
  }
  await c.backup(targetPath);
}

// ─── WAL Checkpoint Management ──────────────────────────────

/** Interval between periodic WAL checkpoints (5 minutes). */
const WAL_CHECKPOINT_INTERVAL_MS: number = 5 * 60 * 1000;

/** Handle for the periodic WAL checkpoint timer. */
let walTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Run a passive WAL checkpoint. Non-blocking — does not interfere with readers.
 *
 * @param conn - Optional SQLite instance. Defaults to the module-level singleton.
 */
export function walCheckpoint(conn?: InstanceType<typeof Database>): void {
  const c = conn ?? sqlite;
  if (!c) {
    return;
  }
  c.pragma("wal_checkpoint(PASSIVE)");
}

/**
 * Start a periodic timer that runs {@link walCheckpoint} every 5 minutes.
 * The timer is unref'd so it doesn't keep the process alive.
 */
export function startWalCheckpointTimer(): void {
  if (walTimer) {
    return;
  }
  walTimer = setInterval(walCheckpoint, WAL_CHECKPOINT_INTERVAL_MS);
  walTimer.unref();
}

/** Stop the periodic WAL checkpoint timer. */
export function stopWalCheckpointTimer(): void {
  if (walTimer) {
    clearInterval(walTimer);
    walTimer = undefined;
  }
}

export { sqlite, CURRENT_VERSION };
export { db as default };
