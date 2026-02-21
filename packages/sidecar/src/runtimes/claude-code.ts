import type { AgentRuntime, AgentSession, AgentEvent, SpawnOptions, ResumeOptions } from "./runtime.js";
import type { SessionStatus } from "@grackle/common";
import { AsyncQueue } from "../utils/async-queue.js";
import { existsSync, readdirSync } from "node:fs";

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
    private resumeSessionId?: string
  ) {
    this.id = id;
    this.runtimeSessionId = resumeSessionId || "";
  }

  async *stream(): AsyncIterable<AgentEvent> {
    const query = await getQuery();
    const ts = () => new Date().toISOString();

    yield { type: "system", timestamp: ts(), content: "Starting Claude Code runtime..." };

    try {
      // Use /workspace as cwd if it exists and has content (i.e. a repo was cloned)
      const workspacePath = "/workspace";
      const useWorkspace = existsSync(workspacePath) &&
        readdirSync(workspacePath).length > 0;

      const options: Record<string, unknown> = {
        prompt: this.prompt,
        model: this.model,
        abortController: new AbortController(),
        ...(useWorkspace ? { cwd: workspacePath } : {}),
      };

      if (this.maxTurns > 0) {
        options.maxTurns = this.maxTurns;
      }

      if (this.resumeSessionId) {
        options.sessionId = this.resumeSessionId;
        options.resume = true;
      }

      // query() returns an async iterable, not a Promise (despite the type signature)
      const conversation = query(options) as unknown as AsyncIterable<Record<string, unknown>>;
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

export class ClaudeCodeRuntime implements AgentRuntime {
  name = "claude-code";

  spawn(opts: SpawnOptions): AgentSession {
    return new ClaudeCodeSession(opts.sessionId, opts.prompt, opts.model, opts.maxTurns);
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
