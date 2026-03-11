import type { AgentEvent, AgentSession } from "./runtime.js";
import { existsSync } from "node:fs";
import { BaseAgentSession } from "./base-session.js";
import { BaseAgentRuntime } from "./base-runtime.js";
import { resolveWorkingDirectory, resolveMcpServers, buildFindingEvent, GRACKLE_MCP_SCRIPT } from "./runtime-utils.js";
import { logger } from "../logger.js";

// Dynamic import — try @anthropic-ai/claude-agent-sdk first, then @anthropic-ai/claude-code
type QueryFn = (opts: Record<string, unknown>) => Promise<unknown>;
type ToolFn = (name: string, description: string, schema: Record<string, unknown>, handler: (args: Record<string, unknown>) => Promise<unknown>) => unknown;
type CreateSdkMcpServerFn = (opts: Record<string, unknown>) => unknown;
let queryFn: QueryFn | undefined = undefined;
let toolFn: ToolFn | undefined = undefined;
let createSdkMcpServerFn: CreateSdkMcpServerFn | undefined = undefined;

async function getQuery(): Promise<QueryFn> {
  if (queryFn) return queryFn;
  // Try the agent SDK first (the proper library package)
  for (const pkg of ["@anthropic-ai/claude-agent-sdk", "@anthropic-ai/claude-code"]) {
    try {
      const mod = await import(pkg);
      if (typeof mod.query === "function") {
        queryFn = mod.query as QueryFn;
        // Also cache tool() and createSdkMcpServer() if available
        if (typeof mod.tool === "function") {
          toolFn = mod.tool as ToolFn;
        }
        if (typeof mod.createSdkMcpServer === "function") {
          createSdkMcpServerFn = mod.createSdkMcpServer as CreateSdkMcpServerFn;
        }
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

/**
 * Create an in-process Grackle MCP server using the Claude Agent SDK's `createSdkMcpServer`.
 *
 * This is used as a fallback when the external MCP script (`/app/mcp-grackle/index.js`)
 * is not available (e.g. in codespace or local environments). The `post_finding` tool
 * call is intercepted by `mapMessage()` to emit a "finding" event, so the in-process
 * handler just returns a confirmation message.
 *
 * Returns undefined if the SDK does not expose `tool` or `createSdkMcpServer`.
 */
async function createInProcessGrackleMcpServer(): Promise<unknown | undefined> {
  // Ensure the SDK functions have been cached by getQuery()
  await getQuery();

  if (!toolFn || !createSdkMcpServerFn) {
    logger.warn("Claude Agent SDK does not expose tool() or createSdkMcpServer(); cannot create in-process finding server");
    return undefined;
  }

  // Dynamically import zod — the Claude Agent SDK lists it as a dependency,
  // so it is available at runtime even though powerline does not declare it directly.
  // Use a variable-based import path to prevent TypeScript from resolving the module.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let z: any;
  try {
    const zodPackage = "zod";
    const zodModule = await import(/* webpackIgnore: true */ zodPackage);
    z = zodModule.z || zodModule;
  } catch {
    logger.warn("Could not import zod for in-process finding server; post_finding will not be available");
    return undefined;
  }

  const postFindingTool = toolFn(
    "post_finding",
    "Share a discovery with other agents working on this project. Use this for architecture decisions, bugs found, API patterns, dependency notes, or any insight that would help other agents.",
    {
      title: (z.string as () => unknown)(),
      content: (z.string as () => unknown)(),
      category: z.enum(["architecture", "api", "bug", "decision", "dependency", "pattern", "general"]).optional(),
      tags: z.array(z.string()).optional(),
    } as Record<string, unknown>,
    async (args: Record<string, unknown>) => {
      const category = (args.category as string) || "general";
      const tags = (args.tags as string[]) || [];
      const tagString = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
      return {
        content: [
          {
            type: "text" as const,
            text: `Finding posted (${category}${tagString}): ${args.title as string}`,
          },
        ],
      };
    },
  );

  return createSdkMcpServerFn({
    name: "grackle",
    version: "0.1.0",
    tools: [postFindingTool],
  });
}

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

    // When the external Grackle MCP script is not available (non-Docker environments
    // like codespaces), create an in-process SDK MCP server so agents can still call
    // post_finding. The tool call is intercepted by mapMessage() to emit finding events.
    const servers = (sdkOptions.mcpServers || {}) as Record<string, unknown>;
    if (!servers.grackle && !existsSync(GRACKLE_MCP_SCRIPT)) {
      const inProcessServer = await createInProcessGrackleMcpServer();
      if (inProcessServer) {
        servers.grackle = inProcessServer;
        sdkOptions.mcpServers = servers;
        logger.info("Injected in-process Grackle MCP server (post_finding tool available)");
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
  ): AgentSession {
    return new ClaudeCodeSession(id, prompt, model, maxTurns, resumeSessionId, branch, worktreeBasePath, systemContext, mcpServers);
  }
}
