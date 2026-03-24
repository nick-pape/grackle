import type { AgentRuntime, AgentSession, SpawnOptions, ResumeOptions } from "./runtime.js";

/**
 * Abstract base class for agent runtimes that share the spawn/resume pattern.
 *
 * Subclasses implement `createSession()` to construct the runtime-specific session.
 * The `spawn()` and `resume()` methods delegate to `createSession()` with the
 * appropriate parameters.
 */
export abstract class BaseAgentRuntime implements AgentRuntime {
  public abstract name: string;

  /**
   * Prompt text used when resuming a session. Defaults to `""`.
   * CopilotRuntime overrides to `"(resumed)"` since the Copilot SDK requires a non-empty prompt.
   */
  protected resumePrompt: string = "";

  /**
   * Create a runtime-specific agent session.
   *
   * Called by both `spawn()` and `resume()` with the appropriate parameters.
   */
  protected abstract createSession(
    id: string,
    prompt: string,
    model: string,
    maxTurns: number,
    resumeSessionId?: string,
    branch?: string,
    workingDirectory?: string,
    systemContext?: string,
    mcpServers?: Record<string, unknown>,
    hooks?: Record<string, unknown>,
    mcpBroker?: { url: string; token: string },
    useWorktrees?: boolean,
  ): AgentSession;

  /** Create and start a new agent session. */
  public spawn(opts: SpawnOptions): AgentSession {
    return this.createSession(
      opts.sessionId,
      opts.prompt,
      opts.model,
      opts.maxTurns,
      undefined,
      opts.branch,
      opts.workingDirectory,
      opts.systemContext,
      opts.mcpServers,
      opts.hooks,
      opts.mcpBroker,
      opts.useWorktrees,
    );
  }

  /** Resume a previously suspended session. */
  public resume(opts: ResumeOptions): AgentSession {
    return this.createSession(
      opts.sessionId,
      this.resumePrompt,
      "",
      0,
      opts.runtimeSessionId,
    );
  }
}
