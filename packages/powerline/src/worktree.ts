import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const execRaw: typeof execFile.__promisify__ = promisify(execFile);

/** Wrapper that uses a shell so `git` resolves via PATH on all platforms. */
async function exec(cmd: string, args: string[], opts: { cwd: string }): Promise<{ stdout: string; stderr: string }> {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string means "not set"
  const shell = process.env.SHELL || true;
  const result = await execRaw(cmd, args, { ...opts, shell });
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
}

export interface WorktreeResult {
  worktreePath: string;
  branch: string;
  created: boolean;
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
    const home = process.env.HOME || process.env.USERPROFILE || basePath; // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- empty string means "not set"
    return resolve(home, ".grackle-worktrees", sanitized);
  }
  return resolve(parent, ".grackle-worktrees", sanitized);
}

export async function ensureWorktree(basePath: string, branch: string): Promise<WorktreeResult> {
  // Pre-check: verify basePath is a git repository
  try {
    await exec("git", ["rev-parse", "--git-dir"], { cwd: basePath });
  } catch {
    throw new Error(`Not a git repository: ${basePath}`);
  }

  // Pre-check: verify the git repo is writable (worktrees modify .git internals)
  try {
    await exec("git", ["status", "--porcelain"], { cwd: basePath });
  } catch (err) {
    throw new Error(`Git repo not writable: ${basePath} (${err instanceof Error ? err.message : String(err)})`);
  }

  const wtPath = worktreeDir(basePath, branch);

  if (existsSync(wtPath)) {
    return { worktreePath: wtPath, branch, created: false };
  }

  // Try creating a new branch worktree first
  try {
    await exec("git", ["worktree", "add", "-b", branch, wtPath], { cwd: basePath });
    return { worktreePath: wtPath, branch, created: true };
  } catch {
    // Branch may already exist — try without -b
    try {
      await exec("git", ["worktree", "add", wtPath, branch], { cwd: basePath });
      return { worktreePath: wtPath, branch, created: true };
    } catch (err) {
      throw new Error(`Failed to create worktree for branch ${branch}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export async function removeWorktree(basePath: string, branch: string): Promise<void> {
  const wtPath = worktreeDir(basePath, branch);
  try {
    await exec("git", ["worktree", "remove", wtPath, "--force"], { cwd: basePath });
  } catch {
    // Already removed or doesn't exist — that's fine
  }
}

