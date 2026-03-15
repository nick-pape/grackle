import type { AgentEvent, AgentSession } from "./runtime.js";
import { BaseAgentSession } from "./base-session.js";
import { BaseAgentRuntime } from "./base-runtime.js";
import { resolveWorkingDirectory, resolveMcpServers, buildFindingEvent, buildSubtaskCreateEvent } from "./runtime-utils.js";

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
          // Intercept finding tool calls and emit a "finding" event for the server
          const toolName = b.name as string;
          if (toolName === "mcp__grackle__post_finding" || toolName === "post_finding") {
            const args = b.input as Record<string, unknown> | undefined;
            if (args) {
              events.push(buildFindingEvent(args, b));
            }
          }
          // Intercept subtask creation tool calls
          if (toolName === "mcp__grackle__create_subtask" || toolName === "create_subtask") {
            const args = b.input as Record<string, unknown> | undefined;
            if (args) {
              events.push(buildSubtaskCreateEvent(args, b));
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

  // ─── BaseAgentSession hooks ──────────────────────────────

  protected async setupSdk(): Promise<void> {
    // Determine cwd: worktree > /workspace > default
    const cwd = await resolveWorkingDirectory({
      branch: this.branch,
      worktreeBasePath: this.worktreeBasePath,
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
    // resolveMcpServers() adds a `tools` field to the grackle server entry (used by
    // Codex/Copilot SDKs). The Claude Agent SDK ignores unknown fields in MCP server
    // configs — it only reads `command`, `args`, and `env` to spawn the process.
    const mcpConfig = resolveMcpServers(this.mcpServers);
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

    if (this.maxTurns > 0) {
      sdkOptions.maxTurns = this.maxTurns;
    }

    // Pass through caller-provided hooks (e.g. Stop hooks for PR readiness).
    // Consumers supply their own hooks via SpawnOptions; the runtime does not
    // bundle any platform-specific hook implementations.
    if (this.hooks) {
      sdkOptions.hooks = this.hooks;
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
  ): AgentSession {
    return new ClaudeCodeSession(id, prompt, model, maxTurns, resumeSessionId, branch, worktreeBasePath, systemContext, mcpServers, hooks);
  }
}
