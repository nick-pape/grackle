import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync as existsSyncNode } from "node:fs";
import { resolve, dirname } from "node:path";
import { logger } from "./logger.js";

const execRaw: typeof execFile.__promisify__ = promisify(execFile);

/** Timeout for `git fetch origin` in milliseconds. */
const FETCH_TIMEOUT_MS: number = 30_000;

/** Maximum permitted length of a git branch name. */
const MAX_BRANCH_NAME_LENGTH: number = 255;

/**
 * Characters permitted in a git branch name: a strict allowlist that excludes
 * every shell metacharacter and whitespace. This is a superset of
 * {@link sanitizeBranch}'s charset — it additionally allows `.`, which is
 * valid in git refs (e.g. `release-1.2.3`) but which `sanitizeBranch` replaces
 * because it is producing a filesystem path rather than validating a ref.
 */
const VALID_BRANCH_NAME_PATTERN: RegExp = /^[A-Za-z0-9._/-]+$/;

/**
 * Validate that a branch name is safe to pass to the git CLI.
 *
 * This is a security control against command/argument injection
 * (GHSA-vv65): a branch name flows from an untrusted gRPC request into
 * `git worktree` invocations. Rather than silently rewriting the value (a
 * branch is a meaningful ref), this rejects anything outside a strict
 * allowlist so callers fail closed.
 *
 * @param branch - The branch name to validate.
 * @throws Error if the branch name is empty, too long, contains characters
 *   outside `[A-Za-z0-9._/-]`, or violates git ref rules (leading `-` or `/`,
 *   trailing `/`, a `..` sequence, or a trailing `.` / `.lock`).
 */
export function validateGitBranchName(branch: string): void {
  if (branch.length === 0) {
    throw new Error("Invalid branch name: must not be empty");
  }
  if (branch.length > MAX_BRANCH_NAME_LENGTH) {
    throw new Error(`Invalid branch name: exceeds ${MAX_BRANCH_NAME_LENGTH} characters`);
  }
  if (!VALID_BRANCH_NAME_PATTERN.test(branch)) {
    throw new Error(
      "Invalid branch name: only letters, digits, '.', '_', '/', and '-' are allowed",
    );
  }
  if (branch.startsWith("-")) {
    throw new Error("Invalid branch name: must not start with '-'");
  }
  if (branch.startsWith("/") || branch.endsWith("/")) {
    throw new Error("Invalid branch name: must not start or end with '/'");
  }
  if (branch.includes("..")) {
    throw new Error("Invalid branch name: must not contain '..'");
  }
  if (branch.endsWith(".lock")) {
    throw new Error("Invalid branch name: must not end with '.lock'");
  }
  if (branch.endsWith(".")) {
    throw new Error("Invalid branch name: must not end with '.'");
  }
}

/** Abstraction over git command execution used by worktree operations. */
export interface GitExecutor {
  /** Run a git command and return stdout/stderr. */
  exec(
    args: string[],
    options: { cwd: string; timeout?: number },
  ): Promise<{ stdout: string; stderr: string }>;
}

/** Default implementation that runs the real git binary. */
const NODE_GIT_EXECUTOR: GitExecutor = {
  async exec(args: string[], options: { cwd: string; timeout?: number }) {
    // NOTE: no `shell` option — execFile passes `args` directly to the git
    // process as an argv vector with no shell interpretation. Using a shell
    // here would concatenate the args into a string and allow command
    // injection via untrusted branch names (GHSA-vv65). `git` is a real
    // executable resolved from PATH, so no shell is needed on any platform.
    const result = await execRaw("git", args, options);
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
    const { stdout } = await git.exec(["symbolic-ref", "refs/remotes/origin/HEAD"], {
      cwd: basePath,
    });
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
  // Reject unsafe branch names before they reach the git CLI (GHSA-vv65).
  validateGitBranchName(branch);

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
    throw new Error(
      `Git repo not writable: ${basePath} (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const wtPath = worktreeDir(basePath, branch);

  if (fileSystem.existsSync(wtPath)) {
    return { worktreePath: wtPath, branch, created: false, synced: false };
  }

  // Fetch origin so the new worktree branches from an up-to-date commit
  const { synced, startPoint } = await fetchAndDetectDefault(basePath, git);

  // Try creating a new branch worktree first.
  // `--` terminates option parsing so the positional path/commit-ish can never
  // be misread as a flag (defense in depth alongside validateGitBranchName).
  try {
    const addArgs = startPoint
      ? ["worktree", "add", "-b", branch, "--", wtPath, startPoint]
      : ["worktree", "add", "-b", branch, "--", wtPath];
    await git.exec(addArgs, { cwd: basePath });
    return { worktreePath: wtPath, branch, created: true, synced };
  } catch {
    // Branch may already exist — try without -b
    try {
      await git.exec(["worktree", "add", "--", wtPath, branch], { cwd: basePath });
      return { worktreePath: wtPath, branch, created: true, synced };
    } catch (err) {
      throw new Error(
        `Failed to create worktree for branch ${branch}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export async function removeWorktree(
  basePath: string,
  branch: string,
  git: GitExecutor = NODE_GIT_EXECUTOR,
): Promise<void> {
  validateGitBranchName(branch);
  const wtPath = worktreeDir(basePath, branch);
  try {
    // `--force` is a real flag, then `--` ends option parsing before the path.
    await git.exec(["worktree", "remove", "--force", "--", wtPath], { cwd: basePath });
  } catch {
    // Already removed or doesn't exist — that's fine
  }
}
