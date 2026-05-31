import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the db module before importing the store
let sqlite: import("better-sqlite3").Database;

vi.mock("./db.js", () => {
  return {
    get default() {
      // Lazily resolve so each test file gets the in-memory DB created in beforeEach
      return testDb;
    },
  };
});

let testDb: ReturnType<typeof import("drizzle-orm/better-sqlite3").drizzle>;

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  createAgent,
  getAgent,
  getAgentByName,
  listAgents,
  updateAgent,
  deleteAgent,
} from "./agent-store.js";

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL UNIQUE,
      avatar             TEXT NOT NULL DEFAULT '',
      primary_persona_id TEXT NOT NULL DEFAULT '',
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  testDb = drizzle(sqlite);
});

afterEach(() => {
  sqlite.close();
});

describe("agent-store", () => {
  it("creates and retrieves an agent", () => {
    createAgent("a1", "Refactor Bot", "🐦", "p1");
    const a = getAgent("a1");
    expect(a?.name).toBe("Refactor Bot");
    expect(a?.avatar).toBe("🐦");
    expect(a?.primaryPersonaId).toBe("p1");
  });

  it("retrieves an agent by name", () => {
    createAgent("a2", "ByName", "", "");
    const a = getAgentByName("ByName");
    expect(a?.id).toBe("a2");
  });

  it("enforces a unique name", () => {
    createAgent("a3", "Dupe", "", "");
    expect(() => createAgent("a4", "Dupe", "", "")).toThrow();
  });

  it("lists all agents ordered by name", () => {
    createAgent("a5", "Zeta", "", "");
    createAgent("a6", "Alpha", "", "");
    const all = listAgents();
    expect(all.map((a) => a.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("updates only the provided fields", () => {
    createAgent("a7", "Before", "x", "p1");
    updateAgent("a7", { name: "After", primaryPersonaId: "p2" });
    const a = getAgent("a7");
    expect(a?.name).toBe("After");
    expect(a?.primaryPersonaId).toBe("p2");
    // avatar was not passed → unchanged
    expect(a?.avatar).toBe("x");
  });

  it("deletes an agent", () => {
    createAgent("a8", "Doomed", "", "");
    deleteAgent("a8");
    expect(getAgent("a8")).toBeUndefined();
  });
});
