import type { AgentEventType, SessionStatus } from "@grackle-ai/common";

/** A single event emitted by an agent during execution. */
export interface AgentEvent {
  type: AgentEventType;
  timestamp: string;
  content: string;
  raw?: unknown;
}

/** Parameters for spawning a new agent session. */
export interface SpawnOptions {
  sessionId: string;
  prompt: string;
  model: string;
  maxTurns: number;
  branch?: string;
  worktreeBasePath?: string;
  systemContext?: string;
  projectId?: string;
  taskId?: string;
  /** MCP server configurations to pass to the agent SDK. */
  mcpServers?: Record<string, unknown>;
  /** SDK hook callbacks (e.g. Stop hooks). Only supported by the Claude Code runtime; other runtimes ignore this field. */
  hooks?: Record<string, unknown>;
  /** URL of the MCP broker HTTP server (e.g. http://127.0.0.1:54321/mcp). */
  mcpBrokerUrl?: string;
  /** Scoped Bearer token for authenticating with the MCP broker. */
  mcpToken?: string;
}

/** Parameters for resuming an existing agent session. */
export interface ResumeOptions {
  sessionId: string;
  runtimeSessionId: string;
}

/** Handle for an in-progress agent session with streaming, input, and kill capabilities. */
export interface AgentSession {
  id: string;
  runtimeName: string;
  runtimeSessionId: string;
  status: SessionStatus;
  /** Yield events as the agent runs. */
  stream(): AsyncIterable<AgentEvent>;
  /** Send user input to a session that is waiting for it. */
  sendInput(text: string): void;
  /** Forcefully terminate the session. */
  kill(): void;
  /** Push an externally-generated event (e.g. from MCP broker) into the session's event stream. */
  pushEvent(event: AgentEvent): void;
}

/** Contract for pluggable agent runtime implementations (e.g. Claude Code, stub). */
export interface AgentRuntime {
  name: string;
  /** Create and start a new agent session. */
  spawn(opts: SpawnOptions): AgentSession;
  /** Resume a previously suspended session. */
  resume(opts: ResumeOptions): AgentSession;
}
