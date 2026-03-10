import type { AgentRuntime, AgentSession, AgentEvent, SpawnOptions, ResumeOptions } from "./runtime.js";
import type { SessionStatus } from "@grackle-ai/common";
import { AsyncQueue } from "../utils/async-queue.js";
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
class CodexSession implements AgentSession {
  public id: string;
  public runtimeName: string = "codex";
  public runtimeSessionId: string;
  public status: SessionStatus = "running";

  private eventQueue: AsyncQueue<AgentEvent> = new AsyncQueue<AgentEvent>();
  private killed: boolean = false;
  private prompt: string;
  private model: string;
  private maxTurns: number;
  private turnCount: number = 0;
  private resumeSessionId?: string;
  private branch?: string;
  private worktreeBasePath?: string;
  private systemContext?: string;
  private mcpServers?: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private codexInstance?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private thread?: any;
  /** The active `runStreamed()` result, kept for abort on kill. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private activeStream?: any;

  public constructor(
    id: string,
    prompt: string,
    model: string,
    maxTurns: number,
    resumeSessionId?: string,
    branch?: string,
    worktreeBasePath?: string,
    systemContext?: string,
    mcpServers?: Record<string, unknown>,
  ) {
    this.id = id;
    this.prompt = prompt;
    this.model = model;
    this.maxTurns = maxTurns;
    this.resumeSessionId = resumeSessionId;
    this.branch = branch;
    this.worktreeBasePath = worktreeBasePath;
    this.systemContext = systemContext;
    this.mcpServers = mcpServers;
    this.runtimeSessionId = resumeSessionId || "";
  }

  public async *stream(): AsyncIterable<AgentEvent> {
    const ts: () => string = () => new Date().toISOString();

    yield { type: "system", timestamp: ts(), content: "Starting Codex runtime..." };

    // Drive the session in the background; events are pushed to the queue
    // and yielded from this generator.
    this.runSession().catch((err) => {
      this.eventQueue.push({ type: "error", timestamp: ts(), content: String(err) });
      this.eventQueue.push({ type: "status", timestamp: ts(), content: "failed" });
      this.status = "failed";
      this.eventQueue.close();
    });

    for await (const event of this.eventQueue) {
      yield event;
    }
  }

  /** Core session logic: create Codex instance, start/resume thread, stream events. */
  private async runSession(): Promise<void> {
    const ts: () => string = () => new Date().toISOString();

    try {
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
      const threadOptions: Record<string, unknown> = {
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
      };

      if (this.model) {
        threadOptions.model = this.model;
      }

      if (workingDirectory) {
        threadOptions.workingDirectory = workingDirectory;
      }

      // ── Create or resume thread ──
      if (this.resumeSessionId) {
        this.thread = this.codexInstance.resumeThread(this.resumeSessionId, threadOptions);
        this.eventQueue.push({
          type: "system",
          timestamp: ts(),
          content: `Codex thread resumed (id: ${this.resumeSessionId})`,
        });

        // Don't send a prompt on resume — wait for real user input via sendInput().
        this.status = "waiting_input";
        this.eventQueue.push({ type: "status", timestamp: ts(), content: "waiting_input" });
        return;
      }

      this.thread = this.codexInstance.startThread(threadOptions);

      this.eventQueue.push({
        type: "system",
        timestamp: ts(),
        content: `Codex thread started (model: ${this.model || "default"})`,
      });

      // ── Build final prompt ──
      const finalPrompt = this.systemContext
        ? `${this.systemContext}\n\n---\n\n${this.prompt}`
        : this.prompt;

      // ── Stream events ──
      const messageCount = await this.consumeStream(this.thread.runStreamed(finalPrompt));

      if (this.killed) {
        // Terminal state (e.g. maxTurns reached) — close the queue so stream() exits.
        this.cleanup();
        this.eventQueue.close();
        return;
      }

      if (messageCount === 0) {
        this.eventQueue.push({
          type: "error",
          timestamp: ts(),
          content: "Codex returned no messages. Check authentication: set OPENAI_API_KEY or CODEX_API_KEY.",
        });
      }

      // Session is idle — ready for follow-up input via sendInput().
      // The queue stays open so sendInput() can push more events.
      this.status = "waiting_input";
      this.eventQueue.push({ type: "status", timestamp: ts(), content: "waiting_input" });
    } catch (err) {
      this.status = "failed";
      this.eventQueue.push({ type: "error", timestamp: ts(), content: String(err) });
      this.eventQueue.push({ type: "status", timestamp: ts(), content: "failed" });
      this.cleanup();
      this.eventQueue.close();
    }
  }

  /**
   * Consume all events from a runStreamed() result, pushing them to the event queue.
   * Shared by both the initial run (runSession) and follow-up input (sendInput).
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

  /** Send follow-up input on the same Codex thread. */
  public sendInput(text: string): void {
    if (!this.thread || this.killed) {
      return;
    }
    const ts: () => string = () => new Date().toISOString();
    this.status = "running";
    this.eventQueue.push({ type: "status", timestamp: ts(), content: "running" });

    // Run follow-up on the existing thread using the shared event consumer.
    const streamResult = this.thread.runStreamed(text);
    this.consumeStream(streamResult)
      .then(() => {
        if (!this.killed) {
          this.status = "waiting_input";
          this.eventQueue.push({ type: "status", timestamp: ts(), content: "waiting_input" });
        }
      })
      .catch((err: unknown) => {
        this.eventQueue.push({ type: "error", timestamp: ts(), content: String(err) });
        logger.warn({ err }, "Failed to process follow-up input in Codex session");
      });
  }

  /** Release references to the Codex SDK instance and thread for garbage collection. */
  private cleanup(): void {
    this.activeStream = undefined;
    this.thread = undefined;
    this.codexInstance = undefined;
  }

  public kill(): void {
    this.killed = true;
    this.status = "killed";
    // Abort the active streamed run if one is in progress
    if (this.activeStream && typeof this.activeStream.abort === "function") {
      this.activeStream.abort();
    }
    this.cleanup();
    this.eventQueue.close();
  }
}

// ─── Runtime ───────────────────────────────────────────────

/** Runtime that delegates to the OpenAI Codex SDK (`@openai/codex-sdk`). */
export class CodexRuntime implements AgentRuntime {
  public name: string = "codex";

  /** Create and start a new Codex agent session. */
  public spawn(opts: SpawnOptions): AgentSession {
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
  public resume(opts: ResumeOptions): AgentSession {
    return new CodexSession(
      opts.sessionId,
      "",
      "",
      0,
      opts.runtimeSessionId,
    );
  }
}
