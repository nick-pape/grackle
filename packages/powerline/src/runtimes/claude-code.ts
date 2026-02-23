import type { AgentRuntime, AgentSession, AgentEvent, SpawnOptions, ResumeOptions } from "./runtime.js";
import type { SessionStatus } from "@grackle/common";
import { AsyncQueue } from "../utils/async-queue.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { ensureWorktree } from "../worktree.js";

// Dynamic import — try @anthropic-ai/claude-agent-sdk first, then @anthropic-ai/claude-code
type QueryFn = (opts: Record<string, unknown>) => Promise<unknown>;
let queryFn: QueryFn | null = null;

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
const GRACKLE_MCP_SCRIPT = "/app/mcp-grackle/index.js";

function mapMessage(msg: Record<string, unknown>): AgentEvent[] {
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
    // result messages are handled in stream() for error checking; skip here
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

class ClaudeCodeSession implements AgentSession {
  id: string;
  runtimeName = "claude-code";
  runtimeSessionId: string;
  status: SessionStatus = "running";
  private inputQueue = new AsyncQueue<string>();
  private killed = false;

  constructor(
    id: string,
    private prompt: string,
    private model: string,
    private maxTurns: number,
    private resumeSessionId?: string,
    private branch?: string,
    private worktreeBasePath?: string,
    private systemContext?: string,
    private mcpServers?: Record<string, unknown>,
  ) {
    this.id = id;
    this.runtimeSessionId = resumeSessionId || "";
  }

  async *stream(): AsyncIterable<AgentEvent> {
    const query = await getQuery();
    const ts = () => new Date().toISOString();

    yield { type: "system", timestamp: ts(), content: "Starting Claude Code runtime..." };

    try {
      // Determine cwd: worktree > /workspace > default
      let cwd: string | undefined;

      if (this.branch && this.worktreeBasePath) {
        try {
          const wt = await ensureWorktree(this.worktreeBasePath, this.branch);
          cwd = wt.worktreePath;
          yield { type: "system", timestamp: ts(), content: `Worktree ready: ${wt.worktreePath} (branch: ${this.branch}, created: ${wt.created})` };
        } catch (wtErr) {
          yield { type: "system", timestamp: ts(), content: `Worktree setup skipped (${wtErr}), falling back to workspace` };
          const workspacePath = "/workspace";
          if (existsSync(workspacePath)) cwd = workspacePath;
        }
      } else {
        const workspacePath = "/workspace";
        const useWorkspace = existsSync(workspacePath) &&
          readdirSync(workspacePath).length > 0;
        if (useWorkspace) cwd = workspacePath;
      }

      // Build final prompt with system context
      const finalPrompt = this.systemContext
        ? `${this.systemContext}\n\n---\n\n${this.prompt}`
        : this.prompt;

      // SDK query() expects { prompt, options: { model, mcpServers, ... } }
      // Both permissionMode AND allowDangerouslySkipPermissions are needed for full bypass.
      // Built-in tools must also be in allowedTools explicitly — the SDK treats allowedTools
      // as a whitelist that overrides permissionMode for tool-level checks.
      const builtinTools = [
        "Bash", "Read", "Write", "Edit", "Glob", "Grep",
        "WebSearch", "WebFetch", "Task", "NotebookEdit",
      ];
      const sdkOptions: Record<string, unknown> = {
        model: this.model,
        abortController: new AbortController(),
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        allowedTools: [...builtinTools],
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

      if (this.resumeSessionId) {
        sdkOptions.sessionId = this.resumeSessionId;
        sdkOptions.resume = true;
      }

      // query() returns an async iterable, not a Promise (despite the type signature)
      const queryInput: Record<string, unknown> = {
        prompt: finalPrompt,
        options: sdkOptions,
      };
      const conversation = query(queryInput) as unknown as AsyncIterable<Record<string, unknown>>;
      let messageCount = 0;

      for await (const msg of conversation) {
        if (this.killed) break;

        // Extract session ID from system init message
        if (msg.type === "system" && msg.session_id) {
          this.runtimeSessionId = msg.session_id as string;
        }

        // Check for result errors (e.g. invalid API key)
        if (msg.type === "result" && msg.is_error) {
          const errorMsg = (msg.result as string) || "Claude Code returned an error";
          yield { type: "error", timestamp: ts(), content: errorMsg, raw: msg };
          continue;
        }

        const events = mapMessage(msg);
        for (const event of events) {
          messageCount++;
          yield event;
        }
      }

      if (messageCount === 0) {
        yield { type: "error", timestamp: ts(), content: "Claude Code returned no messages. Is ANTHROPIC_API_KEY set or ~/.claude/.credentials.json mounted?" };
      }

      this.status = "completed";
      yield { type: "status", timestamp: ts(), content: "completed" };
    } catch (err) {
      this.status = "failed";
      yield { type: "error", timestamp: ts(), content: String(err) };
      yield { type: "status", timestamp: ts(), content: "failed" };
    }
  }

  sendInput(text: string): void {
    this.inputQueue.push(text);
  }

  kill(): void {
    this.killed = true;
    this.status = "killed";
    this.inputQueue.close();
  }
}

/** Runtime that delegates to the Claude Code SDK (`@anthropic-ai/claude-agent-sdk`). */
export class ClaudeCodeRuntime implements AgentRuntime {
  name = "claude-code";

  spawn(opts: SpawnOptions): AgentSession {
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

  resume(opts: ResumeOptions): AgentSession {
    return new ClaudeCodeSession(
      opts.sessionId,
      "(resumed)",
      "",
      0,
      opts.runtimeSessionId
    );
  }
}
