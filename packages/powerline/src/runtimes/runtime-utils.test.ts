import { describe, it, expect, vi, afterEach } from "vitest";

// Mock dependencies before importing
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => "{}"),
  readdirSync: vi.fn(() => []),
}));
// execFile uses the Node.js callback pattern; promisify will append the callback
// as the last argument when called via execFileAsync.
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => { throw new Error("not a git repo"); }),
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout: "", stderr: "" });
  }),
}));
vi.mock("../worktree.js", () => ({
  ensureWorktree: vi.fn(),
}));

import { resolveWorkingDirectory, findGitRepoPath, resolveMcpServers } from "./runtime-utils.js";
import { AsyncQueue } from "../utils/async-queue.js";
import type { AgentEvent } from "./runtime.js";
import { existsSync, readdirSync } from "node:fs";
import { execFileSync, execFile } from "node:child_process";
import { ensureWorktree } from "../worktree.js";

describe("findGitRepoPath", () => {
  afterEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReset();
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(execFileSync).mockReset();
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error("not a git repo"); });
  });

  it("returns resolved toplevel when basePath exists and is a git repo", () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/repo");
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      if (Array.isArray(args) && args.includes("--show-toplevel")) {
        return "/repo\n";
      }
      return Buffer.from(".git\n");
    });
    expect(findGitRepoPath("/repo")).toBe("/repo");
  });

  it("falls back to /workspace when basePath is not a git repo", () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/workspace" || String(p) === "/repo");
    vi.mocked(execFileSync).mockImplementation((_cmd, args, opts) => {
      if ((opts as { cwd: string }).cwd === "/workspace") {
        if (Array.isArray(args) && args.includes("--show-toplevel")) {
          return "/workspace\n";
        }
        return Buffer.from(".git\n");
      }
      throw new Error("not a git repo");
    });
    expect(findGitRepoPath("/repo")).toBe("/workspace");
  });

  it("finds repo under /workspaces/ (Codespaces convention)", () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/workspaces" || String(p) === "/workspaces/grackle");
    vi.mocked(readdirSync).mockImplementation((p) => {
      if (String(p) === "/workspaces") {
        return ["grackle"] as unknown as ReturnType<typeof readdirSync>;
      }
      return [];
    });
    vi.mocked(execFileSync).mockImplementation((_cmd, args, opts) => {
      if ((opts as { cwd: string }).cwd === "/workspaces/grackle") {
        if (Array.isArray(args) && args.includes("--show-toplevel")) {
          return "/workspaces/grackle\n";
        }
        return Buffer.from(".git\n");
      }
      throw new Error("not a git repo");
    });
    expect(findGitRepoPath("/workspace")).toBe("/workspaces/grackle");
  });

  it("returns undefined when nothing is found", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(findGitRepoPath("/nonexistent")).toBeUndefined();
  });
});

describe("resolveWorkingDirectory", () => {
  afterEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReset();
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(ensureWorktree).mockReset();
    vi.mocked(execFileSync).mockReset();
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error("not a git repo"); });
  });

  it("returns worktree path when branch and basePath are provided", async () => {
    // findGitRepoPath needs to find /repo as a git repo
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/repo");
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      if (Array.isArray(args) && args.includes("--show-toplevel")) {
        return "/repo\n";
      }
      return Buffer.from(".git\n");
    });
    vi.mocked(ensureWorktree).mockResolvedValue({
      worktreePath: "/worktrees/my-branch",
      branch: "my-branch",
      created: true,
    });
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "my-branch",
      worktreeBasePath: "/repo",
      useWorktrees: true,
      eventQueue: queue,
    });

    expect(result).toBe("/worktrees/my-branch");
    const event = await queue.shift();
    expect(event?.type).toBe("system");
    expect(event?.content).toContain("Worktree ready");
    queue.close();
  });

  it("falls back to workspace directory when worktree fails", async () => {
    // findGitRepoPath finds /repo as git repo, but ensureWorktree fails
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/repo" || String(p) === "/workspace");
    vi.mocked(execFileSync).mockImplementation((_cmd, args, opts) => {
      if ((opts as { cwd: string }).cwd === "/repo") {
        if (Array.isArray(args) && args.includes("--show-toplevel")) {
          return "/repo\n";
        }
        return Buffer.from(".git\n");
      }
      throw new Error("not a git repo");
    });
    vi.mocked(ensureWorktree).mockRejectedValue(new Error("git error"));
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "my-branch",
      worktreeBasePath: "/repo",
      useWorktrees: true,
      eventQueue: queue,
    });

    expect(result).toBe("/repo");
    const event = await queue.shift();
    expect(event?.type).toBe("system");
    expect(event?.content).toContain("Worktree setup failed");
    queue.close();
  });

  it("returns undefined when worktree fails and no workspace exists", async () => {
    vi.mocked(ensureWorktree).mockRejectedValue(new Error("git error"));
    vi.mocked(existsSync).mockReturnValue(false);
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "my-branch",
      worktreeBasePath: "/repo",
      useWorktrees: true,
      eventQueue: queue,
    });

    expect(result).toBeUndefined();
    queue.close();
  });

  it("returns /workspace when no branch is provided", async () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/workspace");
    vi.mocked(readdirSync).mockReturnValue(["file.txt"] as unknown as ReturnType<typeof readdirSync>);
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({ eventQueue: queue });

    expect(result).toBe("/workspace");
    queue.close();
  });

  it("returns undefined when /workspace does not exist and no branch", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({ eventQueue: queue });

    expect(result).toBeUndefined();
    queue.close();
  });

  it("returns undefined when requireNonEmpty is true and /workspace is empty", async () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/workspace");
    vi.mocked(readdirSync).mockReturnValue([]);
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      eventQueue: queue,
      requireNonEmpty: true,
    });

    expect(result).toBeUndefined();
    queue.close();
  });

  it("returns /workspace when requireNonEmpty is true and /workspace has files", async () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/workspace");
    vi.mocked(readdirSync).mockReturnValue(["README.md"] as unknown as ReturnType<typeof readdirSync>);
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      eventQueue: queue,
      requireNonEmpty: true,
    });

    expect(result).toBe("/workspace");
    queue.close();
  });

  it("returns /workspace without checking emptiness when requireNonEmpty is false", async () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/workspace");
    vi.mocked(readdirSync).mockReturnValue([]);
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      eventQueue: queue,
      requireNonEmpty: false,
    });

    expect(result).toBe("/workspace");
    expect(readdirSync).not.toHaveBeenCalled();
    queue.close();
  });

  // UT-1: branch provided but no worktreeBasePath — worktrees disabled
  it("checks out branch in main working tree when branch is set but worktreeBasePath is empty", async () => {
    // findGitRepoPath should find /workspace
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/workspace");
    vi.mocked(execFileSync).mockImplementation((_cmd, args, opts) => {
      if ((opts as { cwd: string }).cwd === "/workspace") {
        if (Array.isArray(args) && args.includes("--show-toplevel")) {
          return "/workspace\n";
        }
        return Buffer.from(".git\n");
      }
      throw new Error("not a git repo");
    });
    // execFile (used by checkoutBranchInPlace) succeeds by default from mock
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "feature/my-branch",
      worktreeBasePath: "",
      eventQueue: queue,
    });

    expect(result).toBe("/workspace");
    const event = await queue.shift();
    expect(event?.type).toBe("system");
    expect(event?.content).toContain("Checked out branch");
    expect(event?.content).toContain("feature/my-branch");
    // Verify ensureWorktree was NOT called (worktrees disabled path)
    expect(ensureWorktree).not.toHaveBeenCalled();
    queue.close();
  });

  it("falls back to workspace when branch checkout fails and worktreeBasePath is empty", async () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/workspace");
    vi.mocked(execFileSync).mockImplementation((_cmd, args, opts) => {
      if ((opts as { cwd: string }).cwd === "/workspace") {
        if (Array.isArray(args) && args.includes("--show-toplevel")) {
          return "/workspace\n";
        }
        return Buffer.from(".git\n");
      }
      throw new Error("not a git repo");
    });
    // Make execFile fail (checkout fails)
    vi.mocked(execFile).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(new Error("checkout failed"));
      },
    );
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "feature/bad-branch",
      worktreeBasePath: "",
      eventQueue: queue,
    });

    // Falls back to /workspace since no worktree path is returned
    expect(result).toBe("/workspace");
    const event = await queue.shift();
    expect(event?.type).toBe("system");
    expect(event?.content).toContain("Branch checkout failed");
    queue.close();
  });

  it("returns undefined when branch checkout fails and no workspace exists (worktreeBasePath empty)", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(execFile).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(new Error("checkout failed"));
      },
    );
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "feature/bad-branch",
      worktreeBasePath: "",
      eventQueue: queue,
    });

    expect(result).toBeUndefined();
    queue.close();
  });

  // UT-2 (existing behavior preserved): branch and worktreeBasePath both set → creates worktree
  it("creates worktree when both branch and worktreeBasePath are set (existing behavior preserved)", async () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === "/repo");
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      if (Array.isArray(args) && args.includes("--show-toplevel")) {
        return "/repo\n";
      }
      return Buffer.from(".git\n");
    });
    vi.mocked(ensureWorktree).mockResolvedValue({
      worktreePath: "/worktrees/my-branch",
      branch: "my-branch",
      created: true,
    });
    const queue = new AsyncQueue<AgentEvent>();

    const result = await resolveWorkingDirectory({
      branch: "my-branch",
      worktreeBasePath: "/repo",
      useWorktrees: true,
      eventQueue: queue,
    });

    expect(result).toBe("/worktrees/my-branch");
    expect(ensureWorktree).toHaveBeenCalled();
    queue.close();
  });
});

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
