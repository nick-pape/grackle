import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const execRaw = promisify(execFile);

/** Wrapper that uses a shell so `git` resolves via PATH on all platforms. */
async function exec(cmd: string, args: string[], opts: { cwd: string }): Promise<{ stdout: string; stderr: string }> {
  const shell = process.env.SHELL || true;
  const result = await execRaw(cmd, args, { ...opts, shell });
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
}

export interface WorktreeResult {
  worktreePath: string;
  branch: string;
  created: boolean;
}

function sanitizeBranch(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9/_-]/g, "-");
}

function worktreeDir(basePath: string, branch: string): string {
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
    throw new Error(`Git repo not writable: ${basePath} (${err})`);
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
      throw new Error(`Failed to create worktree for branch ${branch}: ${err}`);
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

export async function listWorktrees(basePath: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git", ["worktree", "list", "--porcelain"], { cwd: basePath });
    return stdout
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.replace("worktree ", ""));
  } catch {
    return [];
  }
}
