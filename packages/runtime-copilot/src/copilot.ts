import type { AgentSession, CreateSessionOptions } from "@grackle-ai/runtime-sdk";
import { BaseAgentSession, BaseAgentRuntime, logger, ensureRuntimeInstalled, importFromRuntime } from "@grackle-ai/runtime-sdk";

// ─── Environment variable names ────────────────────────────
// All configuration is driven by environment variables so the
// runtime works identically across Docker, local, SSH, etc.

/** Path to the Copilot CLI binary. Defaults to "copilot" (resolved via PATH). */
const ENV_COPILOT_CLI_PATH: string = "COPILOT_CLI_PATH";
/** URL of an external Copilot CLI server (e.g. "localhost:4321"). Skips spawning a local CLI process. */
const ENV_COPILOT_CLI_URL: string = "COPILOT_CLI_URL";
/** JSON-encoded provider config for BYOK scenarios (type, baseUrl, apiKey, etc.). */
const ENV_COPILOT_PROVIDER_CONFIG: string = "COPILOT_PROVIDER_CONFIG";
/** GitHub token environment variables checked in priority order. */
const GITHUB_TOKEN_ENV_VARS: readonly string[] = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"];

// ─── Dynamic import ────────────────────────────────────────

/** Cached result of the Copilot SDK import. */
interface CopilotSdkModule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CopilotClient: new (opts?: Record<string, unknown>) => any;
  defineTool: (name: string, opts: Record<string, unknown>) => unknown;
  /** Pre-built permission handler that approves all tool invocations. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  approveAll: any;
}

/** Promise for the one-time SDK import, cached to avoid race conditions. */
let sdkPromise: Promise<CopilotSdkModule> | undefined;

/**
 * @internal For testing only — inject a mock SDK to bypass the dynamic import.
 * Pass `undefined` to reset the cache so the real import is attempted again.
 */
export function _setCopilotSdkForTesting(mock: CopilotSdkModule | undefined): void {
  sdkPromise = mock !== undefined ? Promise.resolve(mock) : undefined;
}

/** Dynamically import the Copilot SDK so the module is optional at install time. */
function getCopilotSdk(): Promise<CopilotSdkModule> {
  if (!sdkPromise) {
    sdkPromise = (async (): Promise<CopilotSdkModule> => {
      try {
        await ensureRuntimeInstalled("copilot");
        const mod = await importFromRuntime<Record<string, unknown>>("copilot", "@github/copilot-sdk");
        if (typeof mod.CopilotClient !== "function") {
          throw new Error("CopilotClient not found in @github/copilot-sdk");
        }
        return {
          CopilotClient: mod.CopilotClient as CopilotSdkModule["CopilotClient"],
          defineTool: mod.defineTool as CopilotSdkModule["defineTool"],
          approveAll: mod.approveAll,
        };
      } catch (err: unknown) {
        // Reset so the next attempt retries the import
        sdkPromise = undefined;
        logger.warn({ err }, "Failed to import Copilot SDK");
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Copilot SDK failed to load: ${detail}\n` +
          "Runtime packages are installed in ~/.grackle/runtimes/copilot/.\n" +
          "The Copilot CLI must also be installed and available in PATH (or set COPILOT_CLI_URL for an external server)."
        );
      }
    })();
  }
  return sdkPromise;
}

// ─── Helpers ───────────────────────────────────────────────

/** @internal Resolve a GitHub token from well-known environment variables. Returns undefined if none set. */
export function resolveGithubToken(): string | undefined {
  for (const varName of GITHUB_TOKEN_ENV_VARS) {
    const value = process.env[varName];
    if (value) {
      return value;
    }
  }
  return undefined;
}

/** @internal Parse BYOK provider config from environment variable. Returns undefined if not set or malformed. */
export function resolveProviderConfig(): Record<string, unknown> | undefined {
  const raw = process.env[ENV_COPILOT_PROVIDER_CONFIG];
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    logger.warn("Malformed COPILOT_PROVIDER_CONFIG environment variable, ignoring");
    return undefined;
  }
}

// Re-export resolveMcpServers so existing imports from this module continue to work.
// Note: the return type is now ResolvedMcpConfig (from runtime-utils) instead of Record<string, unknown> | undefined.
export { resolveMcpServers } from "@grackle-ai/runtime-sdk";

// ─── Session ───────────────────────────────────────────────

/**
 * An in-progress Copilot agent session that streams events via the Copilot SDK.
 *
 * @internal Exported only for unit testing of the kill/abort path. Do not use outside of tests.
 */
export class CopilotSession extends BaseAgentSession {
  public runtimeName: string = "copilot";
  protected readonly runtimeDisplayName: string = "Copilot";
  protected readonly noMessagesError: string =
    "Copilot returned no messages. Check authentication: set GITHUB_TOKEN, GH_TOKEN, or COPILOT_GITHUB_TOKEN (or use COPILOT_PROVIDER_CONFIG for BYOK).";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private copilotClient?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private copilotSession?: any;

  /** Callbacks for the current query's idle promise (reset per sendAndWaitForIdle call). */
  private idleResolve?: () => void;
  private idleReject?: (err: Error) => void;

  /** Count of meaningful messages in the current query (reset per sendAndWaitForIdle call). */
  private currentMessageCount: number = 0;

  /** System context is injected via sessionConfig.systemMessage, not prepended to the prompt. */
  protected override buildInitialPrompt(): string {
    return this.prompt;
  }

  // ─── BaseAgentSession hooks ──────────────────────────────

  protected async setupSdk(): Promise<void> {
    const ts = (): string => new Date().toISOString();
    const copilotSdk = await getCopilotSdk();

    // ── Resolve working directory ──
    const workingDirectory = await this.resolveWorkDir();

    // ── Create CopilotClient ──
    const clientOptions: Record<string, unknown> = {
      autoStart: false,
      useStdio: true,
    };

    const cliUrl = process.env[ENV_COPILOT_CLI_URL];
    if (cliUrl) {
      clientOptions.cliUrl = cliUrl;
      clientOptions.useStdio = false;
    }

    const cliPath = process.env[ENV_COPILOT_CLI_PATH];
    if (cliPath && !cliUrl) {
      clientOptions.cliPath = cliPath;
    }

    const githubToken = resolveGithubToken();
    if (githubToken) {
      clientOptions.githubToken = githubToken;
      clientOptions.useLoggedInUser = false;
    } else {
      clientOptions.useLoggedInUser = true;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.copilotClient = new copilotSdk.CopilotClient(clientOptions);
    await this.copilotClient.start();

    this.eventQueue.push({ type: "system", timestamp: ts(), content: "Copilot CLI server connected" });

    // ── Build session config ──
    // onPermissionRequest is REQUIRED by the SDK — use approveAll for headless operation
    const sessionConfig: Record<string, unknown> = {
      model: this.model,
      streaming: true,
      onPermissionRequest: copilotSdk.approveAll,
    };

    // Inject system context via SDK-native systemMessage
    if (this.systemContext) {
      sessionConfig.systemMessage = { mode: "append" as const, content: this.systemContext };
    }

    // BYOK provider config
    const providerConfig = resolveProviderConfig();
    if (providerConfig) {
      sessionConfig.provider = providerConfig;
    }

    // MCP servers
    const mcpConfig = this.resolveMcp();
    if (mcpConfig.servers) {
      sessionConfig.mcpServers = mcpConfig.servers;
    }

    // Note: Copilot SDK does not have a maxTurns config option.
    // The session runs until idle. Log if the caller requested a limit.
    if (this.maxTurns > 0) {
      logger.info({ maxTurns: this.maxTurns }, "maxTurns requested but Copilot SDK does not support turn limits — session will run until idle");
    }

    // Working directory (SDK uses "workingDirectory", not "cwd")
    if (workingDirectory) {
      sessionConfig.workingDirectory = workingDirectory;
    }

    // ── Create or resume session ──
    if (this.resumeSessionId) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      this.copilotSession = await this.copilotClient.resumeSession(this.resumeSessionId, sessionConfig);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      this.copilotSession = await this.copilotClient.createSession(sessionConfig);
    }

    this.setRuntimeSessionId((this.copilotSession.sessionId as string | undefined) || this.id);

    this.eventQueue.push({
      type: "system",
      timestamp: ts(),
      content: `Copilot session created (model: ${this.model}, session: ${this.runtimeSessionId})`,
    });

    // ── Subscribe to events (once; persist for the session lifetime) ──
    // All SessionEvent objects have shape: { id, timestamp, parentId, type, data: { ... } }

    // Stream text deltas — data: { messageId, deltaContent, parentToolCallId? }
    this.copilotSession.on("assistant.message_delta", (event: Record<string, unknown>) => {
      if (this.killed) { return; }
      const data = event.data as Record<string, unknown> | undefined;
      const deltaContent = (data?.deltaContent ?? "") as string;
      if (deltaContent) {
        this.currentMessageCount++;
        this.eventQueue.push({
          type: "text",
          timestamp: ts(),
          content: deltaContent,
          raw: event,
        });
      }
    });

    // Final assistant message — data: { messageId, content, toolRequests?, ... }
    // We stream via deltas above, so this is mainly for bookkeeping.
    this.copilotSession.on("assistant.message", (event: Record<string, unknown>) => {
      if (this.killed) { return; }
      const data = event.data as Record<string, unknown> | undefined;
      if (data?.content) {
        this.currentMessageCount++;
        // Deltas already streamed the text incrementally; no need to re-emit.
      }
    });

    // Tool execution start — data: { toolCallId, toolName, arguments?, mcpServerName?, ... }
    this.copilotSession.on("tool.execution_start", (event: Record<string, unknown>) => {
      if (this.killed) { return; }
      const data = event.data as Record<string, unknown> | undefined;
      const toolName = (data?.toolName ?? "unknown") as string;
      const toolArgs = data?.arguments ?? {};
      this.currentMessageCount++;
      this.eventQueue.push({
        type: "tool_use",
        timestamp: ts(),
        content: JSON.stringify({ tool: toolName, args: toolArgs }),
        raw: event,
      });
    });

    // Tool execution complete — data: { toolCallId, success, result?, error?, ... }
    this.copilotSession.on("tool.execution_complete", (event: Record<string, unknown>) => {
      if (this.killed) { return; }
      const data = event.data as Record<string, unknown> | undefined;
      // result is a ToolResultObject { textResultForLlm, resultType, ... } or undefined
      const result = data?.result as Record<string, unknown> | string | undefined;
      const error = data?.error as string | undefined;
      let output: string;
      if (error) {
        output = error;
      } else if (result === undefined) {
        output = "";
      } else if (typeof result === "string") {
        output = result;
      } else if (typeof result === "object" && result.textResultForLlm) {
        output = result.textResultForLlm as string;
      } else {
        output = JSON.stringify(result);
      }
      this.currentMessageCount++;
      this.eventQueue.push({
        type: "tool_result",
        timestamp: ts(),
        content: output,
        raw: event,
      });
    });

    // Session idle = query completed (ephemeral event, data is empty)
    this.copilotSession.on("session.idle", () => {
      this.idleResolve?.();
    });

    // Usage data — fires after each LLM API call with per-request token counts
    // Note: Copilot SDK's `cost` field is in nano-AIU (GitHub billing units), not USD.
    // We emit tokens only; cost_usd is 0 until a conversion rate is available.
    this.copilotSession.on("assistant.usage", (event: Record<string, unknown>) => {
      if (this.killed) { return; }
      const data = event.data as Record<string, unknown> | undefined;
      const inputTokens = (Number(data?.inputTokens) || 0)
        + (Number(data?.cacheReadTokens) || 0)
        + (Number(data?.cacheWriteTokens) || 0);
      const outputTokens = Number(data?.outputTokens) || 0;
      this.pushUsageEvent(inputTokens, outputTokens, 0);
    });

    // Session error — data: { errorType, message, stack?, statusCode? }
    this.copilotSession.on("session.error", (event: Record<string, unknown>) => {
      const data = event.data as Record<string, unknown> | undefined;
      const message = (data?.message ?? String(event)) as string;
      this.eventQueue.push({ type: "error", timestamp: ts(), content: message, raw: event });
      this.idleReject?.(new Error(message));
    });
  }

  protected async runInitialQuery(prompt: string): Promise<number> {
    return this.sendAndWaitForIdle(prompt);
  }

  protected async executeFollowUp(text: string): Promise<void> {
    await this.sendAndWaitForIdle(text);
  }

  protected canAcceptInput(): boolean {
    return !!this.copilotSession;
  }

  protected abortActive(): void {
    if (this.copilotSession) {
      try {
        // abort() may be synchronous (returning void) or asynchronous (returning a Promise).
        // Wrapping in Promise.resolve() handles both cases safely: if abort() returns void,
        // Promise.resolve(undefined) is a no-op resolved promise; if it returns a rejected
        // promise, the .catch() suppresses the error on a best-effort basis.
        Promise.resolve(this.copilotSession.abort() as Promise<void> | void).catch(() => {});
      } catch {
        // Suppress synchronous throws from abort() so kill() always completes cleanly.
      }
    }
  }

  protected releaseResources(): void {
    this.cleanup().catch(() => {});
  }

  // ─── Copilot-specific internals ───────────────────────────

  /**
   * Send a prompt to the Copilot session and wait for it to go idle.
   * Resets the message counter for this query. Returns the message count.
   */
  private async sendAndWaitForIdle(prompt: string): Promise<number> {
    this.currentMessageCount = 0;

    const idlePromise = new Promise<void>((resolve, reject) => {
      this.idleResolve = resolve;
      this.idleReject = reject;
    });

    await this.copilotSession.send({ prompt });
    await idlePromise;

    return this.currentMessageCount;
  }

  /** Tear down the Copilot session and client. */
  private async cleanup(): Promise<void> {
    try {
      if (this.copilotSession) {
        await this.copilotSession.destroy();
      }
    } catch { /* best-effort */ }
    try {
      if (this.copilotClient) {
        // stop() returns Promise<Error[]> — log any errors but don't throw
        const errors = await this.copilotClient.stop() as unknown[];
        if (Array.isArray(errors) && errors.length > 0) {
          logger.warn({ errors: errors.map(String) }, "Errors during Copilot client shutdown");
        }
      }
    } catch { /* best-effort */ }
  }
}

// ─── Runtime ───────────────────────────────────────────────

/** Runtime that delegates to the GitHub Copilot SDK (`@github/copilot-sdk`). */
export class CopilotRuntime extends BaseAgentRuntime {
  public name: string = "copilot";
  protected resumePrompt: string = "(resumed)";

  protected createSession(opts: CreateSessionOptions): AgentSession {
    return new CopilotSession({ ...opts, hooks: undefined });
  }
}
