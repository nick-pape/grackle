import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { SYSTEM_PERSONA_ID, ROOT_TASK_ID } from "@grackle-ai/common";
import { initDatabase, CURRENT_VERSION } from "./db.js";
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

    // Create a minimal sessions table missing cost_usd (a baseline-required column)
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
});
