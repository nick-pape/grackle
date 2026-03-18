import { EventEmitter } from "node:events";
import type { AgentRuntime, AgentSession, AgentEvent, SpawnOptions, ResumeOptions } from "./runtime.js";
import { SESSION_STATUS } from "@grackle-ai/common";
import type { SessionStatus } from "@grackle-ai/common";
import { logger } from "../logger.js";

/** Timeout for connecting to the MCP server and completing the tool call. */
const MCP_CONNECT_TIMEOUT_MS: number = 5_000;

class StubMcpSession implements AgentSession {
  public id: string;
  public runtimeName: string = "stub-mcp";
  public runtimeSessionId: string;
  public status: SessionStatus = SESSION_STATUS.RUNNING;

  private emitter: EventEmitter = new EventEmitter();
  private inputResolve: ((text: string) => void) | null = null;
  private killed: boolean = false;
  private prompt: string;
  private mcpBroker: { url: string; token: string } | undefined;
  private projectId: string | undefined;

  public constructor(
    id: string,
    prompt: string,
    mcpBroker?: { url: string; token: string },
    projectId?: string,
  ) {
    this.id = id;
    this.prompt = prompt;
    this.mcpBroker = mcpBroker;
    this.projectId = projectId;
    this.runtimeSessionId = `stub-mcp-${id}`;
  }

  public async *stream(): AsyncIterable<AgentEvent> {
    const ts: () => string = () => new Date().toISOString();

    yield { type: "system", timestamp: ts(), content: "Stub MCP runtime initialized" };
    yield { type: "text", timestamp: ts(), content: `Echo: ${this.prompt}` };

    if (this.killed as boolean) {
      return;
    }

    if (this.mcpBroker && this.projectId) {
      // Real MCP tool call path
      yield* this.performMcpToolCall(ts);
    } else {
      // Fallback: same fake tool events as the regular stub runtime
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

    if (this.killed as boolean) {
      return;
    }

    // Wait for user input
    this.status = SESSION_STATUS.IDLE;
    yield { type: "status", timestamp: ts(), content: "waiting_input" };

    if (this.killed as boolean) {
      return;
    }

    const input = await this.waitForInput();
    if (this.killed) {
      return;
    }

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

  /**
   * Connect to the MCP server via the SDK and call tools/call { name: "task_list" }.
   * Yields tool_use and tool_result events with raw metadata.
   */
  private async *performMcpToolCall(ts: () => string): AsyncIterable<AgentEvent> {
    const toolUseId = "toolu_stub_mcp_1";
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
      await Promise.race([
        mcpClient.connect(transport),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("MCP connect timeout")), MCP_CONNECT_TIMEOUT_MS),
        ),
      ]);

      // Yield the tool_use event
      yieldedToolUse = true;
      yield {
        type: "tool_use",
        timestamp: ts(),
        content: JSON.stringify({ tool: "task_list", args: {} }),
        raw: { type: "tool_use", id: toolUseId, name: "task_list", input: {} },
      };

      // Call the tool
      const result = await Promise.race([
        mcpClient.callTool({ name: "task_list", arguments: {} }),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("MCP tool call timeout")), MCP_CONNECT_TIMEOUT_MS),
        ),
      ]);

      // Yield the tool_result event with the real MCP response
      yield {
        type: "tool_result",
        timestamp: ts(),
        content: JSON.stringify(result),
        raw: { type: "tool_result", tool_use_id: toolUseId, is_error: false },
      };
    } catch (err) {
      logger.warn({ err }, "stub-mcp: MCP tool call failed");

      // Yield tool_use if we haven't already (error during connect)
      if (!yieldedToolUse) {
        yield {
          type: "tool_use",
          timestamp: ts(),
          content: JSON.stringify({ tool: "task_list", args: {} }),
          raw: { type: "tool_use", id: toolUseId, name: "task_list", input: {} },
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
          await mcpClient.close();
        } catch {
          // Ignore close errors
        }
      }
    }
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

/**
 * A stub runtime that makes real MCP tool calls when an mcpBroker is available.
 * Falls back to fake echo tool events when no MCP broker is configured.
 * Useful for integration testing the MCP tool-call chain.
 */
export class StubMcpRuntime implements AgentRuntime {
  public name: string = "stub-mcp";

  public spawn(opts: SpawnOptions): AgentSession {
    return new StubMcpSession(opts.sessionId, opts.prompt, opts.mcpBroker, opts.projectId);
  }

  public resume(opts: ResumeOptions): AgentSession {
    return new StubMcpSession(opts.sessionId, "(resumed session)");
  }
}
