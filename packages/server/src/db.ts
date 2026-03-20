import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { DB_FILENAME, SYSTEM_PERSONA_ID, ROOT_TASK_ID } from "@grackle-ai/common";
import { grackleHome } from "./paths.js";
import * as schema from "./schema.js";

mkdirSync(grackleHome, { recursive: true });

const dbPath: string = join(grackleHome, DB_FILENAME);

let sqlite: InstanceType<typeof Database>;
try {
  sqlite = new Database(dbPath);
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

/** Initialize all database tables and run migrations. Call once at startup. */
export function initDatabase(): void {
  // Migration: rename projects table to workspaces
  try {
    sqlite.exec("ALTER TABLE projects RENAME TO workspaces");
  } catch {
    /* table already renamed or never existed */
  }
  // Migration: rename project_id column to workspace_id on tasks
  try {
    sqlite.exec("ALTER TABLE tasks RENAME COLUMN project_id TO workspace_id");
  } catch {
    /* column already renamed or never existed */
  }
  // Migration: rename project_id column to workspace_id on findings
  try {
    sqlite.exec("ALTER TABLE findings RENAME COLUMN project_id TO workspace_id");
  } catch {
    /* column already renamed or never existed */
  }
  // Migration: drop old findings index after column rename
  try {
    sqlite.exec("DROP INDEX IF EXISTS idx_findings_project");
  } catch {
    /* index already dropped or never existed */
  }

  // Migration: rename default_env_id → environment_id on workspaces
  // Must run BEFORE the backfill block below which references environment_id.
  try {
    sqlite.exec(
      "ALTER TABLE workspaces RENAME COLUMN default_env_id TO environment_id",
    );
  } catch {
    /* column already renamed or never existed */
  }

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
      started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      suspended_at  TEXT,
      ended_at      TEXT,
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
      can_decompose INTEGER NOT NULL DEFAULT 0
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

  // Migration: add use_worktrees column to workspaces if missing (older databases)
  try {
    sqlite.exec(
      "ALTER TABLE workspaces ADD COLUMN use_worktrees INTEGER NOT NULL DEFAULT 1",
    );
  } catch {
    /* column already exists */
  }

  // Migration: add worktree_base_path column to workspaces if missing (older databases)
  try {
    sqlite.exec(
      "ALTER TABLE workspaces ADD COLUMN worktree_base_path TEXT NOT NULL DEFAULT ''",
    );
  } catch {
    /* column already exists */
  }

  // Migration: backfill task_id on existing sessions from tasks.session_id.
  // Guard with try/catch since session_id column may have been dropped already.
  try {
    sqlite.exec(`
      UPDATE sessions SET task_id = (
        SELECT id FROM tasks WHERE tasks.session_id = sessions.id LIMIT 1
      ) WHERE task_id = '' AND EXISTS (
        SELECT 1 FROM tasks WHERE tasks.session_id = sessions.id
      )
    `);
  } catch {
    /* tasks.session_id column already dropped */
  }

  // Migration: add persona_id column to sessions if missing
  try {
    sqlite.exec(
      "ALTER TABLE sessions ADD COLUMN persona_id TEXT NOT NULL DEFAULT ''",
    );
  } catch {
    /* column already exists */
  }

  // Migration: copy persona_id from tasks to sessions before dropping
  try {
    sqlite.exec(`
      UPDATE sessions SET persona_id = (
        SELECT persona_id FROM tasks WHERE tasks.session_id = sessions.id LIMIT 1
      ) WHERE persona_id = '' AND task_id != ''
    `);
  } catch {
    /* tasks.session_id or tasks.persona_id column may not exist */
  }

  // Migration: drop columns that moved off the tasks table
  try {
    sqlite.exec("ALTER TABLE tasks DROP COLUMN session_id");
  } catch {
    /* column already dropped or never existed */
  }
  try {
    sqlite.exec("ALTER TABLE tasks DROP COLUMN env_id");
  } catch {
    /* column already dropped or never existed */
  }
  try {
    sqlite.exec("ALTER TABLE tasks DROP COLUMN persona_id");
  } catch {
    /* column already dropped or never existed */
  }

  // Migration: normalize existing started_at values from SQLite datetime('now')
  // format (YYYY-MM-DD HH:MM:SS) to ISO 8601 (YYYY-MM-DDTHH:MM:SS.000Z) so
  // ordering is consistent with newly inserted rows.
  sqlite.exec(`
    UPDATE sessions
    SET started_at = replace(started_at, ' ', 'T') || '.000Z'
    WHERE started_at NOT LIKE '%T%'
  `);

  // Migration: normalize task statuses to simplified model
  sqlite.exec(`
    UPDATE tasks SET status = 'not_started' WHERE status IN ('pending', 'assigned');
    UPDATE tasks SET status = 'complete' WHERE status = 'done';
    UPDATE tasks SET status = 'not_started' WHERE status IN ('in_progress', 'waiting_input', 'review');
  `);

  // Migration: normalize session statuses
  sqlite.exec(`
    UPDATE sessions SET status = 'idle' WHERE status = 'waiting_input';
    UPDATE sessions SET status = 'interrupted' WHERE status = 'killed';
  `);

  // Migration: drop stale columns from tasks
  try {
    sqlite.exec("ALTER TABLE tasks DROP COLUMN assigned_at");
  } catch {
    /* column already dropped or never existed */
  }
  try {
    sqlite.exec("ALTER TABLE tasks DROP COLUMN review_notes");
  } catch {
    /* column already dropped or never existed */
  }

  // Index for efficient session-by-task lookups
  sqlite.exec(
    "CREATE INDEX IF NOT EXISTS idx_sessions_task_id ON sessions(task_id)",
  );

  // Migration: add default_persona_id to workspaces and tasks
  try {
    sqlite.exec(
      "ALTER TABLE workspaces ADD COLUMN default_persona_id TEXT NOT NULL DEFAULT ''",
    );
  } catch {
    /* column already exists */
  }
  try {
    sqlite.exec(
      "ALTER TABLE tasks ADD COLUMN default_persona_id TEXT NOT NULL DEFAULT ''",
    );
  } catch {
    /* column already exists */
  }

  // Migration: add type and script columns to personas if missing
  try {
    sqlite.exec(
      "ALTER TABLE personas ADD COLUMN type TEXT NOT NULL DEFAULT 'agent'",
    );
  } catch {
    /* column already exists */
  }
  try {
    sqlite.exec(
      "ALTER TABLE personas ADD COLUMN script TEXT NOT NULL DEFAULT ''",
    );
  } catch {
    /* column already exists */
  }

  // Migration: make workspace_id nullable on tasks.
  // SQLite doesn't support ALTER COLUMN, so we recreate the table.
  // Guard: only run if the column currently has NOT NULL.
  {
    const tableInfo = sqlite.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string; notnull: number }>;
    const workspaceIdCol = tableInfo.find((c) => c.name === "workspace_id");
    if (workspaceIdCol?.notnull === 1) {
      sqlite.exec(`
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
          default_persona_id TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO tasks_new SELECT
          id, workspace_id, title, description, status, branch, depends_on,
          started_at, completed_at, created_at, updated_at, sort_order,
          parent_task_id, depth, can_decompose, default_persona_id
        FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_new RENAME TO tasks;
        COMMIT;
      `);
    }
  }

  // Migration: add index on workspaces.environment_id for efficient lookup
  sqlite.exec(
    "CREATE INDEX IF NOT EXISTS idx_workspaces_environment_id ON workspaces(environment_id)",
  );

  // Seed: create default "Claude Code" persona if no personas exist
  const personaCount = sqlite
    .prepare("SELECT COUNT(*) as cnt FROM personas")
    .get() as { cnt: number };
  if (personaCount.cnt === 0) {
    sqlite.exec(`
      INSERT INTO personas (id, name, description, system_prompt, runtime, model, max_turns)
      VALUES (
        'claude-code',
        'Claude Code',
        'Default agent persona using Claude Code runtime',
        '',
        'claude-code',
        'sonnet',
        0
      )
    `);
    sqlite.exec(`
      INSERT OR IGNORE INTO settings (key, value)
      VALUES ('default_persona_id', 'claude-code')
    `);
  }

  // Migration: update the seed persona with the completion checklist and clearer name.
  // Guards: only run when the system_prompt is still empty and name is still "Claude Code"
  // so we don't overwrite user customizations.
  sqlite.exec(`
    UPDATE personas SET system_prompt = 'When you have finished implementing the task, you MUST complete ALL steps below in order. Do NOT stop early or go to "waiting for input" until every step is done.

### Phase 1: Implement & Test
1. **Implement** the task requirements.
2. **Write tests**: Write unit tests, integration tests, or E2E specs as appropriate. Every implementation MUST include tests unless the change is purely cosmetic or untestable (state why if skipping).
3. **Build**: Run the repository''s build command and fix any errors.
4. **Run tests**: Run relevant tests and ensure they pass.
5. **Manual test**: If the change affects UI, visually verify. If it affects CLI or API, run the commands manually. State explicitly if skipping and why.

### Phase 2: Create PR
6. **Sync with main**: Fetch and merge the main branch. If merge conflicts arise, resolve them, stage, and commit the merge. NEVER rebase.
7. **Rebuild after merge**: If the merge brought in new commits, rebuild to catch integration conflicts.
8. **Commit**: Stage your changed files and create a descriptive git commit. Use a conventional commit message (e.g., fix: ..., feat: ...).
9. **Push**: Push your branch to the remote.
10. **Create PR**: Create a pull request that links back to the issue (e.g., "Closes #ISSUE").

### Phase 3: PR Readiness (you MUST complete this — do NOT skip)
After creating the PR, you must ensure it is ready to merge.

11. **Check for merge conflicts**: Verify the PR has no merge conflicts. If it does, fetch and merge the main branch, resolve conflicts, rebuild, commit, and push.
12. **Wait for CI**: Wait for all CI checks to complete. If any check fails, read the logs, fix the issue, commit, push, and repeat.
13. **Address code review comments**: Check for automated code review comments. For each unresolved comment: read the suggestion, fix the code or dismiss with an explanation, reply to the comment, and resolve the thread. After fixing, commit, push, and check again. Repeat until all review threads are resolved.
14. **Post finding**: Use finding_post to summarize what you did and any key decisions.

IMPORTANT: The PR is the deliverable, but a PR with failing CI or unresolved review comments is NOT done. You MUST complete Phase 3. Do NOT go to "waiting for input" until CI is green AND all review threads are resolved.'
    WHERE id = 'claude-code' AND system_prompt = '' AND name = 'Claude Code'
  `);
  sqlite.exec(`
    UPDATE personas
    SET name = 'Software Engineer',
        description = 'Default agent persona for software engineering tasks'
    WHERE id = 'claude-code'
      AND name = 'Claude Code'
      AND NOT EXISTS (
        SELECT 1 FROM personas
        WHERE name = 'Software Engineer'
          AND id != 'claude-code'
      )
  `);

  // Seed: ensure a System persona exists with the canonical SYSTEM_PERSONA_ID.
  // Copies runtime + model from the seed persona so the FRE choice propagates.
  // Handles name collisions: if a user-created persona named "System" already
  // exists under a different id, reassign it to SYSTEM_PERSONA_ID.
  {
    const existingSystemById = sqlite
      .prepare("SELECT id FROM personas WHERE id = ?")
      .get(SYSTEM_PERSONA_ID) as { id: string } | undefined;

    if (!existingSystemById) {
      const seedRow = sqlite
        .prepare("SELECT runtime, model FROM personas WHERE id = 'claude-code'")
        .get() as { runtime: string; model: string } | undefined;
      const systemRuntime = seedRow?.runtime || "claude-code";
      const systemModel = seedRow?.model || "sonnet";

      const existingSystemByName = sqlite
        .prepare("SELECT id FROM personas WHERE name = 'System'")
        .get() as { id: string } | undefined;

      if (existingSystemByName && existingSystemByName.id !== SYSTEM_PERSONA_ID) {
        // Reassign existing "System" persona to the canonical id and update
        // all stored references atomically so a crash can't leave dangling refs.
        const reassignSystemPersona = sqlite.transaction((oldId: string) => {
          sqlite.prepare("UPDATE personas SET id = ? WHERE id = ?").run(SYSTEM_PERSONA_ID, oldId);
          sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'default_persona_id' AND value = ?").run(SYSTEM_PERSONA_ID, oldId);
          sqlite.prepare("UPDATE sessions SET persona_id = ? WHERE persona_id = ?").run(SYSTEM_PERSONA_ID, oldId);
          sqlite.prepare("UPDATE tasks SET default_persona_id = ? WHERE default_persona_id = ?").run(SYSTEM_PERSONA_ID, oldId);
          sqlite.prepare("UPDATE workspaces SET default_persona_id = ? WHERE default_persona_id = ?").run(SYSTEM_PERSONA_ID, oldId);
        });
        reassignSystemPersona(existingSystemByName.id);
      } else if (!existingSystemByName) {
        sqlite
          .prepare(`
            INSERT INTO personas (id, name, description, system_prompt, runtime, model, max_turns, type)
            VALUES (?, 'System', 'Central orchestrator persona', ?, ?, ?, 0, 'agent')
          `)
          .run(
            SYSTEM_PERSONA_ID,
            [
              "You are the System — the central orchestrator for Grackle, an agent kernel that manages AI coding agents.",
              "",
              "You help the user coordinate work across their development environments. You can:",
              "- Answer questions and have conversations",
              "- Help plan and break down work into tasks",
              "- Create and manage workspaces (project containers tied to environments)",
              "- Create, assign, and monitor tasks executed by AI coding agents",
              "- Share and query findings (knowledge shared between agents)",
              "",
              "When the user describes work to be done:",
              "1. Help them think through the approach",
              "2. Break complex work into discrete, well-scoped tasks",
              "3. Create tasks with clear titles and descriptions that an AI agent can execute independently",
              "4. Start tasks on appropriate environments",
              "5. Monitor progress and report results",
              "",
              "You are always available for conversation. Think of yourself as the user's AI project manager — you coordinate the agents, track progress, and ensure work is organized effectively.",
              "",
              "Keep responses concise and action-oriented. When the user wants something done, bias toward creating and starting tasks rather than lengthy discussion.",
            ].join("\n"),
            systemRuntime,
            systemModel,
          );
      }
    }
  }

  // Seed: create root task (well-known "system" task) if it doesn't exist.
  sqlite
    .prepare(`
      INSERT OR IGNORE INTO tasks (id, workspace_id, title, description, status, branch, parent_task_id, depth, can_decompose, default_persona_id)
      VALUES (?, NULL, 'System', '', 'not_started', 'system', '', 0, 1, ?)
    `)
    .run(ROOT_TASK_ID, SYSTEM_PERSONA_ID);

  // Backfill: ensure default_persona_id setting exists for upgrades.
  // Existing installations may have personas but no default_persona_id setting,
  // which would cause resolvePersona() to fail when no persona is explicitly specified.
  const existingDefault = sqlite
    .prepare("SELECT value FROM settings WHERE key = 'default_persona_id'")
    .get() as { value: string } | undefined;
  if (!existingDefault) {
    // Prefer the seed persona 'claude-code' if it exists; otherwise fall back
    // to the first persona alphabetically.
    const fallback = (
      sqlite.prepare("SELECT id FROM personas WHERE id = 'claude-code'").get() ??
      sqlite.prepare("SELECT id FROM personas ORDER BY name LIMIT 1").get()
    ) as { id: string } | undefined;
    if (fallback) {
      sqlite
        .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('default_persona_id', ?)")
        .run(fallback.id);
    }
  }

  // Backfill: ensure onboarding_completed setting exists.
  // Fresh installs (no pre-existing environments or personas) get "false" to trigger
  // the setup wizard. Upgrades (pre-existing data) get "true" to skip it.
  // personaCount was captured before the seed insert, so it reflects user-created personas.
  const existingOnboarding = sqlite
    .prepare("SELECT value FROM settings WHERE key = 'onboarding_completed'")
    .get() as { value: string } | undefined;
  if (!existingOnboarding) {
    const environmentCount = sqlite
      .prepare("SELECT COUNT(*) as cnt FROM environments")
      .get() as { cnt: number };
    const isFreshInstall = environmentCount.cnt === 0 && personaCount.cnt === 0;
    sqlite
      .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('onboarding_completed', ?)")
      .run(isFreshInstall ? "false" : "true");
  }
}

// Run init immediately for backwards compatibility — stores import db at module load
initDatabase();

/** Drizzle ORM instance wrapping the SQLite database. */
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
const db: BetterSQLite3Database<typeof schema> & {
  $client: InstanceType<typeof Database>;
} = drizzle(sqlite, { schema });

export default db;
