import type { AgentRuntime, AgentEvent, SpawnOptions, ResumeOptions } from "./runtime.js";
import { BaseAgentSession } from "./base-session.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { ensureWorktree } from "../worktree.js";

// Dynamic import — try @anthropic-ai/claude-agent-sdk first, then @anthropic-ai/claude-code
type QueryFn = (opts: Record<string, unknown>) => Promise<unknown>;
let queryFn: QueryFn | undefined = undefined;

async function getQuery(): Promise<QueryFn> {
  if (queryFn) return queryFn;
  // Try the agent SDK first (the proper library package)
  for (const pkg of ["@anthropic-ai/claude-agent-sdk", "@anthropic-ai/claude-code"]) {
    try {
      const mod = await import(pkg);
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

/** Path to the Grackle MCP server script bundled in the container image. */
const GRACKLE_MCP_SCRIPT: string = "/app/mcp-grackle/index.js";

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
          // Intercept finding tool calls and emit a "finding" event for the server
          const toolName = b.name as string;
          if (toolName === "mcp__grackle__post_finding" || toolName === "post_finding") {
            const args = b.input as Record<string, unknown> | undefined;
            if (args) {
              events.push({
                type: "finding",
                timestamp: ts,
                content: JSON.stringify({
                  title: args.title || "Untitled",
                  content: args.content || "",
                  category: args.category || "general",
                  tags: args.tags || [],
                }),
                raw: b,
              });
            }
          }
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
      return [{ type: "system", timestamp: ts, content: `Session initialized (${msg.model || "unknown model"})`, raw: msg }];
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

  // ─── BaseAgentSession hooks ──────────────────────────────

  protected async setupSdk(): Promise<void> {
    const ts: () => string = () => new Date().toISOString();

    // Determine cwd: worktree > /workspace > default
    let cwd: string | undefined;

    if (this.branch && this.worktreeBasePath) {
      try {
        const wt = await ensureWorktree(this.worktreeBasePath, this.branch);
        cwd = wt.worktreePath;
        this.eventQueue.push({ type: "system", timestamp: ts(), content: `Worktree ready: ${wt.worktreePath} (branch: ${this.branch}, created: ${wt.created})` });
      } catch (wtErr) {
        this.eventQueue.push({ type: "system", timestamp: ts(), content: `Worktree setup skipped (${wtErr}), falling back to workspace` });
        const workspacePath = "/workspace";
        if (existsSync(workspacePath)) {
          cwd = workspacePath;
        }
      }
    } else {
      const workspacePath = "/workspace";
      const useWorkspace = existsSync(workspacePath) &&
        readdirSync(workspacePath).length > 0;
      if (useWorkspace) {
        cwd = workspacePath;
      }
    }

    // SDK query() expects { prompt, options: { model, mcpServers, ... } }
    // Both permissionMode AND allowDangerouslySkipPermissions are needed for full bypass.
    // Built-in tools must also be in allowedTools explicitly — the SDK treats allowedTools
    // as a whitelist that overrides permissionMode for tool-level checks.
    const sdkOptions: Record<string, unknown> = {
      model: this.model,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      allowedTools: [...BUILTIN_TOOLS],
      ...(cwd ? { cwd } : {}),
    };

    // Load MCP server config from env var or SpawnOptions
    const mcpConfigPath = process.env.GRACKLE_MCP_CONFIG;
    if (mcpConfigPath && existsSync(mcpConfigPath)) {
      try {
        const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf8"));
        if (mcpConfig.mcpServers) {
          sdkOptions.mcpServers = mcpConfig.mcpServers;
        }
        if (Array.isArray(mcpConfig.disallowedTools)) {
          sdkOptions.disallowedTools = mcpConfig.disallowedTools;
        }
      } catch { /* ignore malformed config */ }
    }
    if (this.mcpServers) {
      sdkOptions.mcpServers = { ...(sdkOptions.mcpServers as Record<string, unknown> || {}), ...this.mcpServers };
    }

    // Auto-inject Grackle coordination MCP server if the script is bundled
    if (existsSync(GRACKLE_MCP_SCRIPT)) {
      const mcpServers = (sdkOptions.mcpServers || {}) as Record<string, unknown>;
      if (!mcpServers.grackle) {
        mcpServers.grackle = {
          command: "node",
          args: [GRACKLE_MCP_SCRIPT],
        };
        sdkOptions.mcpServers = mcpServers;
      }
    }

    // Add MCP tool patterns to allowedTools
    if (sdkOptions.mcpServers) {
      const mcpServerNames = Object.keys(sdkOptions.mcpServers as Record<string, unknown>);
      const mcpTools = mcpServerNames.map(name => `mcp__${name}__*`);
      (sdkOptions.allowedTools as string[]).push(...mcpTools);
    }

    if (this.maxTurns > 0) {
      sdkOptions.maxTurns = this.maxTurns;
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
    return this.consumeQuery(prompt, this.cachedSdkOptions!);
  }

  protected async executeFollowUp(text: string): Promise<void> {
    const resumeOptions = { ...this.cachedSdkOptions!, resume: this.runtimeSessionId };
    await this.consumeQuery(text, resumeOptions);
  }

  protected canAcceptInput(): boolean {
    return !!this.runtimeSessionId && !!this.cachedSdkOptions;
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
        this.runtimeSessionId = msg.session_id as string;
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

/** Runtime that delegates to the Claude Code SDK (`@anthropic-ai/claude-agent-sdk`). */
export class ClaudeCodeRuntime implements AgentRuntime {
  public name: string = "claude-code";

  public spawn(opts: SpawnOptions): ClaudeCodeSession {
    return new ClaudeCodeSession(
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

  /** Resume a previously suspended Claude Code session. */
  public resume(opts: ResumeOptions): ClaudeCodeSession {
    return new ClaudeCodeSession(
      opts.sessionId,
      "",
      "",
      0,
      opts.runtimeSessionId,
    );
  }
}
