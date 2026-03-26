import type { AgentEvent } from "./runtime.js";
import type { AsyncQueue } from "./async-queue.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureWorktree } from "./worktree.js";
import { logger } from "./logger.js";

// ─── Injectable interfaces ──────────────────────────────────

/**
 * Higher-level git repository abstraction for workspace resolution.
 *
 * Unlike the raw `GitExecutor` in worktree.ts (which wraps a single `exec(args)` call),
 * this interface provides domain-specific methods for repository discovery and branch checkout.
 */
export interface GitRepository {
  /** Check if a directory is inside a git repository. */
  isRepo(dir: string): Promise<boolean>;
  /** Return the git toplevel for a directory, or undefined if not a repo. */
  toplevel(dir: string): Promise<string | undefined>;
  /** Check out (or create) a branch in the main working tree. */
  checkoutBranch(repoPath: string, branch: string): Promise<void>;
}

/** Default implementation that shells out to the real git binary. */
export const NODE_GIT_REPOSITORY: GitRepository = (() => {
  const execFileAsync: typeof execFile.__promisify__ = promisify(execFile);
  return {
    async isRepo(dir: string): Promise<boolean> {
      try {
        await execFileAsync("git", ["rev-parse", "--git-dir"], { cwd: dir });
        return true;
      } catch {
        return false;
      }
    },
    async toplevel(dir: string): Promise<string | undefined> {
      try {
        const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: dir });
        return stdout.trim();
      } catch {
        return undefined;
      }
    },
    async checkoutBranch(repoPath: string, branch: string): Promise<void> {
      try {
        // "--" prevents branch names starting with "-" from being interpreted as flags
        await execFileAsync("git", ["checkout", "--", branch], { cwd: repoPath });
      } catch {
        // Branch doesn't exist yet — create it
        await execFileAsync("git", ["checkout", "-b", branch], { cwd: repoPath });
      }
    },
  };
})();

/** Filesystem operations for workspace discovery. */
export interface WorkspaceLocator {
  /** Check if a path exists. */
  exists(path: string): boolean;
  /** List entries in a directory. Returns empty array on failure. */
  readDirectory(path: string): string[];
}

/** Default implementation using real Node.js fs. */
export const NODE_WORKSPACE_LOCATOR: WorkspaceLocator = {
  exists: existsSync,
  readDirectory(path: string): string[] {
    try {
      return readdirSync(path) as unknown as string[];
    } catch {
      return [];
    }
  },
};

// ─── Working directory resolution ──────────────────────────

/** Options for resolving the working directory. */
export interface ResolveWorkingDirectoryOptions {
  /** Git branch to check out in a worktree. */
  branch?: string;
  /** Base path for worktree creation or working directory override. */
  workingDirectory?: string;
  /** When true, create git worktrees for branch isolation. When false, checkout in place. Defaults to true when undefined. */
  useWorktrees?: boolean;
  /** Event queue to push system messages to. */
  eventQueue: AsyncQueue<AgentEvent>;
  /**
   * When true, the `/workspace` fallback requires the directory to be non-empty.
   * Only claude-code sets this — codex and copilot accept empty workspaces.
   */
  requireNonEmpty?: boolean;
  /** @internal Git repository abstraction for testing. */
  git?: GitRepository;
  /** @internal Workspace locator abstraction for testing. */
  locator?: WorkspaceLocator;
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
export async function findGitRepoPath(
  basePath?: string,
  git: GitRepository = NODE_GIT_REPOSITORY,
  locator: WorkspaceLocator = NODE_WORKSPACE_LOCATOR,
): Promise<string | undefined> {
  // Try the explicitly provided path first, resolving to the actual repo root
  if (basePath && locator.exists(basePath) && await git.isRepo(basePath)) {
    return (await git.toplevel(basePath)) ?? basePath;
  }

  // Docker convention
  if (locator.exists("/workspace") && await git.isRepo("/workspace")) {
    return (await git.toplevel("/workspace")) ?? "/workspace";
  }

  // GitHub Codespaces convention: /workspaces/<repo-name>
  if (locator.exists("/workspaces")) {
    const entries = locator.readDirectory("/workspaces");
    for (const entry of entries) {
      const candidate = `/workspaces/${entry}`;
      if (locator.exists(candidate) && await git.isRepo(candidate)) {
        return (await git.toplevel(candidate)) ?? candidate;
      }
    }
  }

  return undefined;
}

/**
 * Find any existing workspace directory (git repo or not) for fallback use.
 * Used when worktree setup fails and we just need a working directory.
 */
function findWorkspaceDir(
  basePath?: string,
  requireNonEmpty?: boolean,
  locator: WorkspaceLocator = NODE_WORKSPACE_LOCATOR,
): string | undefined {
  const candidates = [basePath, "/workspace"];

  // Also check /workspaces/* for Codespaces
  if (locator.exists("/workspaces")) {
    for (const entry of locator.readDirectory("/workspaces")) {
      candidates.push(`/workspaces/${entry}`);
    }
  }

  for (const dir of candidates) {
    if (dir && locator.exists(dir)) {
      if (requireNonEmpty) {
        if (locator.readDirectory(dir).length === 0) {
          continue;
        }
      }
      return dir;
    }
  }
  return undefined;
}

/**
 * Resolve the working directory for an agent session.
 *
 * Tries worktree creation first (when branch + basePath are provided and
 * useWorktrees is not false), auto-detecting the git repo if the provided
 * basePath is not a git repo. Falls back to workspace directories on failure.
 *
 * When useWorktrees is explicitly false, checks out the branch directly in the
 * main working tree instead of creating a worktree. When useWorktrees is
 * undefined (proto3 unset), it defaults to true.
 */
export async function resolveWorkingDirectory(options: ResolveWorkingDirectoryOptions): Promise<string | undefined> {
  const {
    branch,
    workingDirectory,
    useWorktrees = true,
    eventQueue,
    requireNonEmpty,
    git = NODE_GIT_REPOSITORY,
    locator = NODE_WORKSPACE_LOCATOR,
  } = options;
  const ts = (): string => new Date().toISOString();

  if (branch && workingDirectory && useWorktrees) {
    // Worktrees enabled — create a worktree for the branch.
    // Auto-detect the actual git repo path — the server may send a default
    // like "/workspace" that doesn't match the actual layout (e.g. Codespaces
    // use /workspaces/<repo>).
    const repoPath = await findGitRepoPath(workingDirectory, git, locator);

    if (repoPath) {
      try {
        const wt = await ensureWorktree(repoPath, branch);
        eventQueue.push({ type: "system", timestamp: ts(), content: `Worktree ready: ${wt.worktreePath} (branch: ${branch}, created: ${String(wt.created)}, synced: ${String(wt.synced)})` });
        return wt.worktreePath;
      } catch (wtErr) {
        eventQueue.push({ type: "system", timestamp: ts(), content: `Worktree setup failed (${wtErr instanceof Error ? wtErr.message : String(wtErr)}), falling back to workspace` });
      }
    } else {
      eventQueue.push({ type: "system", timestamp: ts(), content: `No git repo found at ${workingDirectory} or well-known paths, falling back to workspace` });
    }

    // Worktree failed — fall back to best available workspace
    const fallback = findWorkspaceDir(workingDirectory, requireNonEmpty, locator);
    if (fallback) {
      return fallback;
    }
    return undefined;
  }

  if (branch && !useWorktrees) {
    // Worktrees disabled — check out the branch in the main working tree.
    // Use workingDirectory as the repo hint if provided.
    const repoPath = await findGitRepoPath(workingDirectory, git, locator);

    if (repoPath) {
      try {
        await git.checkoutBranch(repoPath, branch);
        eventQueue.push({ type: "system", timestamp: ts(), content: `Checked out branch '${branch}' in main working tree: ${repoPath}` });
        return repoPath;
      } catch (checkoutErr) {
        eventQueue.push({ type: "system", timestamp: ts(), content: `Branch checkout failed (${checkoutErr instanceof Error ? checkoutErr.message : String(checkoutErr)}), falling back to workspace` });
      }
    } else {
      eventQueue.push({ type: "system", timestamp: ts(), content: `No git repo found${workingDirectory ? ` at ${workingDirectory}` : ""} for branch checkout, falling back to workspace` });
    }

    // Checkout failed — fall back to best available workspace
    const fallback = findWorkspaceDir(workingDirectory, requireNonEmpty, locator);
    if (fallback) {
      return fallback;
    }
    return undefined;
  }

  // No branch requested — just find a workspace directory
  return findWorkspaceDir(workingDirectory, requireNonEmpty, locator);
}

// ─── ACP MCP server conversion ─────────────────────────────

/**
 * Convert Grackle MCP server configs (keyed object) to ACP format (named array).
 *
 * Grackle format: `{ "name": { command, args, env, ... } }`
 * ACP format:     `[{ name, type: "stdio"|"http", command, args, env, ... }]`
 */
export function convertMcpServers(servers: Record<string, unknown> | undefined): Record<string, unknown>[] {
  if (!servers) {
    return [];
  }
  return Object.entries(servers)
    .filter(([, config]) => typeof config === "object" && config !== null && !Array.isArray(config))
    .map(([name, config]) => {
      const cfg = config as Record<string, unknown>;
      // Detect transport: HTTP servers have type:"http" or a url field; everything else is stdio
      const isHttp = cfg.type === "http" || cfg.url;
      const result: Record<string, unknown> = {
        name,
        type: isHttp ? "http" : "stdio",
      };

      if (isHttp) {
        // HTTP transport: url is required, headers must be array of {name, value}
        result.url = cfg.url;
        if (cfg.headers && typeof cfg.headers === "object" && !Array.isArray(cfg.headers)) {
          result.headers = Object.entries(cfg.headers as Record<string, string>)
            .map(([k, v]) => ({ name: k, value: v }));
        } else if (Array.isArray(cfg.headers)) {
          result.headers = cfg.headers;
        }
      } else {
        // Stdio transport: command, args, env required
        result.command = (cfg.command || "") as string;
        result.args = Array.isArray(cfg.args) ? cfg.args : [];
        // env must be array of {name, value} — convert from object if needed
        if (cfg.env && typeof cfg.env === "object" && !Array.isArray(cfg.env)) {
          result.env = Object.entries(cfg.env as Record<string, string>)
            .map(([k, v]) => ({ name: k, value: v }));
        } else if (Array.isArray(cfg.env)) {
          result.env = cfg.env;
        } else {
          result.env = [];
        }
      }

      return result;
    });
}

// ─── MCP server resolution ─────────────────────────────────

/** Resolved MCP configuration returned by resolveMcpServers. */
export interface ResolvedMcpConfig {
  servers: Record<string, unknown> | undefined;
  disallowedTools: string[];
}

/** Broker configuration for injecting the HTTP MCP server entry. Matches SpawnOptions.mcpBroker. */
export interface BrokerConfig {
  /** Full URL of the broker's /mcp endpoint. */
  url: string;
  /** Scoped Bearer token for this session. */
  token: string;
}


/**
 * Load MCP server configurations from the shared GRACKLE_MCP_CONFIG file and spawn options.
 *
 * Also reads `disallowedTools` and filters matching tools from MCP server configs.
 * When `brokerConfig` is provided, injects an HTTP-based Grackle MCP server entry.
 */
export function resolveMcpServers(
  spawnMcpServers?: Record<string, unknown>,
  brokerConfig?: BrokerConfig,
): ResolvedMcpConfig {
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

  // Inject the Grackle MCP server entry when broker config is provided
  if (!servers.grackle && brokerConfig) {
    servers.grackle = {
      type: "http",
      url: brokerConfig.url,
      headers: { Authorization: `Bearer ${brokerConfig.token}` },
      // tools: ["*"] is required by Copilot SDK (MCPServerConfigBase.tools is mandatory).
      // Claude Agent SDK ignores unknown fields, Codex CLI flattens to --config.
      tools: ["*"],
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
