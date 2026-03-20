import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SYSTEM_PERSONA_ID, ROOT_TASK_ID } from "@grackle-ai/common";

/**
 * Tests for the System persona and root task seeding logic in db.ts.
 *
 * We replicate the seed logic here against an in-memory database rather than
 * importing db.ts (which runs initDatabase at module-load time and opens the
 * real database file).
 */

/** Create the minimal schema needed for the seed logic. */
function createSchema(db: InstanceType<typeof Database>): void {
  db.exec(`
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
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id             TEXT PRIMARY KEY,
      workspace_id   TEXT,
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

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      env_id     TEXT NOT NULL DEFAULT '',
      runtime    TEXT NOT NULL DEFAULT '',
      prompt     TEXT NOT NULL DEFAULT '',
      model      TEXT NOT NULL DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'pending',
      persona_id TEXT NOT NULL DEFAULT '',
      task_id    TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL,
      environment_id     TEXT NOT NULL DEFAULT '',
      status             TEXT NOT NULL DEFAULT 'active',
      default_persona_id TEXT NOT NULL DEFAULT '',
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/**
 * Replicate the System persona + root task seed logic from db.ts.
 * This mirrors the code in initDatabase() so the test catches regressions.
 */
function runSeedLogic(db: InstanceType<typeof Database>): void {
  // Seed persona logic
  const existingSystemById = db
    .prepare("SELECT id FROM personas WHERE id = ?")
    .get(SYSTEM_PERSONA_ID) as { id: string } | undefined;

  if (!existingSystemById) {
    const seedRow = db
      .prepare("SELECT runtime, model FROM personas WHERE id = 'claude-code'")
      .get() as { runtime: string; model: string } | undefined;
    const systemRuntime = seedRow?.runtime || "claude-code";
    const systemModel = seedRow?.model || "sonnet";

    const existingSystemByName = db
      .prepare("SELECT id FROM personas WHERE name = 'System'")
      .get() as { id: string } | undefined;

    if (existingSystemByName && existingSystemByName.id !== SYSTEM_PERSONA_ID) {
      const reassign = db.transaction((oldId: string) => {
        db.prepare("UPDATE personas SET id = ? WHERE id = ?").run(SYSTEM_PERSONA_ID, oldId);
        db.prepare("UPDATE settings SET value = ? WHERE key = 'default_persona_id' AND value = ?").run(SYSTEM_PERSONA_ID, oldId);
        db.prepare("UPDATE sessions SET persona_id = ? WHERE persona_id = ?").run(SYSTEM_PERSONA_ID, oldId);
        db.prepare("UPDATE tasks SET default_persona_id = ? WHERE default_persona_id = ?").run(SYSTEM_PERSONA_ID, oldId);
        db.prepare("UPDATE workspaces SET default_persona_id = ? WHERE default_persona_id = ?").run(SYSTEM_PERSONA_ID, oldId);
      });
      reassign(existingSystemByName.id);
    } else if (!existingSystemByName) {
      db.prepare(`
        INSERT INTO personas (id, name, description, system_prompt, runtime, model, max_turns, type)
        VALUES (?, 'System', 'Central orchestrator persona', 'system prompt', ?, ?, 0, 'agent')
      `).run(SYSTEM_PERSONA_ID, systemRuntime, systemModel);
    }
  }

  // Seed root task logic
  db.prepare(`
    INSERT OR IGNORE INTO tasks (id, workspace_id, title, description, status, branch, parent_task_id, depth, can_decompose, default_persona_id)
    VALUES (?, NULL, 'System', '', 'not_started', 'system', '', 0, 1, ?)
  `).run(ROOT_TASK_ID, SYSTEM_PERSONA_ID);
}

describe("DB seed: System persona + root task", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
  });

  it("seeds System persona on fresh install", () => {
    // Simulate seed persona existing first
    db.prepare(`
      INSERT INTO personas (id, name, system_prompt, runtime, model)
      VALUES ('claude-code', 'Claude Code', '', 'claude-code', 'sonnet')
    `).run();

    runSeedLogic(db);

    const persona = db.prepare("SELECT * FROM personas WHERE id = ?").get(SYSTEM_PERSONA_ID) as Record<string, unknown>;
    expect(persona).toBeDefined();
    expect(persona.name).toBe("System");
    expect(persona.runtime).toBe("claude-code");
    expect(persona.model).toBe("sonnet");
    expect(persona.type).toBe("agent");
  });

  it("seeds root task on fresh install", () => {
    db.prepare(`
      INSERT INTO personas (id, name, system_prompt, runtime, model)
      VALUES ('claude-code', 'Claude Code', '', 'claude-code', 'sonnet')
    `).run();

    runSeedLogic(db);

    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(ROOT_TASK_ID) as Record<string, unknown>;
    expect(task).toBeDefined();
    expect(task.title).toBe("System");
    expect(task.workspace_id).toBeNull();
    expect(task.status).toBe("not_started");
    expect(task.can_decompose).toBe(1);
    expect(task.default_persona_id).toBe(SYSTEM_PERSONA_ID);
  });

  it("copies runtime/model from seed persona", () => {
    db.prepare(`
      INSERT INTO personas (id, name, system_prompt, runtime, model)
      VALUES ('claude-code', 'Claude Code', '', 'copilot', 'gpt-4o')
    `).run();

    runSeedLogic(db);

    const persona = db.prepare("SELECT runtime, model FROM personas WHERE id = ?").get(SYSTEM_PERSONA_ID) as Record<string, unknown>;
    expect(persona.runtime).toBe("copilot");
    expect(persona.model).toBe("gpt-4o");
  });

  it("is idempotent — running twice does not duplicate", () => {
    db.prepare(`
      INSERT INTO personas (id, name, system_prompt, runtime, model)
      VALUES ('claude-code', 'Claude Code', '', 'claude-code', 'sonnet')
    `).run();

    runSeedLogic(db);
    runSeedLogic(db);

    const personaCount = db.prepare("SELECT COUNT(*) as cnt FROM personas WHERE id = ?").get(SYSTEM_PERSONA_ID) as { cnt: number };
    const taskCount = db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE id = ?").get(ROOT_TASK_ID) as { cnt: number };
    expect(personaCount.cnt).toBe(1);
    expect(taskCount.cnt).toBe(1);
  });

  it("handles name collision — reassigns existing 'System' persona to canonical id", () => {
    // Pre-existing "System" persona with a different id
    db.prepare(`
      INSERT INTO personas (id, name, system_prompt, runtime, model)
      VALUES ('custom-system', 'System', 'custom prompt', 'codex', 'o3')
    `).run();
    // A task referencing the old id
    db.prepare(`
      INSERT INTO tasks (id, title, default_persona_id)
      VALUES ('t1', 'Test task', 'custom-system')
    `).run();

    runSeedLogic(db);

    // The persona should now have the canonical id
    const persona = db.prepare("SELECT * FROM personas WHERE id = ?").get(SYSTEM_PERSONA_ID) as Record<string, unknown>;
    expect(persona).toBeDefined();
    expect(persona.name).toBe("System");

    // Old id should be gone
    const oldPersona = db.prepare("SELECT * FROM personas WHERE id = 'custom-system'").get();
    expect(oldPersona).toBeUndefined();

    // References should be updated
    const task = db.prepare("SELECT default_persona_id FROM tasks WHERE id = 't1'").get() as Record<string, unknown>;
    expect(task.default_persona_id).toBe(SYSTEM_PERSONA_ID);
  });

  it("updates settings references on persona id reassignment", () => {
    db.prepare(`
      INSERT INTO personas (id, name, system_prompt, runtime, model)
      VALUES ('old-sys', 'System', 'prompt', 'claude-code', 'sonnet')
    `).run();
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('default_persona_id', 'old-sys')
    `).run();

    runSeedLogic(db);

    const setting = db.prepare("SELECT value FROM settings WHERE key = 'default_persona_id'").get() as { value: string };
    expect(setting.value).toBe(SYSTEM_PERSONA_ID);
  });

  it("defaults to claude-code/sonnet when no seed persona exists", () => {
    // No seed persona at all
    runSeedLogic(db);

    const persona = db.prepare("SELECT runtime, model FROM personas WHERE id = ?").get(SYSTEM_PERSONA_ID) as Record<string, unknown>;
    expect(persona.runtime).toBe("claude-code");
    expect(persona.model).toBe("sonnet");
  });
});
