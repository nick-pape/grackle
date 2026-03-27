import type { AgentEvent, AgentSession, CreateSessionOptions } from "@grackle-ai/runtime-sdk";
import { BaseAgentSession, BaseAgentRuntime, AsyncQueue, resolveWorkingDirectory, resolveMcpServers, logger, ensureRuntimeInstalled, importFromRuntime } from "@grackle-ai/runtime-sdk";
import { accessSync, mkdirSync, copyFileSync, chmodSync, constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

// Dynamic import — try @anthropic-ai/claude-agent-sdk first, then @anthropic-ai/claude-code
type QueryFn = (opts: Record<string, unknown>) => Promise<unknown>;
let queryFn: QueryFn | undefined = undefined;

async function getQuery(): Promise<QueryFn> {
  if (queryFn) return queryFn;
  await ensureRuntimeInstalled("claude-code");
  // Try the agent SDK first (the proper library package)
  const errors: Array<{ package: string; error: unknown }> = [];
  for (const pkg of ["@anthropic-ai/claude-agent-sdk", "@anthropic-ai/claude-code"]) {
    try {
      const mod = await importFromRuntime<Record<string, unknown>>("claude-code", pkg);
      if (typeof mod.query === "function") {
        queryFn = mod.query as QueryFn;
        return queryFn;
      }
    } catch (err: unknown) {
      logger.warn({ err, package: pkg }, "Failed to import Claude runtime package");
      errors.push({ package: pkg, error: err });
    }
  }
  const details = errors
    .map((e) => `  ${e.package}: ${e.error instanceof Error ? e.error.message : String(e.error)}`)
    .join("\n");
  throw new Error(
    `Claude Agent SDK not installed or failed to load.\n${details}\n`
    + `Run: npm install @anthropic-ai/claude-agent-sdk`,
  );
}

/** @internal Map a raw Claude Agent SDK message to Grackle AgentEvent(s). Exported for testing. */
export function mapMessage(msg: Record<string, unknown>): AgentEvent[] {
  const ts = new Date().toISOString();
  const type = msg.type as string | undefined;

  // SDK streaming format: { type: "assistant", message: { role, content: [...] } }
  if (type === "assistant") {
    const inner = msg.message as Record<string, unknown> | undefined;
    const content = inner?.content;
    if (Array.isArray(content)) {
      const events: AgentEvent[] = [];
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === "text") {
          events.push({ type: "text", timestamp: ts, content: b.text as string, raw: b });
        } else if (b.type === "tool_use") {
          events.push({
            type: "tool_use",
            timestamp: ts,
            content: JSON.stringify({ tool: b.name, args: b.input }),
            raw: b,
          });
        } else if (b.type === "tool_result") {
          events.push({
            type: "tool_result",
            timestamp: ts,
            content: typeof b.content === "string" ? b.content : JSON.stringify(b.content),
            raw: b,
          });
        }
      }
      return events;
    }
    return [];
  }

  if (type === "result") {
    // result messages are handled in consumeQuery() for error checking; skip here
    return [];
  }

  if (type === "system") {
    const subtype = msg.subtype as string | undefined;
    if (subtype === "init") {
      return [{ type: "system", timestamp: ts, content: `Session initialized (${msg.model ? String(msg.model) : "unknown model"})`, raw: msg }];
    }
    return [];
  }

  return [];
}

/** Built-in Claude Code tools that must be explicitly listed in allowedTools. */
const BUILTIN_TOOLS: string[] = [
  "Bash", "Read", "Write", "Edit", "Glob", "Grep",
  "WebSearch", "WebFetch", "Task", "NotebookEdit",
];

/** Agent session backed by the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). */
class ClaudeCodeSession extends BaseAgentSession {
  public runtimeName: string = "claude-code";
  protected readonly runtimeDisplayName: string = "Claude Code";
  protected readonly noMessagesError: string =
    "Claude Code returned no messages. Is ANTHROPIC_API_KEY set or ~/.claude/.credentials.json mounted?";

  /** The active AbortController for the current query(), used to cancel on kill. */
  private activeAbort?: AbortController;
  /** Cached SDK options built once during setupSdk(), reused for follow-up queries. */
  private cachedSdkOptions?: Record<string, unknown>;

  // ─── Persistent process mode ────────────────────────────────
  // When active, ONE query() stays alive across multiple turns. The SDK's
  // AsyncIterable prompt mode keeps the process running and waiting for input.

  /** The persistent Query object (AsyncGenerator). Null when using resume-per-input. */
  private persistentQuery?: AsyncIterable<Record<string, unknown>> & { close?: () => void };
  /** Input queue fed to the SDK as AsyncIterable prompt — pushing yields new turns. */
  private promptQueue?: AsyncQueue<Record<string, unknown>>;
  /** Resolves when the current turn's response is complete (result message received). */
  private turnCompleteResolve?: () => void;

  /** System context is injected via sdkOptions.systemPrompt, not prepended to the prompt. */
  protected override buildInitialPrompt(): string {
    return this.prompt;
  }

  // ─── BaseAgentSession hooks ──────────────────────────────

  protected async setupSdk(): Promise<void> {
    // Determine cwd: worktree > /workspace > default
    const cwd = await resolveWorkingDirectory({
      branch: this.branch,
      workingDirectory: this.workingDirectory,
      useWorktrees: this.useWorktrees,
      eventQueue: this.eventQueue,
      requireNonEmpty: true,
    });

    // SDK query() expects { prompt, options: { model, mcpServers, ... } }
    // Both permissionMode AND allowDangerouslySkipPermissions are needed for full bypass.
    // Built-in tools must also be in allowedTools explicitly — the SDK treats allowedTools
    // as a whitelist that overrides permissionMode for tool-level checks.
    const sdkOptions: Record<string, unknown> = {
      model: this.model,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      allowedTools: [...BUILTIN_TOOLS],
      settingSources: ["project"],
      ...(cwd ? { cwd } : {}),
    };

    // Load MCP server config from env var or SpawnOptions.
    // resolveMcpServers() injects the Grackle MCP server entry. When broker config is
    // available, it uses HTTP (url + headers). The Claude Agent SDK supports both stdio
    // (command/args) and HTTP (url/headers) MCP server configs.
    const mcpConfig = resolveMcpServers(this.mcpServers, this.mcpBroker);
    if (mcpConfig.servers) {
      sdkOptions.mcpServers = mcpConfig.servers;
    }
    if (mcpConfig.disallowedTools.length > 0) {
      sdkOptions.disallowedTools = mcpConfig.disallowedTools;
    }

    // Add MCP tool patterns to allowedTools
    if (sdkOptions.mcpServers) {
      const mcpServerNames = Object.keys(sdkOptions.mcpServers as Record<string, unknown>);
      const mcpTools = mcpServerNames.map(name => `mcp__${name}__*`);
      (sdkOptions.allowedTools as string[]).push(...mcpTools);
    }

    // Inject system context via SDK-native systemPrompt (appended to Claude Code's built-in prompt)
    if (this.systemContext) {
      sdkOptions.systemPrompt = { preset: "claude_code" as const, append: this.systemContext };
    }

    if (this.maxTurns > 0) {
      sdkOptions.maxTurns = this.maxTurns;
    }

    // Pass through caller-provided hooks (e.g. Stop hooks for PR readiness).
    // Consumers supply their own hooks via SpawnOptions; the runtime does not
    // bundle any platform-specific hook implementations.
    if (this.hooks) {
      sdkOptions.hooks = this.hooks;
    }

    // Ensure the SDK session storage directory is writable so that multi-turn
    // conversations can be resumed. If ~/.claude is read-only (common in Docker
    // with bind-mounted host config), redirect session writes via CLAUDE_CONFIG_DIR.
    const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
    const projectsDir = join(configDir, "projects");
    // Attempt to create the projects directory if it does not exist yet so
    // that a missing dir (ENOENT) is not mistaken for a read-only filesystem.
    try { mkdirSync(projectsDir, { recursive: true }); } catch { /* handled below */ }
    if (!isDirectoryWritable(projectsDir)) {
      const fallbackRoot = join(tmpdir(), ".claude-sdk");
      const fallbackProjects = join(fallbackRoot, "projects");
      try {
        mkdirSync(fallbackProjects, { recursive: true });
        if (isDirectoryWritable(fallbackProjects)) {
          // Copy credential/config files so the SDK can authenticate from
          // the fallback directory (it reads .credentials.json from CLAUDE_CONFIG_DIR).
          for (const file of [".credentials.json", "settings.json", "settings.local.json"]) {
            try {
              copyFileSync(join(configDir, file), join(fallbackRoot, file));
              if (file === ".credentials.json") {
                chmodSync(join(fallbackRoot, file), 0o600);
              }
            } catch { /* missing is fine */ }
          }
          sdkOptions.env = { ...process.env, CLAUDE_CONFIG_DIR: fallbackRoot };
          logger.warn(
            { configDir, fallback: fallbackRoot },
            "Claude config directory is read-only — redirecting session writes to writable fallback",
          );
        } else {
          logger.warn(
            { configDir },
            "Claude config directory is read-only and no writable fallback available — multi-turn conversations will fail",
          );
        }
      } catch (err) {
        logger.warn(
          { configDir, err },
          "Failed to create writable fallback for Claude config — multi-turn conversations will fail",
        );
      }
    }

    this.cachedSdkOptions = sdkOptions;
  }

  protected async setupForResume(): Promise<void> {
    this.eventQueue.push({
      type: "system",
      timestamp: new Date().toISOString(),
      content: `Session resumed (id: ${this.resumeSessionId})`,
    });
  }

  protected async runInitialQuery(prompt: string): Promise<number> {
    if (!prompt) {
      // No initial prompt (e.g. System task) — skip the query and wait for
      // the first user message, which will be handled as an initial query
      // in executeFollowUp(). Return 1 so the base class does not emit the
      // misleading noMessagesError.
      return 1;
    }
    return this.startPersistentQuery(prompt);
  }

  protected async executeFollowUp(text: string): Promise<void> {
    if (this.promptQueue) {
      // Persistent mode: push into live AsyncIterable prompt queue
      await this.sendToPersistentQuery(text);
    } else if (this.runtimeSessionId) {
      // Resume-per-input fallback (resumed sessions, or persistent query failed to start)
      const resumeOptions = { ...this.cachedSdkOptions!, resume: this.runtimeSessionId };
      await this.consumeQuery(text, resumeOptions);
    } else {
      // No prior session (first message after empty-prompt start) — start persistent query
      await this.startPersistentQuery(text);
    }
  }

  protected canAcceptInput(): boolean {
    // Allow input even without runtimeSessionId — the first sendInput after
    // an empty-prompt start acts as the initial query.
    return !!this.cachedSdkOptions;
  }

  protected abortActive(): void {
    if (this.activeAbort) {
      this.activeAbort.abort();
    }
    // Close the prompt queue (ends the AsyncIterable → SDK exits)
    if (this.promptQueue) {
      this.promptQueue.close();
    }
    // Close the persistent query if it has a close method
    const pq = this.persistentQuery as { close?: () => void } | undefined;
    if (pq?.close) {
      pq.close();
    }
  }

  protected override releaseResources(): void {
    this.persistentQuery = undefined;
    this.promptQueue = undefined;
    this.turnCompleteResolve = undefined;
  }

  // ─── Persistent process mode ─────────────────────────────

  /**
   * Start a persistent query using AsyncIterable prompt mode. The SDK process
   * stays alive across multiple turns. Follow-up messages are sent via
   * the Query's streamInput() method.
   */
  private async startPersistentQuery(initialPrompt: string): Promise<number> {
    const query: QueryFn = await getQuery();
    const abort = new AbortController();
    this.activeAbort = abort;

    try {
      // Create a prompt queue — the SDK reads from this AsyncIterable and keeps
      // the process alive waiting for the next yield. Push messages to deliver them.
      this.promptQueue = new AsyncQueue<Record<string, unknown>>();

      // Push the initial user message
      this.promptQueue.push({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: initialPrompt }] },
      });

      // Start query with AsyncIterable prompt — process stays alive
      const queryInput: Record<string, unknown> = {
        prompt: this.promptQueue,
        options: { ...this.cachedSdkOptions!, abortController: abort },
      };
      const conversation = query(queryInput) as unknown as AsyncIterable<Record<string, unknown>> & {
        close?: () => void;
      };

      this.persistentQuery = conversation;

      // Start background consumer that reads ALL messages from the persistent query
      // and pushes them to the event queue. This runs for the lifetime of the query.
      this.consumePersistentStream(conversation).catch((err) => {
        if (!this.killed) {
          logger.warn({ err }, "Persistent query stream ended unexpectedly");
        }
        // Unblock any pending waitForTurnComplete so the input loop can recover
        this.turnCompleteResolve?.();
        // Clear persistent state so follow-ups fall back to resume-per-input
        this.promptQueue = undefined;
        this.persistentQuery = undefined;
      });

      // Wait for the first turn to complete (result message)
      return this.waitForTurnComplete();
    } catch (err) {
      // Persistent mode failed — fall back to resume-per-input
      logger.warn({ err }, "Persistent process mode failed — falling back to resume-per-input");
      this.promptQueue = undefined;
      this.persistentQuery = undefined;
      return this.consumeQuery(initialPrompt, this.cachedSdkOptions!);
    }
  }

  /**
   * Send a follow-up message to the persistent query by pushing into the prompt queue.
   * The SDK process picks it up immediately (no restart). Blocks until the turn completes.
   */
  private async sendToPersistentQuery(text: string): Promise<void> {
    if (!this.promptQueue) {
      throw new Error("No active prompt queue for persistent query");
    }

    // Push user message into the prompt queue — SDK reads it from the AsyncIterable
    this.promptQueue.push({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    });

    // Wait for this turn's response to complete
    await this.waitForTurnComplete();
  }

  /**
   * Background consumer for the persistent query stream. Reads messages
   * and pushes events to the queue for the lifetime of the query.
   * Signals turn completion via turnCompleteResolve when a result message arrives.
   */
  private async consumePersistentStream(
    conversation: AsyncIterable<Record<string, unknown>>,
  ): Promise<void> {
    const ts: () => string = () => new Date().toISOString();

    for await (const msg of conversation) {
      if (this.killed) {
        break;
      }

      // Extract session ID from system init message
      if (msg.type === "system" && msg.session_id) {
        const wasEmpty = !this.runtimeSessionId;
        this.runtimeSessionId = msg.session_id as string;
        if (wasEmpty) {
          this.eventQueue.push({ type: "runtime_session_id", timestamp: ts(), content: this.runtimeSessionId });
        }
      }

      // Check for result errors
      if (msg.type === "result" && msg.is_error) {
        const errorMsg = (msg.result as string) || "Claude Code returned an error";
        this.eventQueue.push({ type: "error", timestamp: ts(), content: errorMsg, raw: msg });
      }

      // Extract usage data from successful result messages
      if (msg.type === "result" && !msg.is_error) {
        const usage = msg.usage as {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        } | undefined;
        const costUsd = msg.total_cost_usd as number | undefined;
        if (usage !== undefined || costUsd !== undefined) {
          const totalInput = (usage?.input_tokens ?? 0)
            + (usage?.cache_read_input_tokens ?? 0)
            + (usage?.cache_creation_input_tokens ?? 0);
          this.eventQueue.push({
            type: "usage",
            timestamp: ts(),
            content: JSON.stringify({
              input_tokens: totalInput as number,
              output_tokens: (usage?.output_tokens ?? 0) as number,
              cost_usd: (costUsd ?? 0) as number,
            }),
          });
        }
      }

      // Map SDK messages to Grackle events
      const events = mapMessage(msg);
      for (const event of events) {
        this.eventQueue.push(event);
      }

      // Signal turn completion on result message
      if (msg.type === "result") {
        this.turnCompleteResolve?.();
      }
    }

    // Stream ended — resolve any pending turn wait and clear persistent state
    // so follow-ups fall back to resume-per-input instead of trying to push
    // into a dead prompt queue.
    this.turnCompleteResolve?.();
    this.promptQueue = undefined;
    this.persistentQuery = undefined;
  }

  /** Wait for the current turn to complete (result message received from SDK). */
  private waitForTurnComplete(): Promise<number> {
    return new Promise<number>((resolve) => {
      this.turnCompleteResolve = () => {
        this.turnCompleteResolve = undefined;
        resolve(1);
      };
    });
  }

  // ─── Resume-per-input fallback ──────────────────────────

  /**
   * Consume all messages from a query() conversation, pushing events to the queue.
   * Returns the number of meaningful messages processed.
   * Used as fallback when persistent mode is not available (resume-per-input).
   */
  private async consumeQuery(prompt: string, sdkOptions: Record<string, unknown>): Promise<number> {
    const query: QueryFn = await getQuery();
    const ts: () => string = () => new Date().toISOString();

    // Each query gets its own AbortController
    const abort = new AbortController();
    this.activeAbort = abort;

    const queryInput: Record<string, unknown> = {
      prompt,
      options: { ...sdkOptions, abortController: abort },
    };
    const conversation = query(queryInput) as unknown as AsyncIterable<Record<string, unknown>>;
    let messageCount = 0;

    for await (const msg of conversation) {
      if (this.killed) {
        break;
      }

      // Extract session ID from system init message
      if (msg.type === "system" && msg.session_id) {
        const wasEmpty = !this.runtimeSessionId;
        this.runtimeSessionId = msg.session_id as string;
        if (wasEmpty) {
          this.eventQueue.push({ type: "runtime_session_id", timestamp: ts(), content: this.runtimeSessionId });
        }
      }

      // Check for result errors (e.g. invalid API key)
      if (msg.type === "result" && msg.is_error) {
        const errorMsg = (msg.result as string) || "Claude Code returned an error";
        this.eventQueue.push({ type: "error", timestamp: ts(), content: errorMsg, raw: msg });
        continue;
      }

      // Extract usage data from successful result messages
      if (msg.type === "result" && !msg.is_error) {
        const usage = msg.usage as {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        } | undefined;
        const costUsd = msg.total_cost_usd as number | undefined;
        if (usage !== undefined || costUsd !== undefined) {
          // Total input includes non-cached + cache reads + cache creation
          const totalInput = (usage?.input_tokens ?? 0)
            + (usage?.cache_read_input_tokens ?? 0)
            + (usage?.cache_creation_input_tokens ?? 0);
          this.eventQueue.push({
            type: "usage",
            timestamp: ts(),
            content: JSON.stringify({
              input_tokens: totalInput as number,
              output_tokens: (usage?.output_tokens ?? 0) as number,
              cost_usd: (costUsd ?? 0) as number,
            }),
          });
        }
      }

      const events = mapMessage(msg);
      for (const event of events) {
        messageCount++;
        this.eventQueue.push(event);
      }
    }

    return messageCount;
  }
}

/** Check if a directory exists and is writable (with execute permission to create entries). */
function isDirectoryWritable(dir: string): boolean {
  try {
    // eslint-disable-next-line no-bitwise -- fs constants are bitmask flags
    accessSync(dir, fsConstants.W_OK | fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Runtime that delegates to the Claude Code SDK (`@anthropic-ai/claude-agent-sdk`). */
export class ClaudeCodeRuntime extends BaseAgentRuntime {
  public name: string = "claude-code";

  protected createSession(opts: CreateSessionOptions): AgentSession {
    return new ClaudeCodeSession(opts);
  }
}
