import { EventEmitter } from "node:events";
import type { AgentRuntime, AgentSession, AgentEvent, SpawnOptions, ResumeOptions } from "@grackle-ai/runtime-sdk";
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
  isMcpCallStep,
} from "./stub-scenario.js";
import type { Scenario, InputAction } from "./stub-scenario.js";
import { logger } from "../logger.js";

/** Timeout for connecting to the MCP server and completing a tool call. */
const MCP_CONNECT_TIMEOUT_MS: number = 5_000;

/** Timeout for closing the MCP client connection. */
const MCP_CLOSE_TIMEOUT_MS: number = 2_000;

/** Auto-incrementing counter for generating unique tool_use IDs within MCP calls. */
let mcpToolUseCounter: number = 0;

/** Race a promise against a timeout, clearing the timer on resolution to avoid leaks. */
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Unified stub session supporting both scenario execution and real MCP tool calls.
 *
 * When `mcpBroker` and `workspaceId` are provided (via SpawnOptions), the session
 * can make real MCP tool calls — either through `mcp_call` scenario steps or via
 * the legacy fallback path (replacing fake echo tools with a real `task_list` call).
 *
 * When no MCP broker is available, the session falls back to fake echo tool events.
 */
export class StubSession implements AgentSession {
  public id: string;
  public runtimeName: string;
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
  private mcpBroker: { url: string; token: string } | undefined;
  private workspaceId: string | undefined;

  public constructor(
    id: string,
    prompt: string,
    runtimeName: string = "stub",
    mcpBroker?: { url: string; token: string },
    workspaceId?: string,
  ) {
    this.id = id;
    this.prompt = prompt;
    this.runtimeName = runtimeName;
    this.runtimeSessionId = `${runtimeName}-${id}`;
    this.mcpBroker = mcpBroker;
    this.workspaceId = workspaceId;
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

    if (this.mcpBroker && this.workspaceId) {
      // Real MCP tool call when broker is available
      yield* this.performMcpToolCall(ts, "task_list", {});
    } else {
      // Fallback: fake echo tool events
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
    }

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
      } else if (isMcpCallStep(step)) {
        if (!this.mcpBroker || !this.workspaceId) {
          const toolUseId = `toolu_stub_mcp_${++mcpToolUseCounter}`;
          logger.warn(`${this.runtimeName}: mcp_call step "${step.mcp_call}" but no MCP broker/workspace configured`);
          yield {
            type: "tool_use",
            timestamp: ts(),
            content: JSON.stringify({ tool: step.mcp_call, args: step.args ?? {} }),
            raw: { type: "tool_use", id: toolUseId, name: step.mcp_call, input: step.args ?? {} },
          };
          yield {
            type: "tool_result",
            timestamp: ts(),
            content: JSON.stringify({ error: `Cannot execute MCP tool "${step.mcp_call}": session not spawned with MCP broker/workspace` }),
            raw: { type: "tool_result", tool_use_id: toolUseId, is_error: true },
          };
        } else {
          yield* this.performMcpToolCall(ts, step.mcp_call, step.args ?? {});
        }
      }
    }

    // All steps completed
    this.status = SESSION_STATUS.STOPPED;
    yield { type: "status", timestamp: ts(), content: "completed" };
  }

  /**
   * Connect to the MCP server and call a tool by name.
   * Yields tool_use and tool_result events with proper raw metadata.
   */
  private async *performMcpToolCall(
    ts: () => string,
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): AsyncIterable<AgentEvent> {
    const toolUseId = `toolu_stub_mcp_${++mcpToolUseCounter}`;
    let mcpClient: InstanceType<typeof import("@modelcontextprotocol/sdk/client/index.js").Client> | undefined;
    let yieldedToolUse = false;

    try {
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");

      const transport = new StreamableHTTPClientTransport(
        new URL(this.mcpBroker!.url),
        {
          requestInit: {
            headers: {
              Authorization: `Bearer ${this.mcpBroker!.token}`,
            },
          },
        },
      );

      mcpClient = new Client({ name: "stub-mcp-runtime", version: "1.0.0" });

      // Connect with a timeout to prevent hangs
      await withTimeout(mcpClient.connect(transport), MCP_CONNECT_TIMEOUT_MS, "MCP connect timeout");

      // Yield the tool_use event
      yieldedToolUse = true;
      yield {
        type: "tool_use",
        timestamp: ts(),
        content: JSON.stringify({ tool: toolName, args: toolArgs }),
        raw: { type: "tool_use", id: toolUseId, name: toolName, input: toolArgs },
      };

      // Call the tool
      const result = await withTimeout(
        mcpClient.callTool({ name: toolName, arguments: toolArgs }),
        MCP_CONNECT_TIMEOUT_MS,
        "MCP tool call timeout",
      );

      // Yield the tool_result event with the real MCP response
      yield {
        type: "tool_result",
        timestamp: ts(),
        content: JSON.stringify(result),
        raw: { type: "tool_result", tool_use_id: toolUseId, is_error: false },
      };
    } catch (err) {
      logger.warn({ err, runtimeName: this.runtimeName }, `${this.runtimeName}: MCP tool call failed`);

      // Yield tool_use if we haven't already (error during connect)
      if (!yieldedToolUse) {
        yield {
          type: "tool_use",
          timestamp: ts(),
          content: JSON.stringify({ tool: toolName, args: toolArgs }),
          raw: { type: "tool_use", id: toolUseId, name: toolName, input: toolArgs },
        };
      }

      // Yield error tool_result
      yield {
        type: "tool_result",
        timestamp: ts(),
        content: JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
        raw: { type: "tool_result", tool_use_id: toolUseId, is_error: true },
      };
    } finally {
      if (mcpClient) {
        try {
          await withTimeout(mcpClient.close(), MCP_CLOSE_TIMEOUT_MS, "MCP close timeout");
        } catch {
          // Ignore close errors — the connection may be in a bad state
        }
      }
    }
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
      // Remove the EventEmitter listener to prevent a stale callback if
      // sendInput() is called after kill().
      this.emitter.removeAllListeners("input");
      this.inputResolve("");
      this.inputResolve = null;
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

/** Reset the MCP tool_use counter (for testing). */
export function resetMcpToolUseCounter(): void {
  mcpToolUseCounter = 0;
}

/** A mock runtime that echoes prompts and waits for one round of user input. Useful for testing. */
export class StubRuntime implements AgentRuntime {
  public name: string = "stub";

  public spawn(opts: SpawnOptions): AgentSession {
    return new StubSession(opts.sessionId, opts.prompt, "stub", opts.mcpBroker, opts.workspaceId);
  }

  public resume(opts: ResumeOptions): AgentSession {
    return new StubSession(opts.sessionId, "(resumed session)");
  }
}
