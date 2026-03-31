import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// Import modules AFTER mock is set up
import * as pluginStore from "./plugin-store.js";
import { sqlite } from "./test-db.js";

/** Apply the schema DDL to the in-memory database. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS plugins (
      name       TEXT PRIMARY KEY,
      enabled    INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

describe("plugin-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS plugins");
    applySchema();
  });

  describe("getPluginEnabled", () => {
    it("returns undefined when no row exists", () => {
      expect(pluginStore.getPluginEnabled("orchestration")).toBeUndefined();
    });

    it("returns true when enabled=1", () => {
      sqlite.exec("INSERT INTO plugins (name, enabled) VALUES ('orchestration', 1)");
      expect(pluginStore.getPluginEnabled("orchestration")).toBe(true);
    });

    it("returns false when enabled=0", () => {
      sqlite.exec("INSERT INTO plugins (name, enabled) VALUES ('orchestration', 0)");
      expect(pluginStore.getPluginEnabled("orchestration")).toBe(false);
    });
  });

  describe("setPluginEnabled", () => {
    it("inserts a new row", () => {
      pluginStore.setPluginEnabled("orchestration", true);
      expect(pluginStore.getPluginEnabled("orchestration")).toBe(true);
    });

    it("upserts — updates existing row", () => {
      pluginStore.setPluginEnabled("orchestration", true);
      pluginStore.setPluginEnabled("orchestration", false);
      expect(pluginStore.getPluginEnabled("orchestration")).toBe(false);
    });

    it("sets updated_at to a non-empty string", () => {
      pluginStore.setPluginEnabled("orchestration", true);
      const row = sqlite.prepare("SELECT updated_at FROM plugins WHERE name = 'orchestration'").get() as { updated_at: string };
      expect(row.updated_at).toBeTruthy();
    });
  });

  describe("listPlugins", () => {
    it("returns empty array when no rows", () => {
      expect(pluginStore.listPlugins()).toEqual([]);
    });

    it("returns all rows", () => {
      pluginStore.setPluginEnabled("orchestration", true);
      pluginStore.setPluginEnabled("scheduling", false);
      const rows = pluginStore.listPlugins();
      expect(rows).toHaveLength(2);
      const names = rows.map((r) => r.name);
      expect(names).toContain("orchestration");
      expect(names).toContain("scheduling");
    });
  });

  describe("getPlugin", () => {
    it("returns undefined when no row exists", () => {
      expect(pluginStore.getPlugin("orchestration")).toBeUndefined();
    });

    it("returns the row when it exists", () => {
      pluginStore.setPluginEnabled("orchestration", true);
      const row = pluginStore.getPlugin("orchestration");
      expect(row).toBeDefined();
      expect(row!.name).toBe("orchestration");
      expect(row!.enabled).toBe(true);
    });
  });
});
