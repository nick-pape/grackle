import { describe, it, expect, vi, afterEach } from "vitest";
import { resolve } from "node:path";

vi.mock("./logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}));

import {
  sanitizeBranch,
  worktreeDir,
  ensureWorktree,
  removeWorktree,
} from "./worktree.js";
import type { GitExecutor, WorktreeFileSystem } from "./worktree.js";

describe("sanitizeBranch", () => {
  it("preserves alphanumeric characters", () => {
    expect(sanitizeBranch("feature123")).toBe("feature123");
  });

  it("preserves slashes", () => {
    expect(sanitizeBranch("feature/my-branch")).toBe("feature/my-branch");
  });

  it("preserves hyphens and underscores", () => {
    expect(sanitizeBranch("my-branch_v2")).toBe("my-branch_v2");
  });

  it("replaces special characters with hyphens", () => {
    expect(sanitizeBranch("branch@name!#$%")).toBe("branch-name----");
  });

  it("replaces spaces with hyphens", () => {
    expect(sanitizeBranch("my branch name")).toBe("my-branch-name");
  });

  it("handles dots", () => {
    expect(sanitizeBranch("release.1.0")).toBe("release-1-0");
  });
});

describe("worktreeDir", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates .grackle-worktrees/<sanitized-branch> under parent", () => {
    const result = worktreeDir("/home/user/repo", "feature/test");
    // branch slashes are replaced with hyphens
    expect(result).toBe(resolve("/home/user", ".grackle-worktrees", "feature-test"));
  });

  it("replaces slashes in branch name with hyphens", () => {
    const result = worktreeDir("/home/user/myrepo", "fix/bug/123");
    expect(result).toBe(resolve("/home/user", ".grackle-worktrees", "fix-bug-123"));
  });

  it("falls back to $HOME when parent is root", () => {
    vi.stubEnv("HOME", "/home/testuser");
    const result = worktreeDir("/workspace", "main");
    expect(result).toBe(resolve("/home/testuser", ".grackle-worktrees", "main"));
  });

  it("uses basePath itself when parent is root and HOME is not set", () => {
    vi.stubEnv("HOME", "");
    vi.stubEnv("USERPROFILE", "");
    const result = worktreeDir("/workspace", "main");
    // Falls through to basePath when HOME and USERPROFILE are empty
    expect(result).toBe(resolve("/workspace", ".grackle-worktrees", "main"));
  });
});

// ─── Fake GitExecutor helper ──────────────────────────────────────────────

/** Create a fake GitExecutor that returns canned responses keyed by the first git arg. */
function createFakeGitExecutor(
  responses: Record<string, { stdout?: string; error?: Error }>,
): GitExecutor & { calls: Array<{ args: string[]; cwd: string }> } {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  return {
    calls,
    async exec(args, options) {
      calls.push({ args, cwd: options.cwd });
      const key = args[0];
      const resp = responses[key];
      if (resp?.error) {
        throw resp.error;
      }
      return { stdout: resp?.stdout ?? "", stderr: "" };
    },
  };
}

/** Create a fake WorktreeFileSystem. */
function createFakeFileSystem(exists: boolean = false): WorktreeFileSystem {
  return { existsSync: () => exists };
}

// ─── ensureWorktree tests ─────────────────────────────────────────────────

describe("ensureWorktree", () => {
  it("calls git fetch origin before git worktree add", async () => {
    const git = createFakeGitExecutor({
      "rev-parse": { stdout: ".git" },
      "status": { stdout: "" },
      "fetch": { stdout: "" },
      "symbolic-ref": { stdout: "refs/remotes/origin/main\n" },
      "worktree": { stdout: "" },
    });

    await ensureWorktree("/repo", "feature/test", git, createFakeFileSystem());

    const subcommands = git.calls.map((c) => c.args[0]);
    const fetchIdx = subcommands.indexOf("fetch");
    const wtIdx = subcommands.indexOf("worktree");
    expect(fetchIdx).toBeGreaterThanOrEqual(0);
    expect(wtIdx).toBeGreaterThan(fetchIdx);
  });

  it("includes origin/main as start point and returns synced: true", async () => {
    const git = createFakeGitExecutor({
      "rev-parse": { stdout: ".git" },
      "status": { stdout: "" },
      "fetch": { stdout: "" },
      "symbolic-ref": { stdout: "refs/remotes/origin/main\n" },
      "worktree": { stdout: "" },
    });

    const result = await ensureWorktree("/repo", "feature/sync", git, createFakeFileSystem());

    expect(result.synced).toBe(true);
    expect(result.created).toBe(true);

    // Find the worktree add call and verify it includes origin/main
    const worktreeCall = git.calls.find((c) => c.args[0] === "worktree");
    expect(worktreeCall).toBeDefined();
    expect(worktreeCall!.args).toContain("origin/main");
  });

  it("still creates worktree when fetch fails, with synced: false", async () => {
    const git = createFakeGitExecutor({
      "rev-parse": { stdout: ".git" },
      "status": { stdout: "" },
      "fetch": { error: new Error("network error") },
      "worktree": { stdout: "" },
    });

    const result = await ensureWorktree("/repo", "feature/offline", git, createFakeFileSystem());

    expect(result.synced).toBe(false);
    expect(result.created).toBe(true);

    // worktree add should NOT include origin/main when fetch failed
    const worktreeCall = git.calls.find((c) => c.args[0] === "worktree");
    expect(worktreeCall).toBeDefined();
    expect(worktreeCall!.args).not.toContain("origin/main");
  });

  it("returns created: false and synced: false for existing worktree without fetching", async () => {
    const git = createFakeGitExecutor({
      "rev-parse": { stdout: ".git" },
      "status": { stdout: "" },
    });

    const result = await ensureWorktree("/repo", "feature/exists", git, createFakeFileSystem(true));

    expect(result.created).toBe(false);
    expect(result.synced).toBe(false);

    // Verify fetch was never called
    const fetchCall = git.calls.find((c) => c.args[0] === "fetch");
    expect(fetchCall).toBeUndefined();
  });

  it("falls back to origin/main when symbolic-ref fails", async () => {
    const git = createFakeGitExecutor({
      "rev-parse": { stdout: ".git" },
      "status": { stdout: "" },
      "fetch": { stdout: "" },
      "symbolic-ref": { error: new Error("no symbolic ref") },
      "worktree": { stdout: "" },
    });

    const result = await ensureWorktree("/repo", "feature/fallback", git, createFakeFileSystem());

    expect(result.synced).toBe(true);

    // Should still use origin/main as the start point
    const worktreeCall = git.calls.find((c) => c.args[0] === "worktree");
    expect(worktreeCall).toBeDefined();
    expect(worktreeCall!.args).toContain("origin/main");
  });
});

// ─── removeWorktree tests ─────────────────────────────────────────────────

describe("removeWorktree", () => {
  it("calls git worktree remove with correct args", async () => {
    const git = createFakeGitExecutor({
      "worktree": { stdout: "" },
    });

    await removeWorktree("/repo", "feature/done", git);

    expect(git.calls).toHaveLength(1);
    const call = git.calls[0];
    expect(call.args[0]).toBe("worktree");
    expect(call.args[1]).toBe("remove");
    expect(call.args).toContain("--force");
    expect(call.cwd).toBe("/repo");
    // The worktree path should contain the sanitized branch name
    expect(call.args[2]).toContain("feature-done");
  });

  it("does not throw when git worktree remove fails", async () => {
    const git = createFakeGitExecutor({
      "worktree": { error: new Error("not a worktree") },
    });

    // Should not throw
    await expect(removeWorktree("/repo", "feature/gone", git)).resolves.toBeUndefined();
  });
});
