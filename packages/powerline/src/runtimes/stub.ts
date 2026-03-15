import { EventEmitter } from "node:events";
import type { AgentRuntime, AgentSession, AgentEvent, SpawnOptions, ResumeOptions } from "./runtime.js";
import { SESSION_STATUS } from "@grackle-ai/common";
import type { SessionStatus } from "@grackle-ai/common";

class StubSession implements AgentSession {
  public id: string;
  public runtimeName: string = "stub";
  public runtimeSessionId: string;
  public status: SessionStatus = SESSION_STATUS.RUNNING;

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

    if (this.killed as boolean) return;

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

    if (this.killed as boolean) return;

    // Wait for user input
    this.status = SESSION_STATUS.IDLE;
    yield { type: "status", timestamp: ts(), content: "waiting_input" };

    if (this.killed as boolean) return;

    const input = await this.waitForInput();
    if (this.killed) return;

    // Simulate failure when input is "fail"
    if (input === "fail") {
      this.status = SESSION_STATUS.FAILED;
      yield { type: "status", timestamp: ts(), content: "failed" };
      return;
    }

    this.status = SESSION_STATUS.RUNNING;
    yield { type: "status", timestamp: ts(), content: "running" };
    yield { type: "text", timestamp: ts(), content: `You said: ${input}` };

    // Complete
    this.status = SESSION_STATUS.COMPLETED;
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
    this.status = SESSION_STATUS.INTERRUPTED;
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
