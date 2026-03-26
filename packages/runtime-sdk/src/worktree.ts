import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync as existsSyncNode } from "node:fs";
import { resolve, dirname } from "node:path";
import { logger } from "./logger.js";

const execRaw: typeof execFile.__promisify__ = promisify(execFile);

/** Timeout for `git fetch origin` in milliseconds. */
const FETCH_TIMEOUT_MS: number = 30_000;

/** Abstraction over git command execution used by worktree operations. */
export interface GitExecutor {
  /** Run a git command and return stdout/stderr. */
  exec(args: string[], options: { cwd: string; timeout?: number }): Promise<{ stdout: string; stderr: string }>;
}

/** Default implementation that shells out to the real git binary. */
const NODE_GIT_EXECUTOR: GitExecutor = {
  async exec(args: string[], options: { cwd: string; timeout?: number }) {
    const shell = process.env.SHELL || true;
    const result = await execRaw("git", args, { ...options, shell });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  },
};

/** Filesystem operations used by worktree functions. */
export interface WorktreeFileSystem {
  /** Check whether a path exists. */
  existsSync(path: string): boolean;
}

/** Default implementation using real Node.js fs. */
const NODE_WORKTREE_FILE_SYSTEM: WorktreeFileSystem = {
  existsSync: existsSyncNode,
};

export interface WorktreeResult {
  worktreePath: string;
  branch: string;
  created: boolean;
  /** True if `git fetch origin` succeeded before worktree creation. */
  synced: boolean;
}

/** @internal Sanitize a branch name for use in file paths. Exported for testing. */
export function sanitizeBranch(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9/_-]/g, "-");
}

/** @internal Compute the worktree directory path for a given branch. Exported for testing. */
export function worktreeDir(basePath: string, branch: string): string {
  const sanitized = sanitizeBranch(branch).replace(/\//g, "-");
  const parent = dirname(basePath);
  // When repo is at a root-level path (e.g. /workspace in Docker),
  // dirname returns "/" which is typically not writable. Fall back to $HOME.
  if (parent === "/" || parent === "\\") {
    const home = process.env.HOME || process.env.USERPROFILE || basePath;
    return resolve(home, ".grackle-worktrees", sanitized);
  }
  return resolve(parent, ".grackle-worktrees", sanitized);
}

/**
 * Fetch from origin and detect the default branch name.
 *
 * Returns `synced: true` with a `startPoint` like `origin/main` on success,
 * or `synced: false` with no start point on failure (so the caller can still
 * create the worktree from local HEAD).
 */
async function fetchAndDetectDefault(
  basePath: string,
  git: GitExecutor,
): Promise<{ synced: boolean; startPoint: string | undefined }> {
  try {
    await git.exec(["fetch", "origin"], { cwd: basePath, timeout: FETCH_TIMEOUT_MS });
  } catch (err) {
    logger.warn({ err }, "git fetch origin failed — worktree will branch from local HEAD");
    return { synced: false, startPoint: undefined };
  }

  // Detect the remote's default branch (e.g. refs/remotes/origin/main)
  let defaultBranch = "origin/main";
  try {
    const { stdout } = await git.exec(["symbolic-ref", "refs/remotes/origin/HEAD"], { cwd: basePath });
    const trimmed = stdout.trim(); // e.g. "refs/remotes/origin/main"
    if (trimmed.startsWith("refs/remotes/")) {
      defaultBranch = trimmed.slice("refs/remotes/".length); // "origin/main"
    }
  } catch {
    logger.warn("Could not detect default branch via symbolic-ref, falling back to origin/main");
  }

  return { synced: true, startPoint: defaultBranch };
}

export async function ensureWorktree(
  basePath: string,
  branch: string,
  git: GitExecutor = NODE_GIT_EXECUTOR,
  fileSystem: WorktreeFileSystem = NODE_WORKTREE_FILE_SYSTEM,
): Promise<WorktreeResult> {
  // Pre-check: verify basePath is a git repository
  try {
    await git.exec(["rev-parse", "--git-dir"], { cwd: basePath });
  } catch {
    throw new Error(`Not a git repository: ${basePath}`);
  }

  // Pre-check: verify the git repo is writable (worktrees modify .git internals)
  try {
    await git.exec(["status", "--porcelain"], { cwd: basePath });
  } catch (err) {
    throw new Error(`Git repo not writable: ${basePath} (${err instanceof Error ? err.message : String(err)})`);
  }

  const wtPath = worktreeDir(basePath, branch);

  if (fileSystem.existsSync(wtPath)) {
    return { worktreePath: wtPath, branch, created: false, synced: false };
  }

  // Fetch origin so the new worktree branches from an up-to-date commit
  const { synced, startPoint } = await fetchAndDetectDefault(basePath, git);

  // Try creating a new branch worktree first
  try {
    const addArgs = startPoint
      ? ["worktree", "add", "-b", branch, wtPath, startPoint]
      : ["worktree", "add", "-b", branch, wtPath];
    await git.exec(addArgs, { cwd: basePath });
    return { worktreePath: wtPath, branch, created: true, synced };
  } catch {
    // Branch may already exist — try without -b
    try {
      await git.exec(["worktree", "add", wtPath, branch], { cwd: basePath });
      return { worktreePath: wtPath, branch, created: true, synced };
    } catch (err) {
      throw new Error(`Failed to create worktree for branch ${branch}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export async function removeWorktree(
  basePath: string,
  branch: string,
  git: GitExecutor = NODE_GIT_EXECUTOR,
): Promise<void> {
  const wtPath = worktreeDir(basePath, branch);
  try {
    await git.exec(["worktree", "remove", wtPath, "--force"], { cwd: basePath });
  } catch {
    // Already removed or doesn't exist — that's fine
  }
}

