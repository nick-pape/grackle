import type { AgentEvent } from "./runtime.js";
import type { AsyncQueue } from "../utils/async-queue.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { ensureWorktree } from "../worktree.js";
import { logger } from "../logger.js";

// ─── Shared constants ──────────────────────────────────────

/** Path to the Grackle MCP server script bundled in the container image. */
export const GRACKLE_MCP_SCRIPT: string = "/app/mcp-grackle/index.js";

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
 * Applies defaults: local_id auto-generated, depends_on [], can_decompose false.
 */
export function buildSubtaskCreateEvent(args: Record<string, unknown>, raw: unknown): AgentEvent {
  return {
    type: "subtask_create",
    timestamp: new Date().toISOString(),
    content: JSON.stringify({
      title: args.title || "Untitled subtask",
      description: args.description || "",
      local_id: args.local_id || `subtask-${Date.now()}`,
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
 * Resolve the working directory for an agent session.
 *
 * Tries worktree creation first (when branch + basePath are provided),
 * then falls back to `/workspace` if it exists.
 */
export async function resolveWorkingDirectory(options: ResolveWorkingDirectoryOptions): Promise<string | undefined> {
  const { branch, worktreeBasePath, eventQueue, requireNonEmpty } = options;
  const ts = (): string => new Date().toISOString();

  if (branch && worktreeBasePath) {
    try {
      const wt = await ensureWorktree(worktreeBasePath, branch);
      eventQueue.push({ type: "system", timestamp: ts(), content: `Worktree ready: ${wt.worktreePath} (branch: ${branch}, created: ${wt.created})` });
      return wt.worktreePath;
    } catch (wtErr) {
      eventQueue.push({ type: "system", timestamp: ts(), content: `Worktree setup skipped (${wtErr}), falling back to workspace` });
      const workspacePath = "/workspace";
      if (existsSync(workspacePath)) {
        return workspacePath;
      }
      return undefined;
    }
  }

  const workspacePath = "/workspace";
  if (existsSync(workspacePath)) {
    if (requireNonEmpty && readdirSync(workspacePath).length === 0) {
      return undefined;
    }
    return workspacePath;
  }
  return undefined;
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
      tools: ["post_finding", "create_subtask", "get_task_context", "update_task_status"],
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
