import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { sanitizeBranch, worktreeDir } from "./worktree.js";
import { resolve } from "node:path";
import type { execFile as execFileType } from "node:child_process";

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

// ─── ensureWorktree tests (mocked child_process + fs) ────────────────────

// Use a separate vi.mock block to intercept the modules that ensureWorktree imports.
// The callback-based mock pattern matches how `promisify(execFile)` works at runtime:
// promisify wraps the 4-arg callback form into a promise.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      cb(null, { stdout: "", stderr: "" });
    },
  ),
}));
vi.mock("node:fs", () => ({ existsSync: vi.fn(() => false) }));
vi.mock("./logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}));

// Dynamic imports so the mocks are in place before the module executes.
const { execFile } = await import("node:child_process");
const { existsSync } = await import("node:fs");
const { ensureWorktree } = await import("./worktree.js");

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;

/** Helper: build a callback-based mock implementation for execFile. */
type ExecCallback = (err: Error | null, result: { stdout: string; stderr: string }) => void;

function mockExecResponses(
  responses: Record<string, { stdout?: string; stderr?: string; error?: Error }>,
): void {
  mockExecFile.mockImplementation(
    (_cmd: string, args: string[], _opts: unknown, cb: ExecCallback) => {
      // Use the first git subcommand as the key (e.g. "fetch", "worktree", "symbolic-ref")
      const key = (args as string[])[0] ?? "";
      const resp = responses[key];
      if (resp?.error) {
        cb(resp.error, { stdout: "", stderr: "" });
      } else {
        cb(null, { stdout: resp?.stdout ?? "", stderr: resp?.stderr ?? "" });
      }
    },
  );
}

describe("ensureWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it("calls git fetch origin before git worktree add", async () => {
    const callOrder: string[] = [];
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb: ExecCallback) => {
        const sub = (args as string[])[0] ?? "";
        callOrder.push(sub);
        if (sub === "symbolic-ref") {
          cb(null, { stdout: "refs/remotes/origin/main\n", stderr: "" });
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    await ensureWorktree("/repo", "feature/test");

    // fetch must appear before worktree
    const fetchIdx = callOrder.indexOf("fetch");
    const wtIdx = callOrder.indexOf("worktree");
    expect(fetchIdx).toBeGreaterThanOrEqual(0);
    expect(wtIdx).toBeGreaterThan(fetchIdx);
  });

  it("includes origin/main as start point and returns synced: true", async () => {
    mockExecResponses({
      "rev-parse": { stdout: ".git" },
      "status": { stdout: "" },
      "fetch": { stdout: "" },
      "symbolic-ref": { stdout: "refs/remotes/origin/main\n" },
      "worktree": { stdout: "" },
    });

    const result = await ensureWorktree("/repo", "feature/sync");

    expect(result.synced).toBe(true);
    expect(result.created).toBe(true);

    // Find the worktree add call and verify it includes origin/main
    const worktreeCall = mockExecFile.mock.calls.find(
      (c: Parameters<typeof execFileType>) => (c[1] as string[])[0] === "worktree",
    );
    expect(worktreeCall).toBeDefined();
    const worktreeArgs = worktreeCall![1] as string[];
    expect(worktreeArgs).toContain("origin/main");
  });

  it("still creates worktree when fetch fails, with synced: false", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb: ExecCallback) => {
        const sub = (args as string[])[0] ?? "";
        if (sub === "fetch") {
          cb(new Error("network error"), { stdout: "", stderr: "" });
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    const result = await ensureWorktree("/repo", "feature/offline");

    expect(result.synced).toBe(false);
    expect(result.created).toBe(true);

    // worktree add should NOT include origin/main when fetch failed
    const worktreeCall = mockExecFile.mock.calls.find(
      (c: Parameters<typeof execFileType>) => (c[1] as string[])[0] === "worktree",
    );
    expect(worktreeCall).toBeDefined();
    const worktreeArgs = worktreeCall![1] as string[];
    expect(worktreeArgs).not.toContain("origin/main");
  });

  it("returns created: false and synced: false for existing worktree without fetching", async () => {
    mockExistsSync.mockReturnValue(true);

    // rev-parse and status succeed, but fetch should NOT be called
    mockExecResponses({
      "rev-parse": { stdout: ".git" },
      "status": { stdout: "" },
    });

    const result = await ensureWorktree("/repo", "feature/exists");

    expect(result.created).toBe(false);
    expect(result.synced).toBe(false);

    // Verify fetch was never called
    const fetchCall = mockExecFile.mock.calls.find(
      (c: Parameters<typeof execFileType>) => (c[1] as string[])[0] === "fetch",
    );
    expect(fetchCall).toBeUndefined();
  });

  it("falls back to origin/main when symbolic-ref fails", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb: ExecCallback) => {
        const sub = (args as string[])[0] ?? "";
        if (sub === "symbolic-ref") {
          cb(new Error("no symbolic ref"), { stdout: "", stderr: "" });
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    const result = await ensureWorktree("/repo", "feature/fallback");

    expect(result.synced).toBe(true);

    // Should still use origin/main as the start point
    const worktreeCall = mockExecFile.mock.calls.find(
      (c: Parameters<typeof execFileType>) => (c[1] as string[])[0] === "worktree",
    );
    expect(worktreeCall).toBeDefined();
    const worktreeArgs = worktreeCall![1] as string[];
    expect(worktreeArgs).toContain("origin/main");
  });
});
