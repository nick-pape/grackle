import type { AgentSession, AgentEvent } from "./runtime.js";
import { BaseAgentSession } from "./base-session.js";
import { BaseAgentRuntime } from "./base-runtime.js";
import { AsyncQueue } from "../utils/async-queue.js";
import { resolveWorkingDirectory, resolveMcpServers, buildFindingEvent, buildSubtaskCreateEvent } from "./runtime-utils.js";
import { logger } from "../logger.js";

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/** Dynamically import the Copilot SDK so the module is optional at install time. */
function getCopilotSdk(): Promise<CopilotSdkModule> {
  if (!sdkPromise) {
    sdkPromise = (async (): Promise<CopilotSdkModule> => {
      try {
        const mod = await import("@github/copilot-sdk");
        if (typeof mod.CopilotClient !== "function") {
          throw new Error("CopilotClient not found in @github/copilot-sdk");
        }
        return {
          CopilotClient: mod.CopilotClient,
          defineTool: mod.defineTool as CopilotSdkModule["defineTool"],
          approveAll: mod.approveAll,
        };
      } catch {
        // Reset so the next attempt retries the import
        sdkPromise = undefined;
        throw new Error(
          "Copilot SDK not installed. Run: npm install @github/copilot-sdk\n" +
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
export { resolveMcpServers } from "./runtime-utils.js";

/** @internal Build a `post_finding` tool definition for the Copilot session, so findings can be emitted. */
export function buildFindingTool(defineTool: (name: string, opts: Record<string, unknown>) => unknown, eventQueue: AsyncQueue<AgentEvent>): unknown {
  return defineTool("post_finding", {
    description: "Post a finding discovered during the task. Findings are observations about code, architecture, bugs, patterns, or decisions.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title for the finding" },
        content: { type: "string", description: "Detailed content/body of the finding" },
        category: { type: "string", description: "Category: architecture, api, bug, decision, dependency, pattern, or general" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
      },
      required: ["title", "content"],
    },
    handler: async (args: Record<string, unknown>) => {
      eventQueue.push(buildFindingEvent(args, args));
      return { status: "finding_posted", title: args.title };
    },
  });
}

/** @internal Build a `create_subtask` tool definition for the Copilot session, so subtask creation events can be emitted. */
export function buildSubtaskCreateTool(defineTool: (name: string, opts: Record<string, unknown>) => unknown, eventQueue: AsyncQueue<AgentEvent>): unknown {
  return defineTool("create_subtask", {
    description: "Delegate work to another agent by creating a child task. Use this when work is too large or complex for you to complete alone.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title for the subtask" },
        description: { type: "string", description: "Detailed description of what to do" },
        local_id: { type: "string", description: "Local ID for referencing in depends_on" },
        depends_on: { type: "array", items: { type: "string" }, description: "Local IDs of sibling subtasks that must finish first" },
        can_decompose: { type: "boolean", description: "Whether the subtask may create further subtasks" },
      },
      required: ["title", "description"],
    },
    handler: async (args: Record<string, unknown>) => {
      eventQueue.push(buildSubtaskCreateEvent(args, args));
      const result: Record<string, unknown> = { status: "subtask_queued", title: args.title };
      if (args.local_id) {
        result.local_id = args.local_id;
      }
      return result;
    },
  });
}

// ─── Session ───────────────────────────────────────────────

/** An in-progress Copilot agent session that streams events via the Copilot SDK. */
class CopilotSession extends BaseAgentSession {
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

  // ─── BaseAgentSession hooks ──────────────────────────────

  protected async setupSdk(): Promise<void> {
    const ts = (): string => new Date().toISOString();
    const { CopilotClient, defineTool, approveAll } = await getCopilotSdk();

    // ── Resolve working directory ──
    const workingDirectory = await resolveWorkingDirectory({
      branch: this.branch,
      worktreeBasePath: this.worktreeBasePath,
      eventQueue: this.eventQueue,
    });

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

    this.copilotClient = new CopilotClient(clientOptions);
    await this.copilotClient.start();

    this.eventQueue.push({ type: "system", timestamp: ts(), content: "Copilot CLI server connected" });

    // ── Build session config ──
    // onPermissionRequest is REQUIRED by the SDK — use approveAll for headless operation
    const sessionConfig: Record<string, unknown> = {
      model: this.model,
      streaming: true,
      onPermissionRequest: approveAll,
    };

    // BYOK provider config
    const providerConfig = resolveProviderConfig();
    if (providerConfig) {
      sessionConfig.provider = providerConfig;
    }

    // MCP servers
    const mcpConfig = resolveMcpServers(this.mcpServers);
    if (mcpConfig.servers) {
      sessionConfig.mcpServers = mcpConfig.servers;
    }

    // Note: Copilot SDK does not have a maxTurns config option.
    // The session runs until idle. Log if the caller requested a limit.
    if (this.maxTurns > 0) {
      logger.info({ maxTurns: this.maxTurns }, "maxTurns requested but Copilot SDK does not support turn limits — session will run until idle");
    }

    // Custom tools: inject post_finding and create_subtask tools
    const tools: unknown[] = [];
    if (defineTool) {
      tools.push(buildFindingTool(defineTool, this.eventQueue));
      tools.push(buildSubtaskCreateTool(defineTool, this.eventQueue));
    }
    if (tools.length > 0) {
      sessionConfig.tools = tools;
    }

    // Working directory (SDK uses "workingDirectory", not "cwd")
    if (workingDirectory) {
      sessionConfig.workingDirectory = workingDirectory;
    }

    // ── Create or resume session ──
    if (this.resumeSessionId) {
      this.copilotSession = await this.copilotClient.resumeSession(this.resumeSessionId, sessionConfig);
    } else {
      this.copilotSession = await this.copilotClient.createSession(sessionConfig);
    }

    this.runtimeSessionId = this.copilotSession.sessionId || this.id;

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

      // Intercept MCP finding tool calls (custom tool handler covers non-MCP path)
      if (toolName === "mcp__grackle__post_finding") {
        const args = toolArgs as Record<string, unknown>;
        this.eventQueue.push(buildFindingEvent(args, event));
      }
      // Intercept MCP subtask creation tool calls (custom tool handler covers non-MCP path)
      if (toolName === "mcp__grackle__create_subtask") {
        const args = toolArgs as Record<string, unknown>;
        this.eventQueue.push(buildSubtaskCreateEvent(args, event));
      }
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

    // Session error — data: { errorType, message, stack?, statusCode? }
    this.copilotSession.on("session.error", (event: Record<string, unknown>) => {
      const data = event.data as Record<string, unknown> | undefined;
      const message = (data?.message ?? String(event)) as string;
      this.eventQueue.push({ type: "error", timestamp: ts(), content: message, raw: event });
      this.idleReject?.(new Error(message));
    });
  }

  protected async setupForResume(): Promise<void> {
    this.eventQueue.push({
      type: "system",
      timestamp: new Date().toISOString(),
      content: `Session resumed (id: ${this.resumeSessionId})`,
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
    // Reject any pending sendAndWaitForIdle promise so it doesn't hang.
    if (this.idleReject) {
      logger.info({ sessionId: this.id }, "Copilot abortActive: rejecting pending idle promise");
      this.idleReject(new Error("Session killed"));
      this.idleResolve = undefined;
      this.idleReject = undefined;
    }

    if (this.copilotSession) {
      const hasAbort = typeof this.copilotSession.abort === "function";
      logger.info({ sessionId: this.id, hasAbortMethod: hasAbort }, "Copilot abortActive: aborting SDK session");
      try {
        // abort() may be synchronous (returning void) or asynchronous (returning a
        // promise). Guard against both cases so a missing .catch on undefined or a
        // synchronous throw does not bubble up as an internal error.
        const result: unknown = hasAbort
          ? this.copilotSession.abort()
          : undefined;
        if (result && typeof (result as Promise<unknown>).catch === "function") {
          (result as Promise<unknown>).catch((abortErr: unknown) => {
            logger.warn({ err: abortErr, sessionId: this.id }, "Copilot SDK abort() promise rejected");
          });
        }
      } catch (err) {
        logger.warn({ err, sessionId: this.id }, "Copilot SDK abort() threw synchronously");
      }
    } else {
      logger.info({ sessionId: this.id }, "Copilot abortActive: no SDK session to abort");
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
    logger.info({ sessionId: this.id }, "Copilot cleanup started");
    try {
      if (this.copilotSession) {
        logger.info({ sessionId: this.id }, "Destroying Copilot SDK session");
        await this.copilotSession.destroy();
        logger.info({ sessionId: this.id }, "Copilot SDK session destroyed");
      }
    } catch (err) {
      logger.warn({ err, sessionId: this.id }, "Error destroying Copilot SDK session");
    }
    try {
      if (this.copilotClient) {
        logger.info({ sessionId: this.id }, "Stopping Copilot CLI client");
        const errors = await this.copilotClient.stop();
        if (Array.isArray(errors) && errors.length > 0) {
          logger.warn({ errors: errors.map(String), sessionId: this.id }, "Errors during Copilot client shutdown");
        } else {
          logger.info({ sessionId: this.id }, "Copilot CLI client stopped");
        }
      }
    } catch (err) {
      logger.warn({ err, sessionId: this.id }, "Error stopping Copilot CLI client");
    }
    logger.info({ sessionId: this.id }, "Copilot cleanup finished");
  }
}

// ─── Runtime ───────────────────────────────────────────────

/** Runtime that delegates to the GitHub Copilot SDK (`@github/copilot-sdk`). */
export class CopilotRuntime extends BaseAgentRuntime {
  public name: string = "copilot";
  protected resumePrompt: string = "(resumed)";

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
    _hooks?: Record<string, unknown>, // Hooks not supported by Copilot SDK — accepted for interface compatibility
  ): AgentSession {
    return new CopilotSession(id, prompt, model, maxTurns, resumeSessionId, branch, worktreeBasePath, systemContext, mcpServers);
  }
}
