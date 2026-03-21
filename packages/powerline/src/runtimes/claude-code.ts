import type { AgentEvent, AgentSession } from "./runtime.js";
import { BaseAgentSession } from "./base-session.js";
import { BaseAgentRuntime } from "./base-runtime.js";
import { resolveWorkingDirectory, resolveMcpServers } from "./runtime-utils.js";
import { logger } from "../logger.js";
import { accessSync, mkdirSync, copyFileSync, constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

// Dynamic import — try @anthropic-ai/claude-agent-sdk first, then @anthropic-ai/claude-code
type QueryFn = (opts: Record<string, unknown>) => Promise<unknown>;
let queryFn: QueryFn | undefined = undefined;

async function getQuery(): Promise<QueryFn> {
  if (queryFn) return queryFn;
  // Try the agent SDK first (the proper library package)
  for (const pkg of ["@anthropic-ai/claude-agent-sdk", "@anthropic-ai/claude-code"]) {
    try {
      const mod = await import(pkg) as Record<string, unknown>;
      if (typeof mod.query === "function") {
        queryFn = mod.query as QueryFn;
        return queryFn;
      }
    } catch { /* try next */ }
  }
  throw new Error(
    "Claude Agent SDK not installed. Run: npm install @anthropic-ai/claude-agent-sdk"
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

  /** System context is injected via sdkOptions.systemPrompt, not prepended to the prompt. */
  protected override buildInitialPrompt(): string {
    return this.prompt;
  }

  // ─── BaseAgentSession hooks ──────────────────────────────

  protected async setupSdk(): Promise<void> {
    // Determine cwd: worktree > /workspace > default
    const cwd = await resolveWorkingDirectory({
      branch: this.branch,
      worktreeBasePath: this.worktreeBasePath,
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
            try { copyFileSync(join(configDir, file), join(fallbackRoot, file)); } catch { /* missing is fine */ }
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
    return this.consumeQuery(prompt, this.cachedSdkOptions!);
  }

  protected async executeFollowUp(text: string): Promise<void> {
    if (this.runtimeSessionId) {
      // Resume the existing conversation
      const resumeOptions = { ...this.cachedSdkOptions!, resume: this.runtimeSessionId };
      await this.consumeQuery(text, resumeOptions);
    } else {
      // No prior session (first message after empty-prompt start) — run as
      // initial query, which will establish the runtimeSessionId.
      await this.consumeQuery(text, this.cachedSdkOptions!);
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
  }

  // ─── Claude-specific internals ───────────────────────────

  /**
   * Consume all messages from a query() conversation, pushing events to the queue.
   * Returns the number of meaningful messages processed.
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
    hooks?: Record<string, unknown>,
    mcpBroker?: { url: string; token: string },
    useWorktrees?: boolean,
  ): AgentSession {
    return new ClaudeCodeSession(id, prompt, model, maxTurns, resumeSessionId, branch, worktreeBasePath, systemContext, mcpServers, hooks, mcpBroker, useWorktrees);
  }
}
