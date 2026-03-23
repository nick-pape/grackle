import type { AgentSession } from "./runtime.js";
import { BaseAgentSession } from "./base-session.js";
import { SESSION_STATUS } from "@grackle-ai/common";
import { BaseAgentRuntime } from "./base-runtime.js";
import { resolveWorkingDirectory, resolveMcpServers } from "./runtime-utils.js";
import { logger } from "../logger.js";
import { ensureRuntimeInstalled, importFromRuntime } from "../runtime-installer.js";

// ─── Environment variable names ────────────────────────────
// All configuration is driven by environment variables so the
// runtime works identically across Docker, local, SSH, etc.

/** Path to the Codex CLI binary. Overrides default PATH resolution. */
const ENV_CODEX_CLI_PATH: string = "CODEX_CLI_PATH";

// ─── Dynamic import ────────────────────────────────────────

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
        await ensureRuntimeInstalled("codex");
        const mod = await importFromRuntime<Record<string, unknown>>("codex", "@openai/codex-sdk");
        if (typeof mod.Codex !== "function") {
          throw new Error("Codex not found in @openai/codex-sdk");
        }
        return { Codex: mod.Codex as CodexSdkModule["Codex"] };
      } catch (err: unknown) {
        sdkPromise = undefined;
        logger.warn({ err }, "Failed to import Codex SDK");
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Codex SDK not installed or failed to load: ${detail}\n`
          + "Run: npm install @openai/codex-sdk\n"
          + "The Codex CLI must also be installed and available in PATH (or set CODEX_CLI_PATH).",
        );
      }
    })();
  }
  return sdkPromise;
}

// ─── Helpers ───────────────────────────────────────────────

// Re-export resolveMcpServers and ResolvedMcpConfig for backwards compatibility
export { resolveMcpServers } from "./runtime-utils.js";
export type { ResolvedMcpConfig } from "./runtime-utils.js";

/**
 * @internal Extract the `type` discriminator from a ThreadItem.
 *
 * ThreadItem is a union of objects like `{ type: "command_execution", ... }`.
 */
export function itemType(item: Record<string, unknown>): string {
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

  /** System context is injected via codexOptions.config.developer_instructions, not prepended to the prompt. */
  protected override buildInitialPrompt(): string {
    return this.prompt;
  }

  // ─── BaseAgentSession hooks ──────────────────────────────

  protected async setupSdk(): Promise<void> {
    const ts: () => string = () => new Date().toISOString();
    const { Codex } = await getCodexSdk();

    // ── Resolve working directory ──
    const workingDirectory = await resolveWorkingDirectory({
      branch: this.branch,
      worktreeBasePath: this.worktreeBasePath,
      useWorktrees: this.useWorktrees,
      eventQueue: this.eventQueue,
    });

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

    // MCP servers — pass via config overrides, filtering disallowed tools.
    // Codex CLI uses snake_case config keys and different field names than
    // the generic format returned by resolveMcpServers(), so we transform here.
    const mcpConfig = resolveMcpServers(this.mcpServers, this.mcpBroker);
    if (mcpConfig.servers) {
      const codexServers: Record<string, unknown> = {};
      for (const [name, config] of Object.entries(mcpConfig.servers)) {
        const cfg = config as Record<string, unknown>;
        if (cfg.type === "http" && typeof cfg.url === "string") {
          // HTTP MCP: Codex infers transport from `url` presence (no `type` field).
          // Static headers use `http_headers` instead of `headers`.
          const headers = cfg.headers as Record<string, string> | undefined;
          codexServers[name] = {
            url: cfg.url,
            ...(headers ? { http_headers: headers } : {}),
          };
        } else if (typeof cfg.command === "string") {
          // Stdio MCP: command/args/env are the same in Codex format
          codexServers[name] = cfg;
        } else {
          // Unknown format: pass through as-is
          codexServers[name] = cfg;
        }
      }
      codexOptions.config = { mcp_servers: codexServers };
    }

    // Inject system context via Codex developer_instructions config
    if (this.systemContext) {
      const existingConfig = (codexOptions.config ?? {}) as Record<string, unknown>;
      codexOptions.config = {
        ...existingConfig,
        developer_instructions: this.systemContext,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.codexInstance = new Codex(codexOptions);

    this.eventQueue.push({ type: "system", timestamp: ts(), content: "Codex instance created" });

    // ── Thread options ──
    this.threadOptions = {
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      skipGitRepoCheck: true,
    };

    if (this.model) {
      this.threadOptions.model = this.model;
    }

    if (workingDirectory) {
      this.threadOptions.workingDirectory = workingDirectory;
    }
  }

  protected async setupForResume(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.thread = this.codexInstance.resumeThread(this.resumeSessionId, this.threadOptions);
    this.eventQueue.push({
      type: "system",
      timestamp: new Date().toISOString(),
      content: `Codex thread resumed (id: ${this.resumeSessionId})`,
    });
  }

  protected async runInitialQuery(prompt: string): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.thread = this.codexInstance.startThread(this.threadOptions);

    this.eventQueue.push({
      type: "system",
      timestamp: new Date().toISOString(),
      content: `Codex thread started (model: ${this.model || "default"})`,
    });

    return this.consumeStream(await this.thread.runStreamed(prompt));
  }

  protected async executeFollowUp(text: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const streamResult = await this.thread.runStreamed(text);
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
            const wasEmpty = !this.runtimeSessionId;
            this.runtimeSessionId = threadId;
            if (wasEmpty) {
              this.eventQueue.push({ type: "runtime_session_id", timestamp: ts(), content: this.runtimeSessionId });
            }
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
            // Codex SDK: file_change has `changes` array with `{path, ...}` entries (no top-level `file`)
            const changes = (item.changes ?? []) as Array<Record<string, unknown>>;
            const filePaths = changes.map((c) => c.path ?? "").join(", ");
            this.eventQueue.push({
              type: "tool_use",
              timestamp: ts(),
              content: JSON.stringify({ tool: "file_change", args: { file: filePaths, changes } }),
              raw: event,
            });
          } else if (type === "mcp_tool_call") {
            messageCount++;
            // Codex SDK: uses `server` and `tool` (not `serverName`/`toolName`)
            this.eventQueue.push({
              type: "tool_use",
              timestamp: ts(),
              content: JSON.stringify({ tool: `mcp__${String(item.server || "unknown")}__${String(item.tool || "unknown")}`, args: item.arguments || {} }),
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
            // Codex SDK: `aggregated_output` (not `output`), `exit_code` (not `exitCode`)
            const output = (item.aggregated_output ?? "") as string;
            const exitCode = item.exit_code as number | undefined;
            this.eventQueue.push({
              type: "tool_result",
              timestamp: ts(),
              content: exitCode !== undefined ? `[exit ${exitCode}] ${output}` : output,
              raw: event,
            });
          } else if (type === "file_change") {
            messageCount++;
            // Codex SDK: file_change completed has `changes` array and `status` (no `file`/`patch`)
            const changes = (item.changes ?? []) as Array<Record<string, unknown>>;
            const filePaths = changes.map((c) => c.path ?? "").join(", ");
            this.eventQueue.push({
              type: "tool_result",
              timestamp: ts(),
              content: JSON.stringify({ file: filePaths, changes, status: item.status || "completed" }),
              raw: event,
            });
          } else if (type === "agent_message") {
            messageCount++;
            // Codex SDK: `text` (not `content`) for the message body
            const content = (item.text ?? "") as string;
            this.eventQueue.push({
              type: "text",
              timestamp: ts(),
              content,
              raw: event,
            });
          } else if (type === "mcp_tool_call") {
            messageCount++;
            // Codex SDK: `server`/`tool` (not `serverName`/`toolName`),
            // `result` is `{content, structured_content}`, `error` is `{message}`
            const resultObj = item.result as Record<string, unknown> | undefined;
            const errorObj = item.error as Record<string, unknown> | undefined;
            const resultStr = resultObj ? JSON.stringify(resultObj.content ?? resultObj) : "";
            const errorStr = errorObj
              ? (typeof errorObj.message === "string" ? errorObj.message : JSON.stringify(errorObj))
              : "";
            this.eventQueue.push({
              type: "tool_result",
              timestamp: ts(),
              content: errorStr || resultStr || "",
              raw: event,
            });
          } else if (type === "reasoning") {
            messageCount++;
            // Codex SDK: only `text` exists (no `summary` field)
            const text = (item.text ?? "") as string;
            this.eventQueue.push({
              type: "text",
              timestamp: ts(),
              content: `[reasoning] ${text}`,
              raw: event,
            });
          }
          break;
        }

        case "turn.completed": {
          // Extract usage from turn.completed event (per-turn, incremental)
          const usage = (event as Record<string, unknown>).usage as {
            input_tokens?: number;
            cached_input_tokens?: number;
            output_tokens?: number;
          } | undefined;
          if (usage) {
            const inputTokens = (usage.input_tokens ?? 0) + (usage.cached_input_tokens ?? 0);
            const outputTokens = usage.output_tokens ?? 0;
            if (inputTokens > 0 || outputTokens > 0) {
              this.eventQueue.push({
                type: "usage",
                timestamp: ts(),
                content: JSON.stringify({ input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: 0 }),
              });
            }
          }
          this.turnCount++;
          if (this.maxTurns > 0 && this.turnCount >= this.maxTurns) {
            logger.info({ turnCount: this.turnCount, maxTurns: this.maxTurns }, "Codex max turns reached — going idle");
            this.status = SESSION_STATUS.IDLE;
            this.eventQueue.push({ type: "status", timestamp: ts(), content: "waiting_input" });
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
export class CodexRuntime extends BaseAgentRuntime {
  public name: string = "codex";

  protected createSession(
    id: string,
    prompt: string,
    model: string,
    maxTurns: number,
    resumeSessionId?: string,
    branch?: string,
    worktreeBasePath?: string,
    systemContext?: string,
    mcpServers?: Record<string, unknown>,
    _hooks?: Record<string, unknown>, // Hooks not supported by Codex SDK — accepted for interface compatibility
    mcpBroker?: { url: string; token: string },
    useWorktrees?: boolean,
  ): AgentSession {
    return new CodexSession(id, prompt, model, maxTurns, resumeSessionId, branch, worktreeBasePath, systemContext, mcpServers, undefined, mcpBroker, useWorktrees);
  }
}
