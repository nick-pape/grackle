import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSync, writeSync, closeSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { SYSTEM_PERSONA_ID, ROOT_TASK_ID } from "@grackle-ai/common";
import {
  initDatabase, CURRENT_VERSION,
  checkDatabaseIntegrity, backupDatabase,
  walCheckpoint, startWalCheckpointTimer, stopWalCheckpointTimer,
} from "./db.js";
import { seedDatabase } from "./db-seed.js";

/** Expected tables created by initDatabase. */
const EXPECTED_TABLES: string[] = [
  "domain_events",
  "environments",
  "findings",
  "personas",
  "schedules",
  "sessions",
  "settings",
  "tasks",
  "tokens",
  "workspaces",
];

/** Helper: list all user tables in a SQLite database. */
function listTables(db: InstanceType<typeof Database>): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
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

    const persona = mem
      .prepare("SELECT * FROM personas WHERE id = 'claude-code'")
      .get() as Record<string, unknown> | undefined;
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

    const persona = mem
      .prepare("SELECT * FROM personas WHERE id = ?")
      .get(SYSTEM_PERSONA_ID) as Record<string, unknown> | undefined;
    expect(persona).toBeDefined();
    expect(persona!.name).toBe("System");
    expect(persona!.type).toBe("agent");
  });

  it("seeds the root task on fresh install", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    initDatabase(mem);
    seedDatabase(mem);

    const task = mem
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(ROOT_TASK_ID) as Record<string, unknown> | undefined;
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
    mem.prepare(
      "INSERT INTO environments (id, display_name, adapter_type, adapter_config, status) VALUES (?, ?, ?, ?, ?)",
    ).run("env-migrate-test", "Migrate Env", "local", "{}", "disconnected");

    // Insert a workspace that references the environment via the legacy column.
    mem.prepare(
      "INSERT INTO workspaces (id, name, environment_id) VALUES (?, ?, ?)",
    ).run("ws-migrate-test", "Migrate WS", "env-migrate-test");

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
    const cols = mem
      .prepare("PRAGMA table_info(workspaces)")
      .all() as Array<{ name: string }>;
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

    // Build schema up to v7.
    initDatabase(mem);

    // Simulate a pre-v8 database: add the legacy column back and rewind.
    mem.exec("ALTER TABLE schedules ADD COLUMN environment_id TEXT NOT NULL DEFAULT ''");
    mem.pragma("user_version = 7");

    // Run migration.
    initDatabase(mem);

    // Assert: environment_id column was dropped.
    const cols = mem
      .prepare("PRAGMA table_info(schedules)")
      .all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "environment_id")).toBe(false);

    // Assert: schema version advanced to current.
    expect(mem.pragma("user_version", { simple: true })).toBe(CURRENT_VERSION);
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
      try { unlinkSync(tmpPath); } catch { /* Windows EBUSY — OS will clean up temp */ }
    }
  });
});

describe("backupDatabase", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows EBUSY */ }
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
