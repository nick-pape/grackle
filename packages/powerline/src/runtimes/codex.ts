import type { AgentRuntime, SpawnOptions, ResumeOptions } from "./runtime.js";
import { BaseAgentSession } from "./base-session.js";
import { existsSync, readFileSync } from "node:fs";
import { ensureWorktree } from "../worktree.js";
import { logger } from "../logger.js";

// ─── Environment variable names ────────────────────────────
// All configuration is driven by environment variables so the
// runtime works identically across Docker, local, SSH, etc.

/** Path to the Codex CLI binary. Overrides default PATH resolution. */
const ENV_CODEX_CLI_PATH: string = "CODEX_CLI_PATH";
/** Path to the Grackle MCP server script bundled in the container image. */
const GRACKLE_MCP_SCRIPT: string = "/app/mcp-grackle/index.js";

// ─── Dynamic import ────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface CodexSdkModule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Codex: new (opts?: Record<string, unknown>) => any;
}

/** Promise for the one-time SDK import, cached to avoid race conditions. */
let sdkPromise: Promise<CodexSdkModule> | undefined;

/** Lazily import the Codex SDK to avoid loading it until first use. */
function getCodexSdk(): Promise<CodexSdkModule> {
  if (!sdkPromise) {
    sdkPromise = (async (): Promise<CodexSdkModule> => {
      try {
        const mod = await import("@openai/codex-sdk");
        if (typeof mod.Codex !== "function") {
          throw new Error("Codex not found in @openai/codex-sdk");
        }
        return { Codex: mod.Codex };
      } catch {
        sdkPromise = undefined;
        throw new Error(
          "Codex SDK not installed. Run: npm install @openai/codex-sdk\n" +
          "The Codex CLI must also be installed and available in PATH (or set CODEX_CLI_PATH)."
        );
      }
    })();
  }
  return sdkPromise;
}

// ─── Helpers ───────────────────────────────────────────────

/** Resolved MCP configuration returned by resolveMcpServers. */
interface ResolvedMcpConfig {
  servers: Record<string, unknown> | undefined;
  disallowedTools: string[];
}

/**
 * Load MCP server configurations from the shared GRACKLE_MCP_CONFIG file and spawn options.
 * Also reads `disallowedTools` and filters matching tools from MCP server configs.
 */
function resolveMcpServers(spawnMcpServers?: Record<string, unknown>): ResolvedMcpConfig {
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
      tools: ["post_finding", "get_task_context", "update_task_status"],
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

/**
 * Extract the `type` discriminator from a ThreadItem.
 *
 * ThreadItem is a union of objects like `{ type: "command_execution", ... }`.
 */
function itemType(item: Record<string, unknown>): string {
  return (item.type ?? "unknown") as string;
}

// ─── Session ───────────────────────────────────────────────

/** An in-progress Codex agent session that streams events via the OpenAI Codex SDK. */
class CodexSession extends BaseAgentSession {
  public runtimeName: string = "codex";
  protected readonly runtimeDisplayName: string = "Codex";
  protected readonly noMessagesError: string =
    "Codex returned no messages. Check authentication: set OPENAI_API_KEY or CODEX_API_KEY.";

  private turnCount: number = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private codexInstance?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private thread?: any;
  /** The active `runStreamed()` result, kept for abort on kill. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private activeStream?: any;
  /** Cached thread options built during setupSdk(), reused for thread creation. */
  private threadOptions?: Record<string, unknown>;

  // ─── BaseAgentSession hooks ──────────────────────────────

  protected async setupSdk(): Promise<void> {
    const ts: () => string = () => new Date().toISOString();
    const { Codex } = await getCodexSdk();

    // ── Resolve working directory ──
    let workingDirectory: string | undefined;

    if (this.branch && this.worktreeBasePath) {
      try {
        const wt = await ensureWorktree(this.worktreeBasePath, this.branch);
        workingDirectory = wt.worktreePath;
        this.eventQueue.push({ type: "system", timestamp: ts(), content: `Worktree ready: ${wt.worktreePath} (branch: ${this.branch}, created: ${wt.created})` });
      } catch (wtErr) {
        this.eventQueue.push({ type: "system", timestamp: ts(), content: `Worktree setup skipped (${wtErr}), falling back to workspace` });
        const workspacePath = "/workspace";
        if (existsSync(workspacePath)) {
          workingDirectory = workspacePath;
        }
      }
    } else {
      const workspacePath = "/workspace";
      if (existsSync(workspacePath)) {
        workingDirectory = workspacePath;
      }
    }

    // ── Create Codex instance ──
    const codexOptions: Record<string, unknown> = {};

    const cliPath = process.env[ENV_CODEX_CLI_PATH];
    if (cliPath) {
      codexOptions.codexPathOverride = cliPath;
    }

    // API key: SDK reads OPENAI_API_KEY from env automatically,
    // but also support CODEX_API_KEY as an explicit override.
    const apiKey = process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY;
    if (apiKey) {
      codexOptions.apiKey = apiKey;
    }

    // Custom base URL for the OpenAI API
    const baseUrl = process.env.OPENAI_BASE_URL;
    if (baseUrl) {
      codexOptions.baseUrl = baseUrl;
    }

    // MCP servers — pass via config overrides, filtering disallowed tools
    const mcpConfig = resolveMcpServers(this.mcpServers);
    if (mcpConfig.servers) {
      codexOptions.config = { mcpServers: mcpConfig.servers };
    }

    this.codexInstance = new Codex(codexOptions);

    this.eventQueue.push({ type: "system", timestamp: ts(), content: "Codex instance created" });

    // ── Thread options ──
    this.threadOptions = {
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
    };

    if (this.model) {
      this.threadOptions.model = this.model;
    }

    if (workingDirectory) {
      this.threadOptions.workingDirectory = workingDirectory;
    }
  }

  protected async setupForResume(): Promise<void> {
    this.thread = this.codexInstance.resumeThread(this.resumeSessionId, this.threadOptions);
    this.eventQueue.push({
      type: "system",
      timestamp: new Date().toISOString(),
      content: `Codex thread resumed (id: ${this.resumeSessionId})`,
    });
  }

  protected async runInitialQuery(prompt: string): Promise<number> {
    this.thread = this.codexInstance.startThread(this.threadOptions);

    this.eventQueue.push({
      type: "system",
      timestamp: new Date().toISOString(),
      content: `Codex thread started (model: ${this.model || "default"})`,
    });

    return this.consumeStream(this.thread.runStreamed(prompt));
  }

  protected async executeFollowUp(text: string): Promise<void> {
    const streamResult = this.thread.runStreamed(text);
    await this.consumeStream(streamResult);
  }

  protected canAcceptInput(): boolean {
    return !!this.thread;
  }

  protected abortActive(): void {
    if (this.activeStream && typeof this.activeStream.abort === "function") {
      this.activeStream.abort();
    }
  }

  protected releaseResources(): void {
    this.activeStream = undefined;
    this.thread = undefined;
    this.codexInstance = undefined;
  }

  // ─── Codex-specific internals ────────────────────────────

  /**
   * Consume all events from a runStreamed() result, pushing them to the event queue.
   * Returns the number of meaningful messages processed.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async consumeStream(streamResult: any): Promise<number> {
    const ts: () => string = () => new Date().toISOString();
    this.activeStream = streamResult;
    let messageCount = 0;

    for await (const event of streamResult.events) {
      if (this.killed) {
        break;
      }

      const eventType = (event as Record<string, unknown>).type as string;

      switch (eventType) {
        case "thread.started": {
          const threadId = (event as Record<string, unknown>).thread_id as string | undefined;
          if (threadId) {
            this.runtimeSessionId = threadId;
          }
          this.eventQueue.push({
            type: "system",
            timestamp: ts(),
            content: `Codex thread initialized (id: ${this.runtimeSessionId})`,
          });
          break;
        }

        case "item.started": {
          const item = (event as Record<string, unknown>).item as Record<string, unknown> | undefined;
          if (!item) {
            break;
          }
          const type = itemType(item);

          if (type === "command_execution") {
            messageCount++;
            this.eventQueue.push({
              type: "tool_use",
              timestamp: ts(),
              content: JSON.stringify({ tool: "command_execution", args: { command: item.command || "" } }),
              raw: event,
            });
          } else if (type === "file_change") {
            messageCount++;
            this.eventQueue.push({
              type: "tool_use",
              timestamp: ts(),
              content: JSON.stringify({ tool: "file_change", args: { file: item.file || "", changes: item.changes || [] } }),
              raw: event,
            });
          } else if (type === "mcp_tool_call") {
            messageCount++;
            this.eventQueue.push({
              type: "tool_use",
              timestamp: ts(),
              content: JSON.stringify({ tool: `mcp__${item.serverName || "unknown"}__${item.toolName || "unknown"}`, args: item.arguments || {} }),
              raw: event,
            });
          }
          break;
        }

        case "item.completed": {
          const item = (event as Record<string, unknown>).item as Record<string, unknown> | undefined;
          if (!item) {
            break;
          }
          const type = itemType(item);

          if (type === "command_execution") {
            messageCount++;
            const output = (item.output ?? "") as string;
            const exitCode = item.exitCode as number | undefined;
            this.eventQueue.push({
              type: "tool_result",
              timestamp: ts(),
              content: exitCode !== undefined ? `[exit ${exitCode}] ${output}` : output,
              raw: event,
            });
          } else if (type === "file_change") {
            messageCount++;
            this.eventQueue.push({
              type: "tool_result",
              timestamp: ts(),
              content: JSON.stringify({ file: item.file, patch: item.patch || "", status: item.status || "completed" }),
              raw: event,
            });
          } else if (type === "agent_message") {
            messageCount++;
            const content = (item.content ?? "") as string;
            this.eventQueue.push({
              type: "text",
              timestamp: ts(),
              content,
              raw: event,
            });
          } else if (type === "mcp_tool_call") {
            messageCount++;
            const result = item.result as string | undefined;
            const error = item.error as string | undefined;
            this.eventQueue.push({
              type: "tool_result",
              timestamp: ts(),
              content: error || result || "",
              raw: event,
            });

            // Intercept finding tool calls from Grackle MCP server
            const toolName = (item.toolName ?? "") as string;
            const serverName = (item.serverName ?? "") as string;
            const qualifiedName = `mcp__${serverName}__${toolName}`;
            if (toolName === "post_finding" || qualifiedName === "mcp__grackle__post_finding") {
              const args = (item.arguments ?? {}) as Record<string, unknown>;
              this.eventQueue.push({
                type: "finding",
                timestamp: ts(),
                content: JSON.stringify({
                  title: args.title || "Untitled",
                  content: args.content || "",
                  category: args.category || "general",
                  tags: args.tags || [],
                }),
                raw: event,
              });
            }
          } else if (type === "reasoning") {
            messageCount++;
            const summary = (item.summary ?? item.text ?? "") as string;
            this.eventQueue.push({
              type: "text",
              timestamp: ts(),
              content: `[reasoning] ${summary}`,
              raw: event,
            });
          }
          break;
        }

        case "turn.completed": {
          this.turnCount++;
          if (this.maxTurns > 0 && this.turnCount >= this.maxTurns) {
            logger.info({ turnCount: this.turnCount, maxTurns: this.maxTurns }, "Codex max turns reached, stopping session");
            this.killed = true;
            this.status = "completed";
            this.eventQueue.push({ type: "status", timestamp: ts(), content: "completed" });
            if (this.activeStream && typeof this.activeStream.abort === "function") {
              this.activeStream.abort();
            }
          }
          break;
        }

        case "turn.failed": {
          const error = (event as Record<string, unknown>).error as Record<string, unknown> | undefined;
          const message = (error?.message ?? "Turn failed") as string;
          this.eventQueue.push({ type: "error", timestamp: ts(), content: message, raw: event });
          break;
        }

        case "error": {
          const message = ((event as Record<string, unknown>).message ?? "Unknown error") as string;
          this.eventQueue.push({ type: "error", timestamp: ts(), content: message, raw: event });
          break;
        }

        default:
          // Ignore unrecognised events (item.updated, turn.started, etc.)
          break;
      }
    }

    return messageCount;
  }
}

// ─── Runtime ───────────────────────────────────────────────

/** Runtime that delegates to the OpenAI Codex SDK (`@openai/codex-sdk`). */
export class CodexRuntime implements AgentRuntime {
  public name: string = "codex";

  /** Create and start a new Codex agent session. */
  public spawn(opts: SpawnOptions): CodexSession {
    return new CodexSession(
      opts.sessionId,
      opts.prompt,
      opts.model,
      opts.maxTurns,
      undefined,
      opts.branch,
      opts.worktreeBasePath,
      opts.systemContext,
      opts.mcpServers,
    );
  }

  /** Resume a previously suspended Codex session. */
  public resume(opts: ResumeOptions): CodexSession {
    return new CodexSession(
      opts.sessionId,
      "",
      "",
      0,
      opts.runtimeSessionId,
    );
  }
}
