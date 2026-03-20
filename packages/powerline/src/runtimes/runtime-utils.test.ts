import { describe, it, expect, vi, afterEach } from "vitest";

// Keep module mocks only for true cross-module boundaries
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
  readdirSync: vi.fn(() => []),
}));
vi.mock("../worktree.js", () => ({
  ensureWorktree: vi.fn(),
}));

import {
  resolveWorkingDirectory,
  findGitRepoPath,
  resolveMcpServers,
} from "./runtime-utils.js";
import type { GitRepository, WorkspaceLocator } from "./runtime-utils.js";
import { AsyncQueue } from "../utils/async-queue.js";
import type { AgentEvent } from "./runtime.js";
import { existsSync } from "node:fs";
import { ensureWorktree } from "../worktree.js";

// ─── Fake helpers ──────────────────────────────────────────────────────────

/** Create a fake GitRepository that returns canned responses. */
function createFakeGitRepository(options: {
  repos?: Record<string, string | undefined>;
  checkoutError?: Error;
} = {}): GitRepository & { calls: Array<{ method: string; args: unknown[] }> } {
  const { repos = {}, checkoutError } = options;
  const calls: Array<{ method: string; args: unknown[] }> = [];
  return {
    calls,
    async isRepo(dir: string): Promise<boolean> {
      calls.push({ method: "isRepo", args: [dir] });
      return dir in repos;
    },
    async toplevel(dir: string): Promise<string | undefined> {
      calls.push({ method: "toplevel", args: [dir] });
      return repos[dir];
    },
    async checkoutBranch(repoPath: string, branch: string): Promise<void> {
      calls.push({ method: "checkoutBranch", args: [repoPath, branch] });
      if (checkoutError) {
        throw checkoutError;
      }
    },
  };
}

/** Create a fake WorkspaceLocator with configurable paths and directory contents. */
function createFakeWorkspaceLocator(
  existingPaths: Set<string>,
  directoryContents: Record<string, string[]> = {},
): WorkspaceLocator {
  return {
    exists(path: string): boolean {
      return existingPaths.has(path);
    },
    readDirectory(path: string): string[] {
      return directoryContents[path] ?? [];
    },
  };
}

// ─── findGitRepoPath tests ────────────────────────────────────────────────

describe("findGitRepoPath", () => {
  it("returns resolved toplevel when basePath exists and is a git repo", async () => {
    const git = createFakeGitRepository({ repos: { "/repo": "/repo" } });
    const locator = createFakeWorkspaceLocator(new Set(["/repo"]));

    expect(await findGitRepoPath("/repo", git, locator)).toBe("/repo");
  });

  it("falls back to /workspace when basePath is not a git repo", async () => {
    const git = createFakeGitRepository({ repos: { "/workspace": "/workspace" } });
    const locator = createFakeWorkspaceLocator(new Set(["/repo", "/workspace"]));

    expect(await findGitRepoPath("/repo", git, locator)).toBe("/workspace");
  });

  it("finds repo under /workspaces/ (Codespaces convention)", async () => {
    const git = createFakeGitRepository({ repos: { "/workspaces/grackle": "/workspaces/grackle" } });
    const locator = createFakeWorkspaceLocator(
      new Set(["/workspaces", "/workspaces/grackle"]),
      { "/workspaces": ["grackle"] },
    );

    expect(await findGitRepoPath("/workspace", git, locator)).toBe("/workspaces/grackle");
  });

  it("returns undefined when nothing is found", async () => {
    const git = createFakeGitRepository();
    const locator = createFakeWorkspaceLocator(new Set());

    expect(await findGitRepoPath("/nonexistent", git, locator)).toBeUndefined();
  });

  it("returns basePath itself when toplevel returns undefined", async () => {
    const git = createFakeGitRepository({ repos: { "/repo": undefined } });
    const locator = createFakeWorkspaceLocator(new Set(["/repo"]));

    expect(await findGitRepoPath("/repo", git, locator)).toBe("/repo");
  });

  it("skips basePath when it does not exist on disk", async () => {
    const git = createFakeGitRepository({ repos: { "/workspace": "/workspace" } });
    const locator = createFakeWorkspaceLocator(new Set(["/workspace"]));

    expect(await findGitRepoPath("/nonexistent", git, locator)).toBe("/workspace");
  });
});

// ─── resolveWorkingDirectory tests ────────────────────────────────────────

describe("resolveWorkingDirectory", () => {
  afterEach(() => {
    vi.mocked(ensureWorktree).mockReset();
  });

  it("returns worktree path when branch and basePath are provided", async () => {
    const git = createFakeGitRepository({ repos: { "/repo": "/repo" } });
    const locator = createFakeWorkspaceLocator(new Set(["/repo"]));
    vi.mocked(ensureWorktree).mockResolvedValue({
      worktreePath: "/worktrees/my-branch",
      branch: "my-branch",
      created: true,
      synced: false,
    });
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "my-branch",
      worktreeBasePath: "/repo",
      useWorktrees: true,
      eventQueue: queue,
      git,
      locator,
    });

    expect(result).toBe("/worktrees/my-branch");
    const event = await queue.shift();
    expect(event?.type).toBe("system");
    expect(event?.content).toContain("Worktree ready");
    queue.close();
  });

  it("falls back to workspace directory when worktree fails", async () => {
    const git = createFakeGitRepository({ repos: { "/repo": "/repo" } });
    const locator = createFakeWorkspaceLocator(new Set(["/repo", "/workspace"]));
    vi.mocked(ensureWorktree).mockRejectedValue(new Error("git error"));
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "my-branch",
      worktreeBasePath: "/repo",
      useWorktrees: true,
      eventQueue: queue,
      git,
      locator,
    });

    expect(result).toBe("/repo");
    const event = await queue.shift();
    expect(event?.type).toBe("system");
    expect(event?.content).toContain("Worktree setup failed");
    queue.close();
  });

  it("returns undefined when worktree fails and no workspace exists", async () => {
    const git = createFakeGitRepository();
    const locator = createFakeWorkspaceLocator(new Set());
    vi.mocked(ensureWorktree).mockRejectedValue(new Error("git error"));
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "my-branch",
      worktreeBasePath: "/repo",
      useWorktrees: true,
      eventQueue: queue,
      git,
      locator,
    });

    expect(result).toBeUndefined();
    queue.close();
  });

  it("returns /workspace when no branch is provided", async () => {
    const git = createFakeGitRepository();
    const locator = createFakeWorkspaceLocator(new Set(["/workspace"]));
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      eventQueue: queue,
      git,
      locator,
    });

    expect(result).toBe("/workspace");
    queue.close();
  });

  it("returns undefined when /workspace does not exist and no branch", async () => {
    const git = createFakeGitRepository();
    const locator = createFakeWorkspaceLocator(new Set());
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      eventQueue: queue,
      git,
      locator,
    });

    expect(result).toBeUndefined();
    queue.close();
  });

  it("returns undefined when requireNonEmpty is true and /workspace is empty", async () => {
    const git = createFakeGitRepository();
    const locator = createFakeWorkspaceLocator(new Set(["/workspace"]), { "/workspace": [] });
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      eventQueue: queue,
      requireNonEmpty: true,
      git,
      locator,
    });

    expect(result).toBeUndefined();
    queue.close();
  });

  it("returns /workspace when requireNonEmpty is true and /workspace has files", async () => {
    const git = createFakeGitRepository();
    const locator = createFakeWorkspaceLocator(new Set(["/workspace"]), { "/workspace": ["README.md"] });
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      eventQueue: queue,
      requireNonEmpty: true,
      git,
      locator,
    });

    expect(result).toBe("/workspace");
    queue.close();
  });

  it("returns /workspace without checking emptiness when requireNonEmpty is false", async () => {
    const git = createFakeGitRepository();
    const locator = createFakeWorkspaceLocator(new Set(["/workspace"]), { "/workspace": [] });
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      eventQueue: queue,
      requireNonEmpty: false,
      git,
      locator,
    });

    expect(result).toBe("/workspace");
    queue.close();
  });

  it("checks out branch in main working tree when useWorktrees is false", async () => {
    const git = createFakeGitRepository({ repos: { "/workspace": "/workspace" } });
    const locator = createFakeWorkspaceLocator(new Set(["/workspace"]));
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "feature/my-branch",
      worktreeBasePath: "",
      useWorktrees: false,
      eventQueue: queue,
      git,
      locator,
    });

    expect(result).toBe("/workspace");
    const event = await queue.shift();
    expect(event?.type).toBe("system");
    expect(event?.content).toContain("Checked out branch");
    expect(event?.content).toContain("feature/my-branch");
    expect(ensureWorktree).not.toHaveBeenCalled();
    expect(git.calls).toContainEqual({ method: "checkoutBranch", args: ["/workspace", "feature/my-branch"] });
    queue.close();
  });

  it("falls back to workspace when branch checkout fails and worktreeBasePath is empty", async () => {
    const git = createFakeGitRepository({
      repos: { "/workspace": "/workspace" },
      checkoutError: new Error("checkout failed"),
    });
    const locator = createFakeWorkspaceLocator(new Set(["/workspace"]));
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "feature/bad-branch",
      worktreeBasePath: "",
      useWorktrees: false,
      eventQueue: queue,
      git,
      locator,
    });

    expect(result).toBe("/workspace");
    const event = await queue.shift();
    expect(event?.type).toBe("system");
    expect(event?.content).toContain("Branch checkout failed");
    queue.close();
  });

  it("returns undefined when branch checkout fails and no workspace exists (worktreeBasePath empty)", async () => {
    const git = createFakeGitRepository({ checkoutError: new Error("checkout failed") });
    const locator = createFakeWorkspaceLocator(new Set());
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "feature/bad-branch",
      worktreeBasePath: "",
      useWorktrees: false,
      eventQueue: queue,
      git,
      locator,
    });

    expect(result).toBeUndefined();
    queue.close();
  });

  it("creates worktree when both branch and worktreeBasePath are set (existing behavior preserved)", async () => {
    const git = createFakeGitRepository({ repos: { "/repo": "/repo" } });
    const locator = createFakeWorkspaceLocator(new Set(["/repo"]));
    vi.mocked(ensureWorktree).mockResolvedValue({
      worktreePath: "/worktrees/my-branch",
      branch: "my-branch",
      created: true,
      synced: false,
    });
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "my-branch",
      worktreeBasePath: "/repo",
      useWorktrees: true,
      eventQueue: queue,
      git,
      locator,
    });

    expect(result).toBe("/worktrees/my-branch");
    expect(ensureWorktree).toHaveBeenCalled();
    queue.close();
  });

  it("emits no-repo event when git repo is not found and worktrees disabled", async () => {
    const git = createFakeGitRepository();
    const locator = createFakeWorkspaceLocator(new Set());
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "feature/test",
      useWorktrees: false,
      eventQueue: queue,
      git,
      locator,
    });

    expect(result).toBeUndefined();
    const event = await queue.shift();
    expect(event?.content).toContain("No git repo found");
    expect(event?.content).toContain("branch checkout");
    queue.close();
  });
});

// ─── resolveMcpServers tests ──────────────────────────────────────────────

describe("resolveMcpServers", () => {
  afterEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.unstubAllEnvs();
  });

  it("injects HTTP broker entry when brokerConfig is provided", () => {
    const result = resolveMcpServers(undefined, {
      url: "http://127.0.0.1:54321/mcp",
      token: "test-token",
    });

    expect(result.servers).toBeDefined();
    const grackle = result.servers!.grackle as Record<string, unknown>;
    expect(grackle.type).toBe("http");
    expect(grackle.url).toBe("http://127.0.0.1:54321/mcp");
    expect(grackle.headers).toEqual({ Authorization: "Bearer test-token" });
  });

  it("does not inject grackle entry when no brokerConfig is provided", () => {
    const result = resolveMcpServers();
    expect(result.servers).toBeUndefined();
  });

  it("does not overwrite existing grackle entry from spawn config", () => {
    const result = resolveMcpServers(
      { grackle: { command: "custom", args: [] } },
      { url: "http://broker/mcp", token: "t" },
    );
    const grackle = result.servers!.grackle as Record<string, unknown>;
    expect(grackle.command).toBe("custom");
    expect(grackle.url).toBeUndefined();
  });

  it("merges persona MCP servers alongside broker config", () => {
    const result = resolveMcpServers(
      { custom: { command: "other", args: [] } },
      { url: "http://broker/mcp", token: "t" },
    );
    expect(result.servers!.custom).toBeDefined();
    expect(result.servers!.grackle).toBeDefined();
  });
});
