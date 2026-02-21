import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const exec = promisify(execFile);

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
  return resolve(parent, ".grackle-worktrees", sanitized);
}

export async function ensureWorktree(basePath: string, branch: string): Promise<WorktreeResult> {
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
