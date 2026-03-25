/**
 * Thin alias for the unified StubSession that registers under the "stub-mcp" runtime name.
 *
 * The actual implementation lives in {@link StubSession} (stub.ts). This module exists
 * so that both "stub" and "stub-mcp" runtime names continue to work, preserving
 * backward compatibility with existing personas and E2E tests.
 */
import type { AgentRuntime, AgentSession, SpawnOptions, ResumeOptions } from "./runtime.js";
import { StubSession } from "./stub.js";

/**
 * A stub runtime that makes real MCP tool calls when both mcpBroker and workspaceId are available.
 * Falls back to fake echo tool events when either is missing (e.g. no MCP server or non-task sessions).
 * Useful for integration testing the MCP tool-call chain.
 */
export class StubMcpRuntime implements AgentRuntime {
  public name: string = "stub-mcp";

  public spawn(opts: SpawnOptions): AgentSession {
    return new StubSession(opts.sessionId, opts.prompt, "stub-mcp", opts.mcpBroker, opts.workspaceId);
  }

  public resume(opts: ResumeOptions): AgentSession {
    return new StubSession(opts.sessionId, "(resumed session)", "stub-mcp");
  }
}
