import type { AgentEvent } from "./runtime.js";
import type { AsyncQueue } from "../utils/async-queue.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureWorktree } from "../worktree.js";
import { logger } from "../logger.js";

const execFileAsync: typeof execFile.__promisify__ = promisify(execFile);

// ─── Shared constants ──────────────────────────────────────

const __dirname: string = dirname(fileURLToPath(import.meta.url));

/** Path to the Grackle MCP server script, resolved relative to the PowerLine package. */
export const GRACKLE_MCP_SCRIPT: string = join(__dirname, "../../mcp-grackle/index.js");

// ─── Finding construction ──────────────────────────────────

/**
 * Build a normalized "finding" AgentEvent from a `post_finding` tool call.
 *
 * Applies defaults: title "Untitled", content "", category "general", tags [].
 */
export function buildFindingEvent(args: Record<string, unknown>, raw: unknown): AgentEvent {
  return {
    type: "finding",
    timestamp: new Date().toISOString(),
    content: JSON.stringify({
      title: args.title || "Untitled",
      content: args.content || "",
      category: args.category || "general",
      tags: args.tags || [],
    }),
    raw,
  };
}

// ─── Subtask creation ─────────────────────────────────────

/**
 * Build a normalized "subtask_create" AgentEvent from a `create_subtask` tool call.
 *
 * Does not auto-generate `local_id` — the caller is responsible for providing one
 * if dependency resolution via `depends_on` is needed. This avoids mismatches
 * between the event payload and tool result.
 */
export function buildSubtaskCreateEvent(args: Record<string, unknown>, raw: unknown): AgentEvent {
  return {
    type: "subtask_create",
    timestamp: new Date().toISOString(),
    content: JSON.stringify({
      title: typeof args.title === "string" ? args.title : "",
      description: typeof args.description === "string" ? args.description : "",
      local_id: args.local_id || "",
      depends_on: args.depends_on || [],
      can_decompose: args.can_decompose ?? false,
    }),
    raw,
  };
}

// ─── Working directory resolution ──────────────────────────

/** Options for resolving the working directory. */
export interface ResolveWorkingDirectoryOptions {
  /** Git branch to check out in a worktree. */
  branch?: string;
  /** Base path for worktree creation. */
  worktreeBasePath?: string;
  /** Event queue to push system messages to. */
  eventQueue: AsyncQueue<AgentEvent>;
  /**
   * When true, the `/workspace` fallback requires the directory to be non-empty.
   * Only claude-code sets this — codex and copilot accept empty workspaces.
   */
  requireNonEmpty?: boolean;
}

/**
 * Check if a directory is a git repository by running `git rev-parse --git-dir`.
 * Returns true if the command succeeds.
 */
function isGitRepo(dir: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd: dir, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Return the git repository toplevel for a directory, or undefined if not a git repo.
 */
function gitToplevel(dir: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Find the git repository root from a set of well-known workspace paths.
 *
 * Checks (in order):
 * 1. The provided basePath (if given)
 * 2. /workspace (Docker convention)
 * 3. /workspaces/* (GitHub Codespaces convention — picks the first git repo found)
 *
 * Returns the first path that exists and is a git repository, or undefined.
 */
export function findGitRepoPath(basePath?: string): string | undefined {
  // Try the explicitly provided path first, resolving to the actual repo root
  if (basePath && existsSync(basePath) && isGitRepo(basePath)) {
    return gitToplevel(basePath) ?? basePath;
  }

  // Docker convention
  if (existsSync("/workspace") && isGitRepo("/workspace")) {
    return gitToplevel("/workspace") ?? "/workspace";
  }

  // GitHub Codespaces convention: /workspaces/<repo-name>
  if (existsSync("/workspaces")) {
    try {
      const entries = readdirSync("/workspaces");
      for (const entry of entries) {
        const candidate = `/workspaces/${entry}`;
        if (existsSync(candidate) && isGitRepo(candidate)) {
          return gitToplevel(candidate) ?? candidate;
        }
      }
    } catch {
      // Not readable — skip
    }
  }

  return undefined;
}

/**
 * Find any existing workspace directory (git repo or not) for fallback use.
 * Used when worktree setup fails and we just need a working directory.
 */
function findWorkspaceDir(basePath?: string, requireNonEmpty?: boolean): string | undefined {
  const candidates = [basePath, "/workspace"];

  // Also check /workspaces/* for Codespaces
  if (existsSync("/workspaces")) {
    try {
      for (const entry of readdirSync("/workspaces")) {
        candidates.push(`/workspaces/${entry}`);
      }
    } catch {
      // skip
    }
  }

  for (const dir of candidates) {
    if (dir && existsSync(dir)) {
      if (requireNonEmpty) {
        try {
          if (readdirSync(dir).length === 0) {
            continue;
          }
        } catch {
          continue;
        }
      }
      return dir;
    }
  }
  return undefined;
}

/**
 * Check out (or create) a branch in the main working tree without creating a worktree.
 *
 * Tries `git checkout <branch>` first (branch already exists), then falls back to
 * `git checkout -b <branch>` (create new branch from current HEAD).
 *
 * Arguments are passed as an array to execFile (not interpolated into a shell
 * command string), which prevents shell injection from branch names.
 *
 * @param repoPath - Absolute path to the git repository root.
 * @param branch - Branch name to check out.
 */
async function checkoutBranchInPlace(repoPath: string, branch: string): Promise<void> {
  try {
    await execFileAsync("git", ["checkout", branch], { cwd: repoPath });
  } catch {
    // Branch doesn't exist yet — create it
    await execFileAsync("git", ["checkout", "-b", branch], { cwd: repoPath });
  }
}

/**
 * Resolve the working directory for an agent session.
 *
 * Tries worktree creation first (when branch + basePath are provided),
 * auto-detecting the git repo if the provided basePath is not a git repo.
 * Falls back to workspace directories on failure.
 *
 * When a branch is provided but worktreeBasePath is empty (worktrees disabled),
 * checks out the branch directly in the main working tree and returns it.
 */
export async function resolveWorkingDirectory(options: ResolveWorkingDirectoryOptions): Promise<string | undefined> {
  const { branch, worktreeBasePath, eventQueue, requireNonEmpty } = options;
  const ts = (): string => new Date().toISOString();

  if (branch && worktreeBasePath) {
    // Auto-detect the actual git repo path — the server may send a default
    // like "/workspace" that doesn't match the actual layout (e.g. Codespaces
    // use /workspaces/<repo>).
    const repoPath = findGitRepoPath(worktreeBasePath);

    if (repoPath) {
      try {
        const wt = await ensureWorktree(repoPath, branch);
        eventQueue.push({ type: "system", timestamp: ts(), content: `Worktree ready: ${wt.worktreePath} (branch: ${branch}, created: ${wt.created})` });
        return wt.worktreePath;
      } catch (wtErr) {
        eventQueue.push({ type: "system", timestamp: ts(), content: `Worktree setup failed (${wtErr}), falling back to workspace` });
      }
    } else {
      eventQueue.push({ type: "system", timestamp: ts(), content: `No git repo found at ${worktreeBasePath} or well-known paths, falling back to workspace` });
    }

    // Worktree failed — fall back to best available workspace
    const fallback = findWorkspaceDir(worktreeBasePath, requireNonEmpty);
    if (fallback) {
      return fallback;
    }
    return undefined;
  }

  if (branch && !worktreeBasePath) {
    // Worktrees are disabled — check out the branch in the main working tree.
    const repoPath = findGitRepoPath();

    if (repoPath) {
      try {
        await checkoutBranchInPlace(repoPath, branch);
        eventQueue.push({ type: "system", timestamp: ts(), content: `Checked out branch '${branch}' in main working tree: ${repoPath}` });
        return repoPath;
      } catch (checkoutErr) {
        eventQueue.push({ type: "system", timestamp: ts(), content: `Branch checkout failed (${checkoutErr}), falling back to workspace` });
      }
    } else {
      eventQueue.push({ type: "system", timestamp: ts(), content: `No git repo found for branch checkout, falling back to workspace` });
    }

    // Checkout failed — fall back to best available workspace
    const fallback = findWorkspaceDir(undefined, requireNonEmpty);
    if (fallback) {
      return fallback;
    }
    return undefined;
  }

  // No branch requested — just find a workspace directory
  return findWorkspaceDir(worktreeBasePath, requireNonEmpty);
}

// ─── MCP server resolution ─────────────────────────────────

/** Resolved MCP configuration returned by resolveMcpServers. */
export interface ResolvedMcpConfig {
  servers: Record<string, unknown> | undefined;
  disallowedTools: string[];
}

/**
 * Load MCP server configurations from the shared GRACKLE_MCP_CONFIG file and spawn options.
 *
 * Also reads `disallowedTools` and filters matching tools from MCP server configs.
 * Auto-injects the Grackle coordination MCP server when the script is bundled.
 */
export function resolveMcpServers(spawnMcpServers?: Record<string, unknown>): ResolvedMcpConfig {
  let servers: Record<string, unknown> = {};
  let disallowedTools: string[] = [];

  const mcpConfigPath = process.env.GRACKLE_MCP_CONFIG;
  if (mcpConfigPath && existsSync(mcpConfigPath)) {
    try {
      const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf8")) as Record<string, unknown>;
      if (mcpConfig.mcpServers && typeof mcpConfig.mcpServers === "object") {
        servers = { ...servers, ...(mcpConfig.mcpServers as Record<string, unknown>) };
      }
      if (Array.isArray(mcpConfig.disallowedTools)) {
        disallowedTools = mcpConfig.disallowedTools.filter(
          (t): t is string => typeof t === "string",
        );
      }
    } catch { /* ignore malformed config */ }
  }

  if (spawnMcpServers) {
    servers = { ...servers, ...spawnMcpServers };
  }

  // Auto-inject Grackle coordination MCP server if the script is bundled
  if (existsSync(GRACKLE_MCP_SCRIPT) && !servers.grackle) {
    servers.grackle = {
      command: "node",
      args: [GRACKLE_MCP_SCRIPT],
      tools: ["post_finding", "create_subtask", "get_task_context", "update_task_status", "query_findings"],
    };
  }

  // Filter disallowed tools from MCP server configs. The disallowedTools list
  // uses the format "mcp__<serverName>__<toolName>", matching Claude Code's convention.
  if (disallowedTools.length > 0) {
    for (const [serverName, serverConfig] of Object.entries(servers)) {
      if (typeof serverConfig !== "object" || serverConfig === null) {
        continue;
      }
      const cfg = serverConfig as Record<string, unknown>;
      if (!Array.isArray(cfg.tools)) {
        continue;
      }
      const prefix = `mcp__${serverName}__`;
      const blocked = new Set(
        disallowedTools.filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length)),
      );
      if (blocked.size > 0) {
        cfg.tools = (cfg.tools as string[]).filter((t) => !blocked.has(t));
        if ((cfg.tools as string[]).length === 0) {
          delete servers[serverName];
          logger.info({ serverName, blocked: [...blocked] }, "Removed MCP server (all tools disallowed)");
        } else {
          logger.info({ serverName, blocked: [...blocked] }, "Filtered disallowed tools from MCP server");
        }
      }
    }
  }

  return {
    servers: Object.keys(servers).length > 0 ? servers : undefined,
    disallowedTools,
  };
}
