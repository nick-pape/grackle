import { EventEmitter } from "node:events";
import type { AgentRuntime, AgentSession, AgentEvent, SpawnOptions, ResumeOptions } from "./runtime.js";
import { SESSION_STATUS } from "@grackle-ai/common";
import type { SessionStatus } from "@grackle-ai/common";
import {
  parseScenario,
  buildEventFromEmitStep,
  isEmitStep,
  isWaitStep,
  isIdleStep,
  isOnInputStep,
  isOnInputMatchStep,
} from "./stub-scenario.js";
import type { Scenario, InputAction } from "./stub-scenario.js";

class StubSession implements AgentSession {
  public id: string;
  public runtimeName: string = "stub";
  public runtimeSessionId: string;
  public status: SessionStatus = SESSION_STATUS.RUNNING;

  private emitter: EventEmitter = new EventEmitter();
  private inputResolve: ((text: string) => void) | null = null;
  private killed: boolean = false;
  private killReason: string = "killed";
  private killResolve: (() => void) | null = null;
  private prompt: string;
  private scenario: Scenario | undefined;
  private inputHandler: InputAction = "echo";
  private inputMatchRules: Record<string, InputAction> | undefined;

  public constructor(id: string, prompt: string) {
    this.id = id;
    this.prompt = prompt;
    this.runtimeSessionId = `stub-${id}`;
    this.scenario = parseScenario(prompt);
  }

  public async *stream(): AsyncIterable<AgentEvent> {
    if (this.scenario) {
      yield* this.runScenario();
    } else {
      yield* this.runLegacy();
    }
  }

  /** Original hardcoded echo behavior, preserved for backward compatibility. */
  private async *runLegacy(): AsyncIterable<AgentEvent> {
    const ts: () => string = () => new Date().toISOString();

    yield { type: "system", timestamp: ts(), content: "Stub runtime initialized" };
    yield { type: "runtime_session_id", timestamp: ts(), content: this.runtimeSessionId };
    yield { type: "text", timestamp: ts(), content: `Echo: ${this.prompt}` };

    if (this.killed as boolean) { yield { type: "status", timestamp: ts(), content: this.killReason }; return; }

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

    if (this.killed as boolean) { yield { type: "status", timestamp: ts(), content: this.killReason }; return; }

    // Wait for user input
    this.status = SESSION_STATUS.IDLE;
    yield { type: "status", timestamp: ts(), content: "waiting_input" };

    if (this.killed as boolean) { yield { type: "status", timestamp: ts(), content: this.killReason }; return; }

    const input = await this.waitForInput();
    if (this.killed) { yield { type: "status", timestamp: ts(), content: this.killReason }; return; }

    // Simulate failure when input is "fail"
    if (input === "fail") {
      this.status = SESSION_STATUS.STOPPED;
      yield { type: "status", timestamp: ts(), content: "failed" };
      return;
    }

    this.status = SESSION_STATUS.RUNNING;
    yield { type: "status", timestamp: ts(), content: "running" };
    yield { type: "text", timestamp: ts(), content: `You said: ${input}` };

    // Agent finished turn — go idle, not "completed"
    this.status = SESSION_STATUS.IDLE;
    yield { type: "status", timestamp: ts(), content: "waiting_input" };
  }

  /** Execute a parsed JSON scenario step by step. */
  private async *runScenario(): AsyncIterable<AgentEvent> {
    const ts: () => string = () => new Date().toISOString();
    const steps = this.scenario!.steps;
    let lastToolUseId: string | undefined;

    // Always emit system + runtime_session_id at the start
    yield { type: "system", timestamp: ts(), content: "Stub runtime initialized" };
    yield { type: "runtime_session_id", timestamp: ts(), content: this.runtimeSessionId };

    for (const step of steps) {
      // Check for kill between every step
      if (this.killed) {
        yield { type: "status", timestamp: ts(), content: this.killReason };
        return;
      }

      if (isEmitStep(step)) {
        const [event, toolUseId] = buildEventFromEmitStep(step, lastToolUseId);
        if (toolUseId) {
          lastToolUseId = toolUseId;
        }
        yield event;
      } else if (isWaitStep(step)) {
        await this.interruptibleWait(step.wait);
        if (this.killed as boolean) {
          yield { type: "status", timestamp: ts(), content: this.killReason };
          return;
        }
      } else if (isIdleStep(step)) {
        this.status = SESSION_STATUS.IDLE;
        yield { type: "status", timestamp: ts(), content: "waiting_input" };

        const input = await this.waitForInput();
        if (this.killed as boolean) {
          yield { type: "status", timestamp: ts(), content: this.killReason };
          return;
        }

        // Resolve input action
        const action = this.resolveInputAction(input);

        if (action === "fail") {
          this.status = SESSION_STATUS.STOPPED;
          yield { type: "status", timestamp: ts(), content: "failed" };
          return;
        }

        this.status = SESSION_STATUS.RUNNING;
        yield { type: "status", timestamp: ts(), content: "running" };

        if (action === "echo") {
          yield { type: "text", timestamp: ts(), content: `You said: ${input}` };
        }
        // "ignore" and "next" both just continue without emitting text
      } else if (isOnInputStep(step)) {
        this.inputHandler = step.on_input;
      } else if (isOnInputMatchStep(step)) {
        this.inputMatchRules = step.on_input_match;
      }
    }

    // All steps completed
    this.status = SESSION_STATUS.STOPPED;
    yield { type: "status", timestamp: ts(), content: "completed" };
  }

  /** Resolve which input action to take based on match rules and default handler. */
  private resolveInputAction(input: string): InputAction {
    if (this.inputMatchRules) {
      if (input in this.inputMatchRules) {
        return this.inputMatchRules[input];
      }
      if ("*" in this.inputMatchRules) {
        return this.inputMatchRules["*"];
      }
    }
    return this.inputHandler;
  }

  /** Sleep for the given duration, but resolve immediately if killed. */
  private interruptibleWait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.killResolve = null;
        resolve();
      }, ms);

      this.killResolve = () => {
        clearTimeout(timer);
        this.killResolve = null;
        resolve();
      };
    });
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

  public kill(reason?: string): void {
    this.killed = true;
    this.killReason = reason || "killed";
    this.status = SESSION_STATUS.STOPPED;
    if (this.inputResolve) {
      this.inputResolve("");
    }
    if (this.killResolve) {
      this.killResolve();
    }
  }

  /** Stub sessions have no buffered events to drain. */
  public drainBufferedEvents(): AgentEvent[] {
    return [];
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
