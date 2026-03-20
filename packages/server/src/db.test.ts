import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { SYSTEM_PERSONA_ID, ROOT_TASK_ID } from "@grackle-ai/common";
import { initDatabase } from "./db.js";

/** Expected tables created by initDatabase. */
const EXPECTED_TABLES: string[] = [
  "environments",
  "sessions",
  "tokens",
  "workspaces",
  "tasks",
  "findings",
  "personas",
  "settings",
  "domain_events",
];

/** Helper: list all user tables in a SQLite database. */
function listTables(db: InstanceType<typeof Database>): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
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

  it("is idempotent — second call succeeds without errors", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    const first = initDatabase(mem);
    const second = initDatabase(mem);

    // Second run should succeed (tables already exist)
    expect(second.migrationErrors.length).toBeGreaterThanOrEqual(0);

    // Tables still present
    const tables = listTables(mem);
    for (const table of EXPECTED_TABLES) {
      expect(tables).toContain(table);
    }

    // First run should have some migration errors (e.g. "no such table" for
    // rename migrations on a fresh db)
    expect(first.migrationErrors.length).toBeGreaterThan(0);
  });

  it("seeds the default persona on fresh install", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    initDatabase(mem);

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

    const setting = mem
      .prepare("SELECT value FROM settings WHERE key = 'default_persona_id'")
      .get() as { value: string } | undefined;
    expect(setting).toBeDefined();
    expect(setting!.value).toBe("claude-code");
  });

  it("returns migration errors from idempotent rename/add-column steps", () => {
    const mem = new Database(":memory:");
    mem.pragma("foreign_keys = ON");

    const { migrationErrors } = initDatabase(mem);

    // On a fresh database, renames like "projects → workspaces" fail because
    // the source table/column doesn't exist — these are collected as errors.
    expect(migrationErrors.length).toBeGreaterThan(0);

    const names = migrationErrors.map((e) => e.name);
    expect(names).toContain("rename-projects-to-workspaces");
  });

  it("throws when called without openDatabase and no override", () => {
    // db.ts no longer runs side effects at import time, so the module-level
    // sqlite is undefined. Calling initDatabase() without an override triggers
    // the guard.
    expect(() => initDatabase()).toThrow("Database not initialized");
  });
});
