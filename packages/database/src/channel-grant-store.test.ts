import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

import * as channelGrantStore from "./channel-grant-store.js";
import { sqlite } from "./test-db.js";

/** Apply the schema DDL to the in-memory database (mirrors migration v10). */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS channel_grants (
      id           TEXT PRIMARY KEY,
      channel_uri  TEXT NOT NULL,
      verbs        TEXT NOT NULL,
      label        TEXT NOT NULL DEFAULT '',
      expires_at   TEXT,
      revoked      INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

describe("channel-grant-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS channel_grants");
    applySchema();
  });

  it("creates and retrieves a grant", () => {
    channelGrantStore.createGrant("g1", "grackle:/sessions/s1", "send_input", "teams:alice", null);
    const row = channelGrantStore.getGrant("g1");
    expect(row).toBeDefined();
    expect(row!.channelUri).toBe("grackle:/sessions/s1");
    expect(row!.verbs).toBe("send_input");
    expect(row!.label).toBe("teams:alice");
    expect(row!.revoked).toBe(false);
  });

  it("lists all grants", () => {
    channelGrantStore.createGrant("g1", "grackle:/sessions/s1", "send_input", "", null);
    channelGrantStore.createGrant("g2", "grackle:/sessions/s2", "send_input", "", null);
    expect(channelGrantStore.listGrants()).toHaveLength(2);
  });

  it("revokes a grant", () => {
    channelGrantStore.createGrant("g1", "grackle:/sessions/s1", "send_input", "", null);
    channelGrantStore.revokeGrant("g1");
    expect(channelGrantStore.getGrant("g1")!.revoked).toBe(true);
  });

  it("returns undefined for a missing grant", () => {
    expect(channelGrantStore.getGrant("nope")).toBeUndefined();
  });
});
