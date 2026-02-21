import { EventEmitter } from "node:events";
import type { AgentRuntime, AgentSession, AgentEvent, SpawnOptions, ResumeOptions } from "./runtime.js";
import type { SessionStatus } from "@grackle/common";

class StubSession implements AgentSession {
  id: string;
  runtimeName = "stub";
  runtimeSessionId: string;
  status: SessionStatus = "running";

  private emitter = new EventEmitter();
  private inputResolve: ((text: string) => void) | null = null;
  private killed = false;

  constructor(id: string, private prompt: string) {
    this.id = id;
    this.runtimeSessionId = `stub-${id}`;
  }

  async *stream(): AsyncIterable<AgentEvent> {
    const ts = () => new Date().toISOString();

    yield { type: "system", timestamp: ts(), content: "Stub runtime initialized" };
    yield { type: "text", timestamp: ts(), content: `Echo: ${this.prompt}` };

    if (this.killed) return;

    yield {
      type: "tool_use",
      timestamp: ts(),
      content: JSON.stringify({ tool: "echo", args: { message: this.prompt } }),
    };

    yield {
      type: "tool_result",
      timestamp: ts(),
      content: `Tool output: "${this.prompt}"`,
    };

    if (this.killed) return;

    // Wait for user input
    this.status = "waiting_input";
    yield { type: "status", timestamp: ts(), content: "waiting_input" };

    const input = await this.waitForInput();
    if (this.killed) return;

    this.status = "running";
    yield { type: "status", timestamp: ts(), content: "running" };
    yield { type: "text", timestamp: ts(), content: `You said: ${input}` };

    // Complete
    this.status = "completed";
    yield { type: "status", timestamp: ts(), content: "completed" };
  }

  private waitForInput(): Promise<string> {
    return new Promise<string>((resolve) => {
      this.inputResolve = resolve;
      this.emitter.once("input", resolve);
    });
  }

  sendInput(text: string): void {
    this.emitter.emit("input", text);
  }

  kill(): void {
    this.killed = true;
    this.status = "killed";
    if (this.inputResolve) {
      this.inputResolve("");
    }
  }
}

/** A mock runtime that echoes prompts and waits for one round of user input. Useful for testing. */
export class StubRuntime implements AgentRuntime {
  name = "stub";

  spawn(opts: SpawnOptions): AgentSession {
    return new StubSession(opts.sessionId, opts.prompt);
  }

  resume(opts: ResumeOptions): AgentSession {
    return new StubSession(opts.sessionId, "(resumed session)");
  }
}
