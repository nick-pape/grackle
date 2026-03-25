import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { DB_FILENAME } from "@grackle-ai/common";
import { grackleHome } from "./paths.js";
import * as schema from "./schema.js";

/** Error collected from a migration step that uses try-catch for idempotency. */
export interface MigrationError {
  name: string;
  error: unknown;
}

/** Result returned by {@link initDatabase}. */
export interface InitDatabaseResult {
  migrationErrors: MigrationError[];
}

/** Raw better-sqlite3 instance. Available after {@link openDatabase} has been called. */
let sqlite: InstanceType<typeof Database> | undefined;

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

  const resolvedPath = dbPath ?? join(grackleHome, DB_FILENAME);

  // Ensure the grackle home directory exists (skip when a custom path is provided,
  // e.g. tests that point at an in-memory or temp-dir database).
  if (!dbPath) {
    mkdirSync(grackleHome, { recursive: true });
  }

  try {
    sqlite = new Database(resolvedPath);
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
 * Initialize all database tables and run migrations.
 * Call once at startup after {@link openDatabase}, or pass an in-memory
 * SQLite instance for testing.
 *
 * @param sqliteOverride - Optional SQLite instance to use instead of the module-level one.
 * @returns Collected migration errors from idempotent try-catch steps.
 */
export function initDatabase(sqliteOverride?: InstanceType<typeof Database>): InitDatabaseResult {
  const conn = sqliteOverride ?? sqlite;
  if (!conn) {
    throw new Error(
      "Database not initialized. Call openDatabase() first or provide a sqliteOverride.",
    );
  }

  const migrationErrors: MigrationError[] = [];

  /** Check whether an error is an expected idempotent migration failure. */
  const isExpectedIdempotencyError = (err: unknown): boolean => {
    if (!(err instanceof Error)) {
      return false;
    }
    const msg = err.message.toLowerCase();
    return (
      msg.includes("already exists") ||
      msg.includes("duplicate column name") ||
      msg.includes("no such table") ||
      msg.includes("no such column")
    );
  };

  /** Run a migration step, collecting expected idempotency errors. */
  const tryMigration = (name: string, fn: () => void): void => {
    try {
      fn();
    } catch (error) {
      if (isExpectedIdempotencyError(error)) {
        migrationErrors.push({ name, error });
      } else {
        throw error;
      }
    }
  };

  // Migration: rename projects table to workspaces
  tryMigration("rename-projects-to-workspaces", () => {
    conn.exec("ALTER TABLE projects RENAME TO workspaces");
  });
  // Migration: rename project_id column to workspace_id on tasks
  tryMigration("rename-tasks-project-id", () => {
    conn.exec("ALTER TABLE tasks RENAME COLUMN project_id TO workspace_id");
  });
  // Migration: rename project_id column to workspace_id on findings
  tryMigration("rename-findings-project-id", () => {
    conn.exec("ALTER TABLE findings RENAME COLUMN project_id TO workspace_id");
  });
  // Migration: drop old findings index after column rename
  tryMigration("drop-idx-findings-project", () => {
    conn.exec("DROP INDEX IF EXISTS idx_findings_project");
  });

  // Migration: rename default_env_id → environment_id on workspaces
  // Must run BEFORE the backfill block below which references environment_id.
  tryMigration("rename-workspaces-default-env-id", () => {
    conn.exec(
      "ALTER TABLE workspaces RENAME COLUMN default_env_id TO environment_id",
    );
  });

  // Create tables — idempotent, safe to run every startup
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
      started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      suspended_at  TEXT,
      ended_at      TEXT,
      end_reason    TEXT,
      error         TEXT,
      task_id       TEXT NOT NULL DEFAULT '',
      persona_id    TEXT NOT NULL DEFAULT ''
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
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_findings_workspace ON findings(workspace_id);

    CREATE TABLE IF NOT EXISTS domain_events (
      id        TEXT PRIMARY KEY,
      type      TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      payload   TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_domain_events_type ON domain_events(type);
    CREATE INDEX IF NOT EXISTS idx_domain_events_timestamp ON domain_events(timestamp);
  `);

  // Migration: add powerline_token column if missing (older databases)
  tryMigration("add-environments-powerline-token", () => {
    conn.exec(
      "ALTER TABLE environments ADD COLUMN powerline_token TEXT NOT NULL DEFAULT ''",
    );
  });

  // Migration: rename sidecar_token → powerline_token (from older databases)
  tryMigration("rename-environments-sidecar-token", () => {
    conn.exec(
      "ALTER TABLE environments RENAME COLUMN sidecar_token TO powerline_token",
    );
  });

  // Migration: backfill NULLs in stage-2 tables from older schemas that lacked NOT NULL
  conn.exec(`
    UPDATE workspaces SET description = '' WHERE description IS NULL;
    UPDATE workspaces SET repo_url = '' WHERE repo_url IS NULL;
    UPDATE workspaces SET environment_id = COALESCE(
      (SELECT id FROM environments LIMIT 1), ''
    ) WHERE environment_id IS NULL OR environment_id = '';
    UPDATE workspaces SET status = 'active' WHERE status IS NULL;
    UPDATE workspaces SET created_at = datetime('now') WHERE created_at IS NULL;
    UPDATE workspaces SET updated_at = datetime('now') WHERE updated_at IS NULL;

    UPDATE tasks SET description = '' WHERE description IS NULL;
    UPDATE tasks SET status = 'not_started' WHERE status IS NULL;
    UPDATE tasks SET branch = '' WHERE branch IS NULL;
    UPDATE tasks SET depends_on = '[]' WHERE depends_on IS NULL;
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
  tryMigration("add-tasks-parent-task-id", () => {
    conn.exec(
      "ALTER TABLE tasks ADD COLUMN parent_task_id TEXT NOT NULL DEFAULT ''",
    );
  });
  tryMigration("add-tasks-depth", () => {
    conn.exec(
      "ALTER TABLE tasks ADD COLUMN depth INTEGER NOT NULL DEFAULT 0",
    );
  });

  // Migration: add can_decompose column if missing (older databases)
  tryMigration("add-tasks-can-decompose", () => {
    conn.exec(
      "ALTER TABLE tasks ADD COLUMN can_decompose INTEGER NOT NULL DEFAULT 0",
    );

    // Backfill: mark root tasks and tasks with existing children as decomposable
    conn.exec(`
      UPDATE tasks
      SET can_decompose = 1
      WHERE parent_task_id IS NULL OR parent_task_id = ''
        OR id IN (
          SELECT DISTINCT parent_task_id
          FROM tasks
          WHERE parent_task_id IS NOT NULL AND parent_task_id <> ''
        )
    `);
  });

  // Migration: add persona_id column to tasks if missing
  tryMigration("add-tasks-persona-id", () => {
    conn.exec(
      "ALTER TABLE tasks ADD COLUMN persona_id TEXT NOT NULL DEFAULT ''",
    );
  });

  // Migration: add task_id column to sessions if missing
  tryMigration("add-sessions-task-id", () => {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN task_id TEXT NOT NULL DEFAULT ''",
    );
  });

  // Migration: add use_worktrees column to workspaces if missing (older databases)
  tryMigration("add-workspaces-use-worktrees", () => {
    conn.exec(
      "ALTER TABLE workspaces ADD COLUMN use_worktrees INTEGER NOT NULL DEFAULT 1",
    );
  });

  // Migration: add worktree_base_path column to workspaces if missing (older databases)
  // NOTE: column was later renamed to working_directory — see rename-worktree-base-path migration below.
  tryMigration("add-workspaces-worktree-base-path", () => {
    conn.exec(
      "ALTER TABLE workspaces ADD COLUMN worktree_base_path TEXT NOT NULL DEFAULT ''",
    );
  });

  // Migration: backfill task_id on existing sessions from tasks.session_id.
  // Guard with try/catch since session_id column may have been dropped already.
  tryMigration("backfill-sessions-task-id", () => {
    conn.exec(`
      UPDATE sessions SET task_id = (
        SELECT id FROM tasks WHERE tasks.session_id = sessions.id LIMIT 1
      ) WHERE task_id = '' AND EXISTS (
        SELECT 1 FROM tasks WHERE tasks.session_id = sessions.id
      )
    `);
  });

  // Migration: add persona_id column to sessions if missing
  tryMigration("add-sessions-persona-id", () => {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN persona_id TEXT NOT NULL DEFAULT ''",
    );
  });

  // Migration: copy persona_id from tasks to sessions before dropping
  tryMigration("copy-persona-id-tasks-to-sessions", () => {
    conn.exec(`
      UPDATE sessions SET persona_id = (
        SELECT persona_id FROM tasks WHERE tasks.session_id = sessions.id LIMIT 1
      ) WHERE persona_id = '' AND task_id != ''
    `);
  });

  // Migration: drop columns that moved off the tasks table
  tryMigration("drop-tasks-session-id", () => {
    conn.exec("ALTER TABLE tasks DROP COLUMN session_id");
  });
  tryMigration("drop-tasks-env-id", () => {
    conn.exec("ALTER TABLE tasks DROP COLUMN env_id");
  });
  tryMigration("drop-tasks-persona-id", () => {
    conn.exec("ALTER TABLE tasks DROP COLUMN persona_id");
  });

  // Migration: normalize existing started_at values from SQLite datetime('now')
  // format (YYYY-MM-DD HH:MM:SS) to ISO 8601 (YYYY-MM-DDTHH:MM:SS.000Z) so
  // ordering is consistent with newly inserted rows.
  conn.exec(`
    UPDATE sessions
    SET started_at = replace(started_at, ' ', 'T') || '.000Z'
    WHERE started_at NOT LIKE '%T%'
  `);

  // Migration: normalize task statuses to simplified model
  conn.exec(`
    UPDATE tasks SET status = 'not_started' WHERE status IN ('pending', 'assigned');
    UPDATE tasks SET status = 'complete' WHERE status = 'done';
    UPDATE tasks SET status = 'not_started' WHERE status IN ('in_progress', 'waiting_input', 'review');
  `);

  // Migration: normalize session statuses
  conn.exec(`
    UPDATE sessions SET status = 'idle' WHERE status = 'waiting_input';
    UPDATE sessions SET status = 'interrupted' WHERE status = 'killed';
  `);

  // Migration: drop stale columns from tasks
  tryMigration("drop-tasks-assigned-at", () => {
    conn.exec("ALTER TABLE tasks DROP COLUMN assigned_at");
  });
  tryMigration("drop-tasks-review-notes", () => {
    conn.exec("ALTER TABLE tasks DROP COLUMN review_notes");
  });

  // Index for efficient session-by-task lookups
  conn.exec(
    "CREATE INDEX IF NOT EXISTS idx_sessions_task_id ON sessions(task_id)",
  );

  // Migration: add default_persona_id to workspaces and tasks
  tryMigration("add-workspaces-default-persona-id", () => {
    conn.exec(
      "ALTER TABLE workspaces ADD COLUMN default_persona_id TEXT NOT NULL DEFAULT ''",
    );
  });
  tryMigration("add-tasks-default-persona-id", () => {
    conn.exec(
      "ALTER TABLE tasks ADD COLUMN default_persona_id TEXT NOT NULL DEFAULT ''",
    );
  });
  tryMigration("add-tasks-workpad", () => {
    conn.exec(
      "ALTER TABLE tasks ADD COLUMN workpad TEXT NOT NULL DEFAULT ''",
    );
  });

  // Migration: add type and script columns to personas if missing
  tryMigration("add-personas-type", () => {
    conn.exec(
      "ALTER TABLE personas ADD COLUMN type TEXT NOT NULL DEFAULT 'agent'",
    );
  });
  tryMigration("add-personas-script", () => {
    conn.exec(
      "ALTER TABLE personas ADD COLUMN script TEXT NOT NULL DEFAULT ''",
    );
  });

  tryMigration("add-sessions-parent-session-id", () => {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN parent_session_id TEXT NOT NULL DEFAULT ''",
    );
  });

  tryMigration("add-sessions-pipe-mode", () => {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN pipe_mode TEXT NOT NULL DEFAULT ''",
    );
  });

  tryMigration("add-sessions-input-tokens", () => {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0",
    );
  });

  tryMigration("add-sessions-output-tokens", () => {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0",
    );
  });

  tryMigration("add-sessions-cost-usd", () => {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0",
    );
  });

  // Migration: add end_reason column to sessions if missing (older databases)
  tryMigration("add-sessions-end-reason", () => {
    conn.exec(
      "ALTER TABLE sessions ADD COLUMN end_reason TEXT",
    );
  });

  // Migration: normalize old session statuses to STOPPED + end_reason
  conn.exec(`
    UPDATE sessions SET end_reason = 'completed', status = 'stopped'
      WHERE status = 'completed';
    UPDATE sessions SET end_reason = 'interrupted', status = 'stopped'
      WHERE status IN ('failed', 'interrupted');
    UPDATE sessions SET end_reason = 'completed', status = 'stopped'
      WHERE status = 'hibernating';
  `);

  // Migration: make workspace_id nullable on tasks.
  // SQLite doesn't support ALTER COLUMN, so we recreate the table.
  // Guard: only run if the column currently has NOT NULL.
  {
    const tableInfo = conn.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string; notnull: number }>;
    const workspaceIdCol = tableInfo.find((c) => c.name === "workspace_id");
    if (workspaceIdCol?.notnull === 1) {
      conn.exec(`
        BEGIN;
        CREATE TABLE tasks_new (
          id             TEXT PRIMARY KEY,
          workspace_id   TEXT REFERENCES workspaces(id),
          title          TEXT NOT NULL,
          description    TEXT NOT NULL DEFAULT '',
          status         TEXT NOT NULL DEFAULT 'not_started',
          branch         TEXT NOT NULL DEFAULT '',
          depends_on     TEXT NOT NULL DEFAULT '[]',
          started_at     TEXT,
          completed_at   TEXT,
          created_at     TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
          sort_order     INTEGER NOT NULL DEFAULT 0,
          parent_task_id TEXT NOT NULL DEFAULT '',
          depth          INTEGER NOT NULL DEFAULT 0,
          can_decompose  INTEGER NOT NULL DEFAULT 0,
          default_persona_id TEXT NOT NULL DEFAULT '',
          workpad        TEXT NOT NULL DEFAULT '',
          schedule_id    TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO tasks_new SELECT
          id, workspace_id, title, description, status, branch, depends_on,
          started_at, completed_at, created_at, updated_at, sort_order,
          parent_task_id, depth, can_decompose, default_persona_id,
          COALESCE(workpad, ''),
          COALESCE(schedule_id, '')
        FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_new RENAME TO tasks;
        COMMIT;
      `);
    }
  }

  // Migration: add index on workspaces.environment_id for efficient lookup
  conn.exec(
    "CREATE INDEX IF NOT EXISTS idx_workspaces_environment_id ON workspaces(environment_id)",
  );

  // Migration: rename worktree_base_path → working_directory on workspaces table (#547)
  // Guard: only run if the old column still exists (new databases already have working_directory).
  tryMigration("rename-worktree-base-path", () => {
    const tableInfo = conn.prepare("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>;
    if (tableInfo.some((c) => c.name === "worktree_base_path")) {
      conn.exec(
        "ALTER TABLE workspaces RENAME COLUMN worktree_base_path TO working_directory",
      );
    }
  });

  // ─── Schedules table ──────────────────────────────────────
  conn.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(enabled, next_run_at);
  `);

  // Migration: add schedule_id to tasks table
  tryMigration("add-tasks-schedule-id", () => {
    conn.exec(
      "ALTER TABLE tasks ADD COLUMN schedule_id TEXT NOT NULL DEFAULT ''",
    );
  });

  return { migrationErrors };
}

export { sqlite };
export { db as default };
