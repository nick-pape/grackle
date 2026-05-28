/**
 * Transport-agnostic host interface (AHP HR8c).
 *
 * Wraps the PowerLine gRPC client behind an AHP-shaped API so consumers in
 * `@grackle-ai/core` no longer need to import `powerline.*` proto types. HR8d
 * will replace the gRPC implementation with a native AHP host without
 * changing this interface.
 *
 * Each consumer call-site goes through one of these methods:
 * - `createSession` ← `PowerLineClient.spawn`
 * - `reanimate`     ← `PowerLineClient.resume`
 * - `subscribe`     ← `PowerLineClient.drainBufferedEvents` + `resume` (composed)
 * - `dispatchInput` ← `PowerLineClient.sendInput`
 * - `authenticate`  ← `PowerLineClient.authenticate`
 * - `dispose`       ← `PowerLineClient.kill`
 * - `listSessions`  ← `PowerLineClient.listSessions`
 *
 * @module host-transport
 */

import type { AgentEventFields } from "@grackle-ai/common";
import type { StateAction } from "@grackle-ai/ahp";

/**
 * A single event from a session stream, in HR8c transitional form.
 *
 * Carries both the source `AgentEvent` (so existing event-driven logic in
 * `event-processor.ts` continues to work) and the AHP `StateAction[]`
 * produced by the upstream mapper. HR8d removes `event`/`legacyEvent` once
 * consumers fully consume AHP actions.
 */
export interface ServerActionEnvelope {
  /**
   * Source AgentEvent — transitional. Existing consumers in
   * `@grackle-ai/core` drive status/usage/end-reason logic from this. HR8d
   * removes the field; consumers must migrate to AHP actions by then.
   */
  event: AgentEventFields;
  /** AHP actions derived from the event (possibly empty for carried/dropped). */
  actions: StateAction[];
}

/** Parameters for creating a new session via {@link IHostTransport.createSession}. */
export interface CreateSessionParams {
  /** Server-assigned session ID (becomes the session URI). */
  sessionId: string;
  /** Runtime name (e.g. "claude-code", "copilot"). */
  runtime: string;
  /** User-visible prompt to deliver as the initial turn. */
  prompt: string;
  /** LLM model identifier. */
  model: string;
  /** Maximum agent turns before forced stop. */
  maxTurns: number;
  /** Git branch for worktree creation; empty string skips worktree. */
  branch: string;
  /** Working directory on the remote (defaults to "/workspace"). */
  workingDirectory: string;
  /** System prompt / context injected at session start. */
  systemContext: string;
  /** Workspace identifier (optional, for non-workspace sessions). */
  workspaceId?: string;
  /** Task identifier this session belongs to. */
  taskId: string;
  /** JSON-encoded MCP server configurations. */
  mcpServersJson: string;
  /** MCP broker URL the runtime should connect back to. */
  mcpUrl: string;
  /** Scoped token for the runtime to authenticate to the MCP broker. */
  mcpToken: string;
  /** Whether to use git worktrees. */
  useWorktrees?: boolean;
  /** IPC pipe mode ("sync", "async", "detach", or ""). */
  pipe?: string;
  /** Script content for script personas (optional). */
  scriptContent?: string;
}

/** Parameters for reanimating a suspended session. */
export interface ReanimateParams {
  /** Server session ID matching the prior spawn. */
  sessionId: string;
  /** Runtime-native session ID stored from the prior spawn's `runtime_session_id` event. */
  runtimeSessionId: string;
  /** Runtime name (must match the original spawn). */
  runtime: string;
}

/** A single token item delivered via {@link IHostTransport.authenticate}. */
export interface AuthenticateTokenItem {
  /** Logical name of the token (e.g. "github-token"). */
  name: string;
  /** Delivery kind ("env_var" or "file"). */
  type: string;
  /** Environment variable name (when `type === "env_var"`). */
  envVar?: string;
  /** Target file path on the remote (when `type === "file"`). */
  filePath?: string;
  /** The credential value. */
  value: string;
}

/** Parameters for {@link IHostTransport.authenticate}. */
export interface AuthenticateParams {
  /** Provider identifier (typically the runtime name) the credentials are scoped to. */
  provider: string;
  /** Token items to deliver. */
  tokens: AuthenticateTokenItem[];
}

/** A single session entry returned by {@link IHostTransport.listSessions}. */
export interface HostSessionInfo {
  /** Server session ID. */
  sessionId: string;
  /** Runtime the session is running under. */
  runtime: string;
  /** Current status (runtime-defined). */
  status: string;
}

/** Result of {@link IHostTransport.createSession}: URI + live event stream. */
export interface CreateSessionResult {
  /** Session URI (currently just the sessionId; AHP URI scheme reserved for HR8d). */
  sessionUri: string;
  /** Live stream of envelopes for this session. */
  stream: AsyncIterable<ServerActionEnvelope>;
}

/**
 * Transport-agnostic host interface (AHP HR8c).
 *
 * All `@grackle-ai/core` consumers obtain an implementation via
 * `GrpcHostTransport(connection)` (this PR) or directly from the AHP host
 * (HR8d). The interface shape stays stable across the swap.
 */
export interface IHostTransport {
  /**
   * Create a new session. Returns the session URI plus the live event stream.
   *
   * The stream is returned synchronously alongside the URI (matching gRPC's
   * spawn behavior) to avoid event-buffer complexity. Consumers must begin
   * iterating the stream promptly to avoid back-pressure on the wire.
   */
  createSession(params: CreateSessionParams): CreateSessionResult;

  /**
   * Reanimate a suspended session, returning its live event stream.
   *
   * Maps directly to `resume`. For recovery flows that also need the
   * previously-parked buffered events, call `drainBuffered` first, then
   * call `reanimate` to start the live stream.
   */
  reanimate(params: ReanimateParams): AsyncIterable<ServerActionEnvelope>;

  /**
   * Drain previously-parked buffered events for a session.
   *
   * Returns a finite stream of envelopes for events the host has been
   * holding since the consumer disconnected; the stream terminates once
   * the parked queue is exhausted. It does NOT continue into the live
   * event stream — callers compose `drainBuffered` + `reanimate` to do
   * recovery (see `session-recovery.ts`).
   *
   * Note: HR8d's AHP wire will add a true seq-cursor `subscribe` method
   * for "resume from server seq N" semantics. That's intentionally a
   * separate method on this interface; this one stays narrowly scoped to
   * the parked-queue drain that gRPC supports today.
   */
  drainBuffered(sessionUri: string): AsyncIterable<ServerActionEnvelope>;

  /**
   * Send input text to a session.
   *
   * Bypasses any IDLE guard — the runtime accepts input at any time and picks
   * it up at the next turn boundary. Used by signal delivery and pipe
   * delivery in `@grackle-ai/core`.
   */
  dispatchInput(sessionUri: string, text: string): Promise<void>;

  /**
   * Authenticate credentials for the given runtime/provider.
   *
   * Throws on transport error. Callers in core treat failure as best-effort
   * (log and continue).
   */
  authenticate(params: AuthenticateParams): Promise<void>;

  /**
   * Dispose (terminate) a session.
   *
   * Maps to `kill`. The optional `reason` is currently ignored by the gRPC
   * transport but reserved for future AHP-native disposition semantics.
   */
  dispose(sessionUri: string, reason?: string): Promise<void>;

  /** List active sessions on the host. */
  listSessions(): Promise<HostSessionInfo[]>;
}
