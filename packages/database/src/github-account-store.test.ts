import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// Import modules AFTER mock is set up
import * as store from "./github-account-store.js";
import { sqlite } from "./test-db.js";

/** Apply the github_accounts table schema. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS github_accounts (
      id         TEXT PRIMARY KEY,
      label      TEXT NOT NULL UNIQUE,
      username   TEXT NOT NULL,
      token      TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

describe("github-account-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS github_accounts");
    applySchema();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ─── Basic CRUD ───────────────────────────────────────────────────────────

  it("adds and retrieves an account with decrypted token", () => {
    const id = store.addGitHubAccount("personal", "alice", "ghp_secrettoken", false);
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    const account = store.getGitHubAccount(id);
    expect(account).toBeDefined();
    expect(account!.label).toBe("personal");
    expect(account!.username).toBe("alice");
    expect(account!.token).toBe("ghp_secrettoken");
    expect(account!.isDefault).toBe(false);
    expect(account!.createdAt).toBeTruthy();
  });

  it("returns undefined for a missing account", () => {
    expect(store.getGitHubAccount("does-not-exist")).toBeUndefined();
  });

  it("lists all accounts without exposing tokens", () => {
    store.addGitHubAccount("work", "bob", "ghp_worktoken", false);
    store.addGitHubAccount("personal", "alice", "ghp_personaltoken", false);

    const list = store.listGitHubAccounts();
    expect(list).toHaveLength(2);
    for (const item of list) {
      expect(item).not.toHaveProperty("token");
    }
    const labels = list.map((a) => a.label).sort();
    expect(labels).toEqual(["personal", "work"]);
  });

  it("returns empty list when no accounts exist", () => {
    expect(store.listGitHubAccounts()).toHaveLength(0);
  });

  it("removes an account", () => {
    const id = store.addGitHubAccount("personal", "alice", "ghp_token", false);
    expect(store.getGitHubAccount(id)).toBeDefined();
    store.removeGitHubAccount(id);
    expect(store.getGitHubAccount(id)).toBeUndefined();
  });

  it("removing a non-existent account is a no-op", () => {
    expect(() => store.removeGitHubAccount("ghost")).not.toThrow();
  });

  it("updates label, username, and token", () => {
    const id = store.addGitHubAccount("old-label", "olduser", "ghp_old", false);
    store.updateGitHubAccount(id, { label: "new-label", username: "newuser", token: "ghp_new" });

    const updated = store.getGitHubAccount(id);
    expect(updated!.label).toBe("new-label");
    expect(updated!.username).toBe("newuser");
    expect(updated!.token).toBe("ghp_new");
  });

  it("update with no fields is a no-op", () => {
    const id = store.addGitHubAccount("stable", "alice", "ghp_token", false);
    expect(() => store.updateGitHubAccount(id, {})).not.toThrow();
    expect(store.getGitHubAccount(id)!.label).toBe("stable");
  });

  // ─── Default account logic ────────────────────────────────────────────────

  it("marks an account as default at creation", () => {
    const id = store.addGitHubAccount("work", "bob", "ghp_work", true);
    const account = store.getGitHubAccount(id);
    expect(account!.isDefault).toBe(true);

    const def = store.getDefaultGitHubAccount();
    expect(def).toBeDefined();
    expect(def!.id).toBe(id);
    expect(def!.token).toBe("ghp_work");
  });

  it("adding a second default clears the first", () => {
    const id1 = store.addGitHubAccount("personal", "alice", "ghp_a", true);
    const id2 = store.addGitHubAccount("work", "bob", "ghp_b", true);

    expect(store.getGitHubAccount(id1)!.isDefault).toBe(false);
    expect(store.getGitHubAccount(id2)!.isDefault).toBe(true);
    expect(store.getDefaultGitHubAccount()!.id).toBe(id2);
  });

  it("updating isDefault clears any prior default", () => {
    const id1 = store.addGitHubAccount("personal", "alice", "ghp_a", true);
    const id2 = store.addGitHubAccount("work", "bob", "ghp_b", false);

    store.updateGitHubAccount(id2, { isDefault: true });

    expect(store.getGitHubAccount(id1)!.isDefault).toBe(false);
    expect(store.getGitHubAccount(id2)!.isDefault).toBe(true);
  });

  it("getDefaultGitHubAccount returns undefined when no default is set", () => {
    store.addGitHubAccount("personal", "alice", "ghp_a", false);
    expect(store.getDefaultGitHubAccount()).toBeUndefined();
  });

  // ─── Lookup helpers ───────────────────────────────────────────────────────

  it("finds an account by label (case-insensitive)", () => {
    store.addGitHubAccount("Personal", "alice", "ghp_token", false);

    expect(store.findGitHubAccountByLabel("personal")).toBeDefined();
    expect(store.findGitHubAccountByLabel("PERSONAL")).toBeDefined();
    expect(store.findGitHubAccountByLabel("work")).toBeUndefined();
  });

  it("finds an account by username", () => {
    store.addGitHubAccount("personal", "alice", "ghp_token", false);

    expect(store.findGitHubAccountByUsername("alice")).toBeDefined();
    expect(store.findGitHubAccountByUsername("bob")).toBeUndefined();
  });

  // ─── resolveStoredGitHubToken fallback chain ──────────────────────────────

  it("resolves token for a specific account ID", () => {
    const id = store.addGitHubAccount("personal", "alice", "ghp_personal", false);
    store.addGitHubAccount("work", "bob", "ghp_work", true);

    expect(store.resolveStoredGitHubToken(id)).toBe("ghp_personal");
  });

  it("falls back to default account when no ID given", () => {
    store.addGitHubAccount("work", "bob", "ghp_work", true);
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");

    expect(store.resolveStoredGitHubToken()).toBe("ghp_work");
  });

  it("falls back to GH_TOKEN env var when no accounts exist", () => {
    vi.stubEnv("GH_TOKEN", "env_gh_token");
    vi.stubEnv("GITHUB_TOKEN", "");

    expect(store.resolveStoredGitHubToken()).toBe("env_gh_token");
  });

  it("falls back to GITHUB_TOKEN when GH_TOKEN is absent", () => {
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "env_github_token");

    expect(store.resolveStoredGitHubToken()).toBe("env_github_token");
  });

  it("returns undefined when no account, no default, and no env vars", () => {
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");

    expect(store.resolveStoredGitHubToken()).toBeUndefined();
  });

  it("specific account ID takes priority over default account", () => {
    const id = store.addGitHubAccount("personal", "alice", "ghp_personal", false);
    store.addGitHubAccount("work", "bob", "ghp_work", true);

    // Even though 'work' is default, we explicitly request 'personal'
    expect(store.resolveStoredGitHubToken(id)).toBe("ghp_personal");
  });

  it("falls back to default when specific account ID is unknown", () => {
    store.addGitHubAccount("work", "bob", "ghp_work", true);

    expect(store.resolveStoredGitHubToken("non-existent-id")).toBe("ghp_work");
  });

  // ─── Token encryption ─────────────────────────────────────────────────────

  it("stored token is encrypted (not stored as plaintext)", () => {
    store.addGitHubAccount("personal", "alice", "ghp_plaintext", false);
    const raw = sqlite.prepare("SELECT token FROM github_accounts WHERE label = ?").get("personal") as { token: string };
    expect(raw.token).not.toBe("ghp_plaintext");
    expect(raw.token.length).toBeGreaterThan(0);
  });
});
