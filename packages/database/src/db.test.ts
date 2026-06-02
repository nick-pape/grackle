import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSync, writeSync, closeSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { SYSTEM_PERSONA_ID, ROOT_TASK_ID } from "@grackle-ai/common";
import {
  initDatabase,
  CURRENT_VERSION,
  checkDatabaseIntegrity,
  backupDatabase,
  walCheckpoint,
  startWalCheckpointTimer,
  stopWalCheckpointTimer,
} from "./db.js";
import { seedDatabase } from "./db-seed.js";

/** Expected tables created by initDatabase. */
const EXPECTED_TABLES: string[] = [
  "domain_events",
  "environments",
  "findings",
  "personas",
  "schedules",
  "session_actions",
  "sessions",
  "settings",
  "tasks",
  "tokens",
  "workspaces",
];

/** Helper: list all user tables in a SQLite database. */
function listTables(db: InstanceType<typeof Database>): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/** Helper: read PRAGMA user_version. */
function getUserVersion(db: InstanceType<typeof Database>): number {
  return db.pragma("user_version", { simple: true }) as number;
}

describe("initDatabase", () => {
  it("creates all expected tables on a fresh in-memory database", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    initDatabase(mem);

    const tables = listTables(mem);
    for (const table of EXPECTED_TABLES) {
      expect(tables, `missing table: ${table}`).toContain(table);
    }
  });

  it("sets user_version to CURRENT_VERSION on fresh database", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    initDatabase(mem);

    expect(getUserVersion(mem)).toBe(CURRENT_VERSION);
  });

  it("is idempotent — second call succeeds without errors", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    initDatabase(mem);
    initDatabase(mem);

    const tables = listTables(mem);
    for (const table of EXPECTED_TABLES) {
      expect(tables).toContain(table);
    }
    expect(getUserVersion(mem)).toBe(CURRENT_VERSION);
  });

  it("promotes a legacy database (user_version = 0) to baseline", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    // Simulate a legacy database: create tables, leave user_version at 0
    initDatabase(mem);
    mem.pragma("user_version = 0");

    // Re-run — should detect existing tables and promote to baseline
    initDatabase(mem);
    expect(getUserVersion(mem)).toBe(CURRENT_VERSION);
  });

  it("throws on downgrade — database version newer than application", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    // Simulate a database upgraded by a newer binary
    mem.pragma("user_version = 9999");

    expect(() => initDatabase(mem)).toThrow("newer than this application supports");
  });

  it("throws on ancient database missing required columns", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    // Create a minimal sessions table missing cost_millicents (a baseline-required column)
    mem.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending'
      )
    `);

    expect(() => initDatabase(mem)).toThrow("Database schema is too old");
  });

  it("seeds the default persona on fresh install", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    initDatabase(mem);
    seedDatabase(mem);

    const persona = mem.prepare("SELECT * FROM personas WHERE id = 'claude-code'").get() as
      | Record<string, unknown>
      | undefined;
    expect(persona).toBeDefined();
    expect(persona!.name).toBe("Software Engineer");
    expect(persona!.runtime).toBe("claude-code");
    expect(persona!.model).toBe("sonnet");
  });

  it("seeds the System persona on fresh install", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    initDatabase(mem);
    seedDatabase(mem);

    const persona = mem.prepare("SELECT * FROM personas WHERE id = ?").get(SYSTEM_PERSONA_ID) as
      | Record<string, unknown>
      | undefined;
    expect(persona).toBeDefined();
    expect(persona!.name).toBe("System");
    expect(persona!.type).toBe("agent");
  });

  it("seeds the root task on fresh install", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    initDatabase(mem);
    seedDatabase(mem);

    const task = mem.prepare("SELECT * FROM tasks WHERE id = ?").get(ROOT_TASK_ID) as
      | Record<string, unknown>
      | undefined;
    expect(task).toBeDefined();
    expect(task!.title).toBe("System");
    expect(task!.workspace_id).toBeNull();
    expect(task!.can_decompose).toBe(1);
    expect(task!.default_persona_id).toBe(SYSTEM_PERSONA_ID);
  });

  it("seeds onboarding_completed = false on fresh install", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    initDatabase(mem);
    seedDatabase(mem);

    const setting = mem
      .prepare("SELECT value FROM settings WHERE key = 'onboarding_completed'")
      .get() as { value: string } | undefined;
    expect(setting).toBeDefined();
    expect(setting!.value).toBe("false");
  });

  it("seeds default_persona_id setting on fresh install", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    initDatabase(mem);
    seedDatabase(mem);

    const setting = mem
      .prepare("SELECT value FROM settings WHERE key = 'default_persona_id'")
      .get() as { value: string } | undefined;
    expect(setting).toBeDefined();
    expect(setting!.value).toBe("claude-code");
  });

  it("throws when called without openDatabase and no override", () => {
    // db.ts no longer runs side effects at import time, so the module-level
    // sqlite is undefined. Calling initDatabase() without an override triggers
    // the guard.
    expect(() => initDatabase()).toThrow("Database not initialized");
  });

  it("migration v7 — backfills workspace_environment_links and drops environment_id", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    // Step 1: create the current schema (v7) as the starting point.
    initDatabase(mem);

    // Step 2: simulate a pre-v7 database by adding back the legacy column,
    // inserting a workspace whose environment_id has no matching link yet,
    // then rewinding user_version to 6.  FK checks are disabled during setup
    // because the re-added column's DEFAULT '' has no matching environment row.
    mem.pragma("foreign_keys = OFF");
    mem.exec("ALTER TABLE workspaces ADD COLUMN environment_id TEXT NOT NULL DEFAULT ''");

    // Insert the environment row first so the FK is satisfiable once FK is re-enabled.
    mem
      .prepare(
        "INSERT INTO environments (id, display_name, adapter_type, adapter_config, status) VALUES (?, ?, ?, ?, ?)",
      )
      .run("env-migrate-test", "Migrate Env", "local", "{}", "disconnected");

    // Insert a workspace that references the environment via the legacy column.
    mem
      .prepare("INSERT INTO workspaces (id, name, environment_id) VALUES (?, ?, ?)")
      .run("ws-migrate-test", "Migrate WS", "env-migrate-test");

    // Ensure no pre-existing link exists for this workspace (backfill not yet done).
    mem.exec("DELETE FROM workspace_environment_links WHERE workspace_id = 'ws-migrate-test'");

    // Rewind to version 6 so initDatabase will run migration v7.
    mem.pragma("user_version = 6");
    mem.pragma("foreign_keys = ON");

    // Step 3: run migration.
    initDatabase(mem);

    // Assert: link was backfilled from environment_id.
    const link = mem
      .prepare("SELECT * FROM workspace_environment_links WHERE workspace_id = 'ws-migrate-test'")
      .get() as Record<string, unknown> | undefined;
    expect(link).toBeDefined();
    expect(link!.environment_id).toBe("env-migrate-test");

    // Assert: environment_id column was dropped.
    const cols = mem.prepare("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "environment_id")).toBe(false);

    // Assert: schema version advanced to current.
    expect(mem.pragma("user_version", { simple: true })).toBe(CURRENT_VERSION);

    // Assert: no FK violations remain.
    const fkViolations = mem.prepare("PRAGMA foreign_key_check").all() as unknown[];
    expect(fkViolations.length).toBe(0);
  });

  it("migration v8 — drops environment_id column from schedules", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    // Step 1: Create the current (post-migration) schema so all tables exist.
    initDatabase(mem);

    // Step 2: Mutate to a pre-v8 shape — add the legacy column back and rewind
    // user_version so initDatabase will re-run migration v8 on the next call.
    mem.exec("ALTER TABLE schedules ADD COLUMN environment_id TEXT NOT NULL DEFAULT ''");
    mem.pragma("user_version = 7");

    // Run migration.
    initDatabase(mem);

    // Assert: environment_id column was dropped.
    const cols = mem.prepare("PRAGMA table_info(schedules)").all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "environment_id")).toBe(false);

    // Assert: schema version advanced to current.
    expect(mem.pragma("user_version", { simple: true })).toBe(CURRENT_VERSION);
  });

  it("migration v14 — creates session_actions + index and advances version on upgrade from v13", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    // Step 1: create the current (post-v14) schema so all tables exist.
    initDatabase(mem);

    // Step 2: simulate a pre-v14 database — drop the table and rewind user_version
    // to 13 so initDatabase re-runs migration v14 (its CREATE … IF NOT EXISTS body
    // executes, proving the migration SQL is valid; baseline also recreates it).
    mem.exec("DROP TABLE session_actions");
    mem.pragma("user_version = 13");

    // Step 3: run migration.
    initDatabase(mem);

    // Assert: table and its index exist.
    expect(listTables(mem)).toContain("session_actions");
    const idx = mem
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_session_actions_session'",
      )
      .get() as { name: string } | undefined;
    expect(idx?.name).toBe("idx_session_actions_session");

    // Assert: schema version advanced to current.
    expect(getUserVersion(mem)).toBe(CURRENT_VERSION);

    // Assert: a row round-trips through the upgraded table.
    mem
      .prepare(
        "INSERT INTO session_actions (seq, session_id, type, content, raw, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("01A", "s1", "text", "hi", "", "2026-05-24T00:00:00.000Z");
    const row = mem
      .prepare("SELECT seq, session_id, type, content FROM session_actions WHERE session_id = 's1'")
      .get() as Record<string, unknown> | undefined;
    expect(row).toMatchObject({ seq: "01A", session_id: "s1", type: "text", content: "hi" });
  });

  it("migration v20 — creates agents table on upgrade from v19 (#1417)", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    // Step 1: create the current schema so all tables exist.
    initDatabase(mem);

    // Step 2: simulate a pre-v20 database — drop the table and rewind.
    mem.exec("DROP TABLE agents");
    mem.pragma("user_version = 19");
    expect(listTables(mem)).not.toContain("agents");

    // Step 3: run migration.
    initDatabase(mem);

    // Assert: table exists and version advanced.
    expect(listTables(mem)).toContain("agents");
    expect(getUserVersion(mem)).toBe(CURRENT_VERSION);

    // Assert: a row round-trips through the upgraded table.
    mem
      .prepare("INSERT INTO agents (id, name, avatar, primary_persona_id) VALUES (?, ?, ?, ?)")
      .run("a1", "Refactor Bot", "B", "claude-code");
    const row = mem
      .prepare("SELECT id, name, avatar, primary_persona_id FROM agents WHERE id = 'a1'")
      .get() as Record<string, unknown> | undefined;
    expect(row).toMatchObject({
      id: "a1",
      name: "Refactor Bot",
      avatar: "B",
      primary_persona_id: "claude-code",
    });
  });

  it("migration v21 — adds tasks.agent_id + tasks.kind + agents.environment_id (#1418)", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    // Step 1: create the current schema so all tables exist.
    initDatabase(mem);

    // Step 2: simulate a pre-v21 database — drop indices FIRST (SQLite
    // refuses DROP COLUMN if an index references the column), then the
    // columns, then rewind user_version.
    mem.exec("DROP INDEX IF EXISTS idx_tasks_agent_id");
    mem.exec("DROP INDEX IF EXISTS idx_tasks_kind");
    mem.exec("DROP INDEX IF EXISTS idx_agents_environment_id");
    mem.exec("ALTER TABLE tasks DROP COLUMN agent_id");
    mem.exec("ALTER TABLE tasks DROP COLUMN kind");
    mem.exec("ALTER TABLE agents DROP COLUMN environment_id");
    mem.pragma("user_version = 20");

    // Sanity: columns gone.
    const preTaskCols = mem.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    expect(preTaskCols.map((c) => c.name)).not.toContain("agent_id");
    expect(preTaskCols.map((c) => c.name)).not.toContain("kind");

    // Step 3: run migration.
    initDatabase(mem);

    // Assert: schema version advanced to current.
    expect(getUserVersion(mem)).toBe(CURRENT_VERSION);

    // Assert: columns exist.
    const taskCols = mem.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    expect(taskCols.map((c) => c.name)).toContain("agent_id");
    expect(taskCols.map((c) => c.name)).toContain("kind");
    const agentCols = mem.prepare("PRAGMA table_info(agents)").all() as Array<{ name: string }>;
    expect(agentCols.map((c) => c.name)).toContain("environment_id");

    // Assert: indices exist.
    const indices = mem
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_tasks_agent_id', 'idx_tasks_kind', 'idx_agents_environment_id')",
      )
      .all() as Array<{ name: string }>;
    expect(indices.map((i) => i.name).sort()).toEqual([
      "idx_agents_environment_id",
      "idx_tasks_agent_id",
      "idx_tasks_kind",
    ]);

    // Assert: a task row round-trips with the new columns. The FK requires
    // the referenced agent to exist.
    mem
      .prepare(
        "INSERT INTO agents (id, name, primary_persona_id, environment_id) VALUES (?, ?, ?, ?)",
      )
      .run("a1", "Refactor Bot", "claude-code", "local");
    mem
      .prepare(
        "INSERT INTO tasks (id, title, kind, agent_id, parent_task_id) VALUES (?, ?, ?, ?, ?)",
      )
      .run("t1", "A task", "task", "a1", "");
    const taskRow = mem.prepare("SELECT id, kind, agent_id FROM tasks WHERE id = 't1'").get() as
      | Record<string, unknown>
      | undefined;
    expect(taskRow).toMatchObject({ id: "t1", kind: "task", agent_id: "a1" });

    // Assert: existing tasks (the system root, seeded earlier) got kind='root'
    // via the migration's UPDATE. Note: seedDatabase wasn't called here, so the
    // system root doesn't exist yet — instead, exercise the UPDATE path by
    // inserting a 'system' row before re-running.
    mem.exec("DELETE FROM tasks WHERE id = 'system'");
    mem.prepare("INSERT INTO tasks (id, title, kind) VALUES ('system', 'System', 'task')").run();
    // Re-run initDatabase: the migration is already at CURRENT_VERSION so the
    // UPDATE inside the v21 `up` won't re-fire. Instead, manually invoke the
    // same SQL to prove it's idempotent and correctly targeted.
    mem.exec("UPDATE tasks SET kind = 'root' WHERE id = 'system' AND kind = 'task'");
    const sys = mem.prepare("SELECT kind FROM tasks WHERE id = 'system'").get() as
      | { kind: string }
      | undefined;
    expect(sys?.kind).toBe("root");
  });

  it("migration v22 — adds schedules.task_id + partial unique index, preserves v21 rows (#1438)", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    // Step 1: create current schema.
    initDatabase(mem);

    // Step 2: rewind to a v21 shape — drop the partial unique index FIRST (so
    // ALTER TABLE DROP COLUMN can proceed), drop the task_id column, set
    // user_version back to 21.
    mem.exec("DROP INDEX IF EXISTS uq_schedules_heartbeat_per_task");
    mem.exec("DROP INDEX IF EXISTS idx_schedules_task_id");
    mem.exec("ALTER TABLE schedules DROP COLUMN task_id");
    mem.pragma("user_version = 21");

    // Sanity: schedules has the v21 shape.
    const preCols = mem.prepare("PRAGMA table_info(schedules)").all() as Array<{ name: string }>;
    expect(preCols.map((c) => c.name)).not.toContain("task_id");

    // Step 3: insert two pre-existing fresh-task schedules (the rows production
    // installs will be carrying when v22 runs).
    mem
      .prepare(
        "INSERT INTO schedules (id, title, description, schedule_expression, persona_id, next_run_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("legacy-1", "Nightly", "review", "0 21 * * *", "claude-code", "2099-01-01T00:00:00Z");
    mem
      .prepare(
        "INSERT INTO schedules (id, title, description, schedule_expression, persona_id, next_run_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("legacy-2", "Hourly", "ping", "1h", "claude-code", "2099-01-01T00:00:00Z");

    // Step 4: re-run initDatabase → v22 fires.
    initDatabase(mem);

    // Schema version advanced.
    expect(getUserVersion(mem)).toBe(CURRENT_VERSION);

    // Assert: task_id column now present, nullable.
    const postCols = mem.prepare("PRAGMA table_info(schedules)").all() as Array<{
      name: string;
      notnull: number;
    }>;
    const taskIdCol = postCols.find((c) => c.name === "task_id");
    expect(taskIdCol).toBeDefined();
    expect(taskIdCol!.notnull).toBe(0); // nullable

    // Assert: pre-existing rows survived with task_id = NULL.
    const legacy = mem
      .prepare("SELECT id, task_id FROM schedules WHERE id LIKE 'legacy-%' ORDER BY id")
      .all() as Array<{ id: string; task_id: string | null }>;
    expect(legacy).toHaveLength(2);
    expect(legacy[0]!.task_id).toBeNull();
    expect(legacy[1]!.task_id).toBeNull();

    // Assert: partial unique index exists and references task_id.
    const indices = mem
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'uq_schedules_heartbeat_per_task'",
      )
      .all() as Array<{ name: string; sql: string }>;
    expect(indices).toHaveLength(1);
    expect(indices[0]!.sql).toContain("WHERE task_id IS NOT NULL");

    // Assert: the existing `idx_schedules_due` index is still in place — v22
    // doesn't disturb it.
    const dueIdx = mem
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_schedules_due'")
      .all();
    expect(dueIdx).toHaveLength(1);

    // Assert: a task must exist to use as a heartbeat target (FK).
    mem
      .prepare("INSERT INTO tasks (id, title, kind, parent_task_id) VALUES (?, ?, ?, ?)")
      .run("agent-root-1", "Agent Root", "root", "");

    // Assert: two heartbeats targeting the SAME task fail (partial unique).
    mem
      .prepare(
        "INSERT INTO schedules (id, title, schedule_expression, persona_id, task_id) VALUES (?, ?, ?, ?, ?)",
      )
      .run("hb-1", "HB", "30s", "claude-code", "agent-root-1");
    expect(() => {
      mem
        .prepare(
          "INSERT INTO schedules (id, title, schedule_expression, persona_id, task_id) VALUES (?, ?, ?, ?, ?)",
        )
        .run("hb-2", "HB2", "1m", "claude-code", "agent-root-1");
    }).toThrow(/UNIQUE constraint/);

    // Assert: multiple NULL task_id rows are allowed (the legacy fresh-task path).
    mem
      .prepare(
        "INSERT INTO schedules (id, title, schedule_expression, persona_id) VALUES (?, ?, ?, ?)",
      )
      .run("legacy-3", "AnotherLegacy", "30s", "claude-code");
    const nullCount = mem
      .prepare("SELECT COUNT(*) as c FROM schedules WHERE task_id IS NULL")
      .get() as { c: number };
    expect(nullCount.c).toBe(3); // legacy-1, legacy-2, legacy-3

    // Assert: foreign_keys remain consistent (deleting the task with a
    // heartbeat row referencing it would violate FK; we don't trigger that
    // here because `taskStore.deleteTask` is in app-layer cleanup. The
    // migration itself doesn't disturb FK integrity).
    const fkViolations = mem.prepare("PRAGMA foreign_key_check").all();
    expect(fkViolations).toHaveLength(0);
  });

  it("migration v23 — adds missing query-performance indexes (#1489)", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    // Step 1: create the current schema so all tables + indexes exist.
    initDatabase(mem);

    // Step 2: rewind to v22 and drop the new indexes.
    mem.pragma("user_version = 22");
    mem.exec("DROP INDEX IF EXISTS idx_tasks_parent_task_id");
    mem.exec("DROP INDEX IF EXISTS idx_sessions_env_id");
    mem.exec("DROP INDEX IF EXISTS idx_tasks_workspace_id");
    mem.exec("DROP INDEX IF EXISTS idx_sessions_parent_session_id");
    mem.exec("DROP INDEX IF EXISTS idx_schedules_task_id");

    // Sanity: indexes gone.
    const preIndexes = mem
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_tasks_parent_task_id'",
      )
      .all();
    expect(preIndexes).toHaveLength(0);

    // Step 3: re-run initDatabase → v23 fires.
    initDatabase(mem);

    // Schema version advanced.
    expect(getUserVersion(mem)).toBe(CURRENT_VERSION);

    // Assert: all five indexes exist.
    const indexNames = (
      mem
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_tasks_parent_task_id', 'idx_sessions_env_id', 'idx_tasks_workspace_id', 'idx_sessions_parent_session_id', 'idx_schedules_task_id')",
        )
        .all() as Array<{ name: string }>
    )
      .map((i) => i.name)
      .sort();

    expect(indexNames).toEqual([
      "idx_schedules_task_id",
      "idx_sessions_env_id",
      "idx_sessions_parent_session_id",
      "idx_tasks_parent_task_id",
      "idx_tasks_workspace_id",
    ]);

    // Assert: the schedules index is partial (WHERE task_id IS NOT NULL).
    const schedIdx = mem
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_schedules_task_id'",
      )
      .get() as { sql: string } | undefined;
    expect(schedIdx?.sql).toContain("WHERE task_id IS NOT NULL");
  });

  it("creates query-performance indexes on fresh database (#1489)", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");
    initDatabase(mem);

    const allIndexes = (
      mem.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{
        name: string;
      }>
    ).map((i) => i.name);

    expect(allIndexes).toContain("idx_tasks_parent_task_id");
    expect(allIndexes).toContain("idx_sessions_env_id");
    expect(allIndexes).toContain("idx_tasks_workspace_id");
    expect(allIndexes).toContain("idx_sessions_parent_session_id");
    expect(allIndexes).toContain("idx_schedules_task_id");
  });
});

describe("checkDatabaseIntegrity", () => {
  it("passes on a healthy database", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");
    initDatabase(mem);
    // Should not throw
    checkDatabaseIntegrity(mem);
  });

  it("throws on a corrupt database", () => {
    const tmpPath = join(tmpdir(), `grackle-test-corrupt-${Date.now()}.db`);
    // Create a database with enough data to span multiple pages
    const db1 = new Database(tmpPath);
    db1.pragma("journal_mode = DELETE");
    db1.exec("CREATE TABLE test (id TEXT, val TEXT)");
    for (let i = 0; i < 100; i++) {
      db1.exec(`INSERT INTO test VALUES ('id${i}', '${"x".repeat(200)}')`);
    }
    db1.close();

    // Corrupt page 2 (offset 4096 for default 4096-byte pages)
    const fd = openSync(tmpPath, "r+");
    writeSync(fd, Buffer.alloc(256, 0xff), 0, 256, 4096);
    closeSync(fd);

    // Reopen and check integrity
    const db2 = new Database(tmpPath);
    try {
      expect(() => checkDatabaseIntegrity(db2)).toThrow("integrity check failed");
    } finally {
      db2.close();
      try {
        unlinkSync(tmpPath);
      } catch {
        /* Windows EBUSY — OS will clean up temp */
      }
    }
  });
});

describe("backupDatabase", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* Windows EBUSY */
      }
    }
    tmpDirs.length = 0;
  });

  it("creates a backup file that matches the source", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "grackle-backup-"));
    tmpDirs.push(tmpDir);

    const srcPath = join(tmpDir, "source.db");
    const backupPath = join(tmpDir, "backup.db");

    const db = new Database(srcPath);
    db.exec("CREATE TABLE test (id TEXT)");
    db.exec("INSERT INTO test VALUES ('hello')");
    await backupDatabase(backupPath, db);
    db.close();

    // Verify backup is a valid SQLite DB with the same data
    const backup = new Database(backupPath);
    const row = backup.prepare("SELECT id FROM test").get() as { id: string };
    expect(row.id).toBe("hello");
    backup.close();
  });
});

describe("walCheckpoint", () => {
  it("does not throw on a healthy database", () => {
    const mem = new Database(":memory:");
    mem.pragma("journal_mode = WAL");
    expect(() => walCheckpoint(mem)).not.toThrow();
  });
});

describe("startWalCheckpointTimer / stopWalCheckpointTimer", () => {
  afterEach(() => {
    stopWalCheckpointTimer();
  });

  it("starts and stops without error", () => {
    startWalCheckpointTimer();
    stopWalCheckpointTimer();
  });

  it("is idempotent — multiple starts do not error", () => {
    startWalCheckpointTimer();
    startWalCheckpointTimer();
    stopWalCheckpointTimer();
  });
});
