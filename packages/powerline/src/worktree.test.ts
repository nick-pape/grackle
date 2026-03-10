import { describe, it, expect, vi, afterEach } from "vitest";
import { sanitizeBranch, worktreeDir } from "./worktree.js";
import { resolve } from "node:path";

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
