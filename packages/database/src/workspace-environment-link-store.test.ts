import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

// Import modules AFTER mock is set up
import * as linkStore from "./workspace-environment-link-store.js";
import { sqlite } from "./test-db.js";

/** Apply the schema DDL to the in-memory database. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS environments (
      id            TEXT PRIMARY KEY,
      display_name  TEXT NOT NULL,
      adapter_type  TEXT NOT NULL,
      adapter_config TEXT NOT NULL,
      default_runtime TEXT NOT NULL DEFAULT 'claude-code',
      bootstrapped  INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'disconnected',
      last_seen     TEXT,
      env_info      TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      powerline_token TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      description       TEXT NOT NULL DEFAULT '',
      repo_url          TEXT NOT NULL DEFAULT '',
      environment_id    TEXT NOT NULL DEFAULT '' REFERENCES environments(id),
      status            TEXT NOT NULL DEFAULT 'active',
      use_worktrees     INTEGER NOT NULL DEFAULT 1,
      working_directory TEXT NOT NULL DEFAULT '',
      default_persona_id TEXT NOT NULL DEFAULT '',
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspace_environment_links (
      workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
      environment_id  TEXT NOT NULL REFERENCES environments(id),
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (workspace_id, environment_id)
    );

    INSERT OR IGNORE INTO environments (id, display_name, adapter_type, adapter_config)
      VALUES ('env-1', 'Env 1', 'local', '{}');
    INSERT OR IGNORE INTO environments (id, display_name, adapter_type, adapter_config)
      VALUES ('env-2', 'Env 2', 'docker', '{}');
    INSERT OR IGNORE INTO environments (id, display_name, adapter_type, adapter_config)
      VALUES ('env-3', 'Env 3', 'codespace', '{}');

    INSERT OR IGNORE INTO workspaces (id, name, environment_id)
      VALUES ('ws-1', 'Workspace 1', 'env-1');
    INSERT OR IGNORE INTO workspaces (id, name, environment_id)
      VALUES ('ws-2', 'Workspace 2', 'env-2');
  `);
}

describe("workspace-environment-link-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS workspace_environment_links");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    sqlite.exec("DROP TABLE IF EXISTS environments");
    applySchema();
  });

  describe("linkEnvironment", () => {
    it("creates a link between workspace and environment", () => {
      linkStore.linkEnvironment("ws-1", "env-2");
      const linked = linkStore.getLinkedEnvironmentIds("ws-1");
      expect(linked).toEqual(["env-2"]);
    });

    it("allows multiple environments linked to one workspace", () => {
      linkStore.linkEnvironment("ws-1", "env-2");
      linkStore.linkEnvironment("ws-1", "env-3");
      const linked = linkStore.getLinkedEnvironmentIds("ws-1");
      expect(linked).toHaveLength(2);
      expect(linked).toContain("env-2");
      expect(linked).toContain("env-3");
    });

    it("throws on duplicate link", () => {
      linkStore.linkEnvironment("ws-1", "env-2");
      expect(() => linkStore.linkEnvironment("ws-1", "env-2")).toThrow();
    });
  });

  describe("unlinkEnvironment", () => {
    it("removes an existing link", () => {
      linkStore.linkEnvironment("ws-1", "env-2");
      linkStore.unlinkEnvironment("ws-1", "env-2");
      const linked = linkStore.getLinkedEnvironmentIds("ws-1");
      expect(linked).toEqual([]);
    });

    it("is a no-op for non-existent link", () => {
      // Should not throw
      linkStore.unlinkEnvironment("ws-1", "env-3");
      const linked = linkStore.getLinkedEnvironmentIds("ws-1");
      expect(linked).toEqual([]);
    });

    it("only removes the specified link, leaving others intact", () => {
      linkStore.linkEnvironment("ws-1", "env-2");
      linkStore.linkEnvironment("ws-1", "env-3");
      linkStore.unlinkEnvironment("ws-1", "env-2");
      const linked = linkStore.getLinkedEnvironmentIds("ws-1");
      expect(linked).toEqual(["env-3"]);
    });
  });

  describe("getLinkedEnvironmentIds", () => {
    it("returns empty array when no links exist", () => {
      const linked = linkStore.getLinkedEnvironmentIds("ws-1");
      expect(linked).toEqual([]);
    });

    it("returns only linked env IDs, not the primary", () => {
      linkStore.linkEnvironment("ws-1", "env-2");
      const linked = linkStore.getLinkedEnvironmentIds("ws-1");
      // env-1 is the primary — should not appear
      expect(linked).not.toContain("env-1");
      expect(linked).toEqual(["env-2"]);
    });
  });

  describe("getWorkspaceIdsLinkedToEnvironment", () => {
    it("returns workspace IDs linked to an environment", () => {
      linkStore.linkEnvironment("ws-1", "env-3");
      linkStore.linkEnvironment("ws-2", "env-3");
      const workspaces = linkStore.getWorkspaceIdsLinkedToEnvironment("env-3");
      expect(workspaces).toHaveLength(2);
      expect(workspaces).toContain("ws-1");
      expect(workspaces).toContain("ws-2");
    });

    it("returns empty array when no workspaces are linked", () => {
      const workspaces = linkStore.getWorkspaceIdsLinkedToEnvironment("env-3");
      expect(workspaces).toEqual([]);
    });
  });

  describe("isLinked", () => {
    it("returns true when link exists", () => {
      linkStore.linkEnvironment("ws-1", "env-2");
      expect(linkStore.isLinked("ws-1", "env-2")).toBe(true);
    });

    it("returns false when link does not exist", () => {
      expect(linkStore.isLinked("ws-1", "env-2")).toBe(false);
    });
  });

  describe("countLinksForEnvironment", () => {
    it("returns correct count", () => {
      linkStore.linkEnvironment("ws-1", "env-3");
      linkStore.linkEnvironment("ws-2", "env-3");
      expect(linkStore.countLinksForEnvironment("env-3")).toBe(2);
    });

    it("returns 0 when no links exist", () => {
      expect(linkStore.countLinksForEnvironment("env-3")).toBe(0);
    });
  });

  describe("deleteLinksForEnvironment", () => {
    it("removes all links for an environment", () => {
      linkStore.linkEnvironment("ws-1", "env-3");
      linkStore.linkEnvironment("ws-2", "env-3");
      linkStore.deleteLinksForEnvironment("env-3");
      expect(linkStore.getWorkspaceIdsLinkedToEnvironment("env-3")).toEqual([]);
    });

    it("does not affect links to other environments", () => {
      linkStore.linkEnvironment("ws-1", "env-2");
      linkStore.linkEnvironment("ws-1", "env-3");
      linkStore.deleteLinksForEnvironment("env-3");
      expect(linkStore.getLinkedEnvironmentIds("ws-1")).toEqual(["env-2"]);
    });
  });

  describe("deleteLinksForWorkspace", () => {
    it("removes all links for a workspace", () => {
      linkStore.linkEnvironment("ws-1", "env-2");
      linkStore.linkEnvironment("ws-1", "env-3");
      linkStore.deleteLinksForWorkspace("ws-1");
      expect(linkStore.getLinkedEnvironmentIds("ws-1")).toEqual([]);
    });

    it("does not affect links from other workspaces", () => {
      linkStore.linkEnvironment("ws-1", "env-3");
      linkStore.linkEnvironment("ws-2", "env-3");
      linkStore.deleteLinksForWorkspace("ws-1");
      expect(linkStore.getWorkspaceIdsLinkedToEnvironment("env-3")).toEqual(["ws-2"]);
    });
  });
});
