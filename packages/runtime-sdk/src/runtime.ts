import type { AgentEventType, SessionStatus, PipeMode } from "@grackle-ai/common";

/** A single event emitted by an agent during execution. */
export interface AgentEvent {
  type: AgentEventType;
  timestamp: string;
  content: string;
  raw?: unknown;
  /**
   * Stable tool-call id correlating a `tool_use` with its `tool_result` (AHP HR3).
   * Set by the runtime on tool events (lifted from the SDK's native id, or
   * synthesized when the SDK has none); left unset for non-tool events.
   */
  toolCallId?: string;
  /**
   * True for runtime lifecycle/diagnostic `system` events ("Starting runtime…",
   * "Session initialized", worktree setup) — used to tee these to telemetry
   * sinks (the additive OTLP logs sink today) and, in a later step, to filter
   * them out of authoritative `SessionState` (AHP HR7). Left unset for
   * substantive events (agent output, the injected system context).
   */
  diagnostic?: boolean;
  /**
   * Identifier of the turn this event belongs to (AHP HR2). Set by base-session
   * turn framing on `turn_started`/`turn_complete` and stamped on every content
   * event within a turn; left unset for out-of-band/liveness events (startup,
   * status, worktree setup, kill). Process-scoped — a resume starts a new turn.
   */
  turnId?: string;
  /**
   * True when a `tool_result` event reports a tool failure (AHP-followup #1362).
   * Set by the runtime adapter from its SDK's native outcome signal (Claude
   * Code `is_error`, Copilot `data.success`/`error`, Codex exit code/status,
   * ACP `status === "failed"`). Left unset on success and on non-tool events.
   * The AHP wire drops `raw`, so this first-class field is what carries the
   * pass/fail outcome into `SessionToolCallComplete.result.success`.
   */
  toolError?: boolean;
}

/** Parameters for spawning a new agent session. */
export interface SpawnOptions {
  sessionId: string;
  prompt: string;
  model: string;
  maxTurns: number;
  branch?: string;
  workingDirectory?: string;
  useWorktrees?: boolean;
  systemContext?: string;
  workspaceId?: string;
  taskId?: string;
  /** MCP server configurations to pass to the agent SDK. */
  mcpServers?: Record<string, unknown>;
  /** SDK hook callbacks (e.g. Stop hooks). Only supported by the Claude Code runtime; other runtimes ignore this field. */
  hooks?: Record<string, unknown>;
  /** MCP broker connection details. Both url and token must be present together. */
  mcpBroker?: { url: string; token: string };
  /** Script source code for script personas (e.g. GenAIScript). */
  scriptContent?: string;
  /** Pipe mode for parent↔child IPC ("sync", "async", "detach", or undefined for no pipe). */
  pipe?: PipeMode;
}

/** Parameters for resuming an existing agent session. */
export interface ResumeOptions {
  sessionId: string;
  runtimeSessionId: string;
}

/** Options for creating an agent session (used by BaseAgentRuntime.createSession and BaseAgentSession constructor). */
export interface CreateSessionOptions {
  /** Session identifier. */
  id: string;
  /** Initial prompt text. */
  prompt: string;
  /** LLM model identifier. */
  model: string;
  /** Maximum turns (0 = unlimited). */
  maxTurns: number;
  /** Runtime session ID to resume (undefined for new sessions). */
  resumeSessionId?: string;
  /** Git branch name. */
  branch?: string;
  /** Working directory for the agent. */
  workingDirectory?: string;
  /** Whether to use git worktrees for isolation. */
  useWorktrees?: boolean;
  /** System context prepended to the prompt. */
  systemContext?: string;
  /** MCP server configurations to pass to the agent SDK. */
  mcpServers?: Record<string, unknown>;
  /** SDK hook callbacks (e.g. Stop hooks). Only supported by the Claude Code runtime; other runtimes ignore this field. */
  hooks?: Record<string, unknown>;
  /** MCP broker connection details. Both url and token must be present together. */
  mcpBroker?: { url: string; token: string };
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
  /** Forcefully terminate the session with an optional reason. */
  kill(reason?: string): void;
  /** Drain any buffered events that were not yet consumed by the stream. */
  drainBufferedEvents(): AgentEvent[];
}

/** Contract for pluggable agent runtime implementations (e.g. Claude Code, stub). */
export interface AgentRuntime {
  name: string;
  /** Create and start a new agent session. */
  spawn(opts: SpawnOptions): AgentSession;
  /** Resume a previously suspended session. */
  resume(opts: ResumeOptions): AgentSession;
}
