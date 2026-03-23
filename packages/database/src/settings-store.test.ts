import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// Import modules AFTER mock is set up
import * as settingsStore from "./settings-store.js";
import { sqlite } from "./test-db.js";

/** Apply the schema DDL to the in-memory database. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

describe("settings-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS settings");
    applySchema();
  });

  it("returns undefined for a key that does not exist", () => {
    expect(settingsStore.getSetting("nonexistent_key")).toBeUndefined();
  });

  it("round-trips a value through setSetting and getSetting", () => {
    settingsStore.setSetting("theme", "dark");
    expect(settingsStore.getSetting("theme")).toBe("dark");
  });

  it("overwrites an existing value", () => {
    settingsStore.setSetting("theme", "dark");
    expect(settingsStore.getSetting("theme")).toBe("dark");

    settingsStore.setSetting("theme", "light");
    expect(settingsStore.getSetting("theme")).toBe("light");
  });

  it("stores and retrieves an empty string value", () => {
    settingsStore.setSetting("empty_key", "");
    expect(settingsStore.getSetting("empty_key")).toBe("");
  });
});
