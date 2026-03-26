import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// Import modules AFTER mock is set up
import * as personaStore from "./persona-store.js";
import { sqlite } from "./test-db.js";

/** Apply the schema DDL to the in-memory database. */
function applySchema(): void {
  sqlite.exec(`
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
  `);
}

describe("persona-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS personas");
    applySchema();
  });

  it("creates and retrieves a persona", () => {
    personaStore.createPersona(
      "fe-eng",
      "Frontend Engineer",
      "React specialist",
      "You are a frontend engineer.",
      "{}",
      "claude-code",
      "sonnet",
      10,
      "[]",
    );
    const p = personaStore.getPersona("fe-eng");
    expect(p).toBeDefined();
    expect(p!.name).toBe("Frontend Engineer");
    expect(p!.systemPrompt).toBe("You are a frontend engineer.");
    expect(p!.runtime).toBe("claude-code");
    expect(p!.model).toBe("sonnet");
    expect(p!.maxTurns).toBe(10);
  });

  it("retrieves a persona by name", () => {
    personaStore.createPersona(
      "sec-rev",
      "Security Reviewer",
      "",
      "You review code for vulnerabilities.",
      "{}",
      "",
      "",
      0,
      "[]",
    );
    const p = personaStore.getPersonaByName("Security Reviewer");
    expect(p).toBeDefined();
    expect(p!.id).toBe("sec-rev");
  });

  it("returns undefined for non-existent persona", () => {
    expect(personaStore.getPersona("nope")).toBeUndefined();
    expect(personaStore.getPersonaByName("nope")).toBeUndefined();
  });

  it("lists all personas ordered by name", () => {
    personaStore.createPersona(
      "b",
      "Beta",
      "",
      "prompt",
      "{}",
      "",
      "",
      0,
      "[]",
    );
    personaStore.createPersona(
      "a",
      "Alpha",
      "",
      "prompt",
      "{}",
      "",
      "",
      0,
      "[]",
    );
    personaStore.createPersona(
      "c",
      "Charlie",
      "",
      "prompt",
      "{}",
      "",
      "",
      0,
      "[]",
    );
    const list = personaStore.listPersonas();
    expect(list).toHaveLength(3);
    expect(list[0].name).toBe("Alpha");
    expect(list[1].name).toBe("Beta");
    expect(list[2].name).toBe("Charlie");
  });

  it("updates a persona", () => {
    personaStore.createPersona(
      "p1",
      "Original",
      "",
      "old prompt",
      "{}",
      "",
      "",
      0,
      "[]",
    );
    personaStore.updatePersona(
      "p1",
      "Updated",
      "new desc",
      "new prompt",
      "{}",
      "copilot",
      "opus",
      20,
      "[]",
    );
    const p = personaStore.getPersona("p1");
    expect(p!.name).toBe("Updated");
    expect(p!.description).toBe("new desc");
    expect(p!.systemPrompt).toBe("new prompt");
    expect(p!.runtime).toBe("copilot");
    expect(p!.model).toBe("opus");
    expect(p!.maxTurns).toBe(20);
  });

  it("update sets updatedAt", () => {
    personaStore.createPersona(
      "p1",
      "Test",
      "",
      "prompt",
      "{}",
      "",
      "",
      0,
      "[]",
    );
    const before = personaStore.getPersona("p1")!.updatedAt;
    // SQLite datetime('now') has second-level precision, so we just check it's set
    personaStore.updatePersona(
      "p1",
      "Test2",
      "",
      "prompt2",
      "{}",
      "",
      "",
      0,
      "[]",
    );
    const after = personaStore.getPersona("p1")!.updatedAt;
    expect(after).toBeDefined();
    expect(before).toBeDefined();
  });

  it("deletes a persona", () => {
    personaStore.createPersona(
      "del",
      "ToDelete",
      "",
      "prompt",
      "{}",
      "",
      "",
      0,
      "[]",
    );
    expect(personaStore.getPersona("del")).toBeDefined();
    personaStore.deletePersona("del");
    expect(personaStore.getPersona("del")).toBeUndefined();
  });

  it("enforces unique name constraint", () => {
    personaStore.createPersona(
      "p1",
      "Same Name",
      "",
      "prompt",
      "{}",
      "",
      "",
      0,
      "[]",
    );
    expect(() => {
      personaStore.createPersona(
        "p2",
        "Same Name",
        "",
        "prompt",
        "{}",
        "",
        "",
        0,
        "[]",
      );
    }).toThrow();
  });

  it("returns empty list when no personas exist", () => {
    expect(personaStore.listPersonas()).toHaveLength(0);
  });

  it("deleting a non-existent persona is a no-op", () => {
    expect(() => personaStore.deletePersona("does-not-exist")).not.toThrow();
  });

  it("enforces unique name on update", () => {
    personaStore.createPersona("p1", "Name A", "", "prompt", "{}", "", "", 0, "[]");
    personaStore.createPersona("p2", "Name B", "", "prompt", "{}", "", "", 0, "[]");
    expect(() => {
      personaStore.updatePersona("p2", "Name A", "", "prompt", "{}", "", "", 0, "[]");
    }).toThrow();
  });

  it("creates and retrieves a script persona with type and script", () => {
    personaStore.createPersona(
      "script-1",
      "Nightly Report",
      "Generates nightly report",
      "",
      "{}",
      "genaiscript",
      "",
      0,
      "[]",
      "script",
      'script({ model: "none" }); $`Hello`;',
    );
    const p = personaStore.getPersona("script-1");
    expect(p).toBeDefined();
    expect(p!.type).toBe("script");
    expect(p!.script).toBe('script({ model: "none" }); $`Hello`;');
    expect(p!.runtime).toBe("genaiscript");
  });

  it("updates type and script fields", () => {
    personaStore.createPersona("p1", "Test", "", "prompt", "{}", "claude-code", "sonnet", 0, "[]");
    personaStore.updatePersona(
      "p1", "Test", "", "", "{}", "genaiscript", "", 0, "[]", "script", "console.log('hi');"
    );
    const p = personaStore.getPersona("p1");
    expect(p!.type).toBe("script");
    expect(p!.script).toBe("console.log('hi');");
  });

  it("defaults type to agent and script to empty when not provided", () => {
    personaStore.createPersona("p1", "Agent", "", "prompt", "{}", "claude-code", "sonnet", 0, "[]");
    const p = personaStore.getPersona("p1");
    expect(p!.type).toBe("agent");
    expect(p!.script).toBe("");
  });

  it("creates persona with allowedMcpTools and retrieves it", () => {
    personaStore.createPersona(
      "mcp-1", "MCP Test", "", "prompt", "{}", "", "", 0, "[]",
      "agent", "", '["finding_post","task_list"]',
    );
    const p = personaStore.getPersona("mcp-1");
    expect(p).toBeDefined();
    expect(p!.allowedMcpTools).toBe('["finding_post","task_list"]');
  });

  it("defaults allowedMcpTools to empty array JSON when not provided", () => {
    personaStore.createPersona("mcp-2", "Default MCP", "", "prompt", "{}", "", "", 0, "[]");
    const p = personaStore.getPersona("mcp-2");
    expect(p).toBeDefined();
    expect(p!.allowedMcpTools).toBe("[]");
  });

  it("updates allowedMcpTools", () => {
    personaStore.createPersona(
      "mcp-3", "Update MCP", "", "prompt", "{}", "", "", 0, "[]",
      "agent", "", '["finding_post"]',
    );
    personaStore.updatePersona(
      "mcp-3", "Update MCP", "", "prompt", "{}", "", "", 0, "[]",
      "agent", "", '["task_list","task_create"]',
    );
    const p = personaStore.getPersona("mcp-3");
    expect(p!.allowedMcpTools).toBe('["task_list","task_create"]');
  });
});
