import type { AgentSession } from "./runtime.js";
import { BaseAgentSession } from "./base-session.js";
import { BaseAgentRuntime } from "./base-runtime.js";
import { resolveWorkingDirectory, resolveMcpServers, buildFindingEvent } from "./runtime-utils.js";
import { logger } from "../logger.js";

// ─── Environment variable names ────────────────────────────
// All configuration is driven by environment variables so the
// runtime works identically across Docker, local, SSH, etc.

/** Path to the Codex CLI binary. Overrides default PATH resolution. */
const ENV_CODEX_CLI_PATH: string = "CODEX_CLI_PATH";

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

  // ─── BaseAgentSession hooks ──────────────────────────────

  protected async setupSdk(): Promise<void> {
    const ts: () => string = () => new Date().toISOString();
    const { Codex } = await getCodexSdk();

    // ── Resolve working directory ──
    const workingDirectory = await resolveWorkingDirectory({
      branch: this.branch,
      worktreeBasePath: this.worktreeBasePath,
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

    return this.consumeStream(await this.thread.runStreamed(prompt));
  }

  protected async executeFollowUp(text: string): Promise<void> {
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
              this.eventQueue.push(buildFindingEvent(args, event));
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
  ): AgentSession {
    return new CodexSession(id, prompt, model, maxTurns, resumeSessionId, branch, worktreeBasePath, systemContext, mcpServers);
  }
}
