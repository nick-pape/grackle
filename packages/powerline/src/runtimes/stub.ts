import { EventEmitter } from "node:events";
import type { AgentRuntime, AgentSession, AgentEvent, SpawnOptions, ResumeOptions } from "./runtime.js";
import type { SessionStatus } from "@grackle/common";

class StubSession implements AgentSession {
  public id: string;
  public runtimeName: string = "stub";
  public runtimeSessionId: string;
  public status: SessionStatus = "running";

  private emitter: EventEmitter = new EventEmitter();
  private inputResolve: ((text: string) => void) | null = null;
  private killed: boolean = false;
  private prompt: string;

  public constructor(id: string, prompt: string) {
    this.id = id;
    this.prompt = prompt;
    this.runtimeSessionId = `stub-${id}`;
  }

  public async *stream(): AsyncIterable<AgentEvent> {
    const ts: () => string = () => new Date().toISOString();

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

  public sendInput(text: string): void {
    this.emitter.emit("input", text);
  }

  public kill(): void {
    this.killed = true;
    this.status = "killed";
    if (this.inputResolve) {
      this.inputResolve("");
    }
  }
}

/** A mock runtime that echoes prompts and waits for one round of user input. Useful for testing. */
export class StubRuntime implements AgentRuntime {
  public name: string = "stub";

  public spawn(opts: SpawnOptions): AgentSession {
    return new StubSession(opts.sessionId, opts.prompt);
  }

  public resume(opts: ResumeOptions): AgentSession {
    return new StubSession(opts.sessionId, "(resumed session)");
  }
}
