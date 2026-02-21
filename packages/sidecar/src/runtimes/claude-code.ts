import type { AgentRuntime, AgentSession, AgentEvent, SpawnOpts, ResumeOpts } from "./runtime.js";
import type { SessionStatus } from "@grackle/common";
import { AsyncQueue } from "../utils/async-queue.js";

// Dynamic import — @anthropic-ai/claude-code may not be installed
type QueryFn = (opts: Record<string, unknown>) => Promise<unknown>;
let queryFn: QueryFn | null = null;

async function getQuery(): Promise<QueryFn> {
  if (queryFn) return queryFn;
  try {
    // @ts-expect-error — dynamic import may not resolve at compile time
    const mod = await import("@anthropic-ai/claude-code");
    queryFn = (mod as Record<string, unknown>).query as QueryFn;
    return queryFn;
  } catch {
    throw new Error(
      "Claude Code SDK not installed. Run: npm install @anthropic-ai/claude-code"
    );
  }
}

function mapMessage(msg: Record<string, unknown>): AgentEvent | null {
  const ts = new Date().toISOString();
  const role = msg.role as string | undefined;
  const type = msg.type as string | undefined;

  if (role === "assistant") {
    // SDKAssistantMessage — may have content blocks
    const content = msg.content;
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
      return events.length > 0 ? events[0] : null;
    }
    return { type: "text", timestamp: ts, content: String(content || ""), raw: msg };
  }

  if (role === "user" && type === "tool_result") {
    return {
      type: "tool_result",
      timestamp: ts,
      content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      raw: msg,
    };
  }

  if (type === "result") {
    return {
      type: "status",
      timestamp: ts,
      content: "completed",
      raw: msg,
    };
  }

  if (type === "system") {
    return {
      type: "system",
      timestamp: ts,
      content: String((msg as Record<string, unknown>).message || ""),
      raw: msg,
    };
  }

  return null;
}

class ClaudeCodeSession implements AgentSession {
  id: string;
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
      const options: Record<string, unknown> = {
        prompt: this.prompt,
        model: this.model,
        abortController: new AbortController(),
      };

      if (this.maxTurns > 0) {
        options.maxTurns = this.maxTurns;
      }

      if (this.resumeSessionId) {
        options.sessionId = this.resumeSessionId;
        options.resume = true;
      }

      const result = await query(options) as Record<string, unknown>;

      // Process messages from result
      const messages = result.messages as Array<Record<string, unknown>> | undefined;
      if (messages) {
        for (const msg of messages) {
          if (this.killed) break;
          const event = mapMessage(msg);
          if (event) yield event;
        }
      }

      // Store runtime session ID for resume
      if (result.sessionId) {
        this.runtimeSessionId = result.sessionId as string;
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

  spawn(opts: SpawnOpts): AgentSession {
    return new ClaudeCodeSession(opts.sessionId, opts.prompt, opts.model, opts.maxTurns);
  }

  resume(opts: ResumeOpts): AgentSession {
    return new ClaudeCodeSession(
      opts.sessionId,
      "(resumed)",
      "",
      0,
      opts.runtimeSessionId
    );
  }
}
