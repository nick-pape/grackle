import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use the shared in-memory test database, matching
//    persona-store.test.ts so module-load-time imports of `db` in agent-store
//    resolve to a stable instance (not `undefined`).
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// Import modules AFTER the mock is set up.
import * as agentStore from "./agent-store.js";
import { sqlite } from "./test-db.js";

/** Apply the schema DDL to the in-memory database. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL UNIQUE,
      avatar             TEXT NOT NULL DEFAULT '',
      primary_persona_id TEXT NOT NULL DEFAULT '',
      environment_id     TEXT NOT NULL DEFAULT '',
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

describe("agent-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS agents");
    applySchema();
  });

  it("creates and retrieves an agent", () => {
    agentStore.createAgent("a1", "Refactor Bot", "🐦", "p1", "local");
    const a = agentStore.getAgent("a1");
    expect(a?.name).toBe("Refactor Bot");
    expect(a?.avatar).toBe("🐦");
    expect(a?.primaryPersonaId).toBe("p1");
    expect(a?.environmentId).toBe("local");
  });

  it("retrieves an agent by name", () => {
    agentStore.createAgent("a2", "ByName", "", "", "env-x");
    const a = agentStore.getAgentByName("ByName");
    expect(a?.id).toBe("a2");
  });

  it("enforces a unique name", () => {
    agentStore.createAgent("a3", "Dupe", "", "", "env-x");
    expect(() => agentStore.createAgent("a4", "Dupe", "", "", "env-x")).toThrow();
  });

  it("lists all agents ordered by name", () => {
    agentStore.createAgent("a5", "Zeta", "", "", "env-x");
    agentStore.createAgent("a6", "Alpha", "", "", "env-x");
    const all = agentStore.listAgents();
    expect(all.map((a) => a.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("updates only the provided fields", () => {
    agentStore.createAgent("a7", "Before", "x", "p1", "env-x");
    agentStore.updateAgent("a7", { name: "After", primaryPersonaId: "p2" });
    const a = agentStore.getAgent("a7");
    expect(a?.name).toBe("After");
    expect(a?.primaryPersonaId).toBe("p2");
    // avatar was not passed → unchanged
    expect(a?.avatar).toBe("x");
    // environmentId was not in updateAgent's surface → unchanged
    expect(a?.environmentId).toBe("env-x");
  });

  it("deletes an agent", () => {
    agentStore.createAgent("a8", "Doomed", "", "", "env-x");
    agentStore.deleteAgent("a8");
    expect(agentStore.getAgent("a8")).toBeUndefined();
  });

  it("lists agents by environment, sorted by name", () => {
    agentStore.createAgent("a-z", "Zeta", "", "", "env-a");
    agentStore.createAgent("a-a", "Alpha", "", "", "env-a");
    agentStore.createAgent("b-c", "Charlie", "", "", "env-b");
    const aEnv = agentStore.getAgentsByEnvironment("env-a");
    expect(aEnv.map((a) => a.name)).toEqual(["Alpha", "Zeta"]);
    const bEnv = agentStore.getAgentsByEnvironment("env-b");
    expect(bEnv.map((a) => a.name)).toEqual(["Charlie"]);
    const empty = agentStore.getAgentsByEnvironment("env-none");
    expect(empty).toEqual([]);
  });
});
