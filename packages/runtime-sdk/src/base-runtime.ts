import type { AgentRuntime, AgentSession, SpawnOptions, ResumeOptions, CreateSessionOptions } from "./runtime.js";

/**
 * Abstract base class for agent runtimes that share the spawn/resume pattern.
 *
 * Subclasses implement `createSession()` to construct the runtime-specific session.
 * The `spawn()` and `resume()` methods delegate to `createSession()` with a
 * `CreateSessionOptions` object.
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
   * Called by both `spawn()` and `resume()` with the appropriate options.
   */
  protected abstract createSession(opts: CreateSessionOptions): AgentSession;

  /** Create and start a new agent session. */
  public spawn(opts: SpawnOptions): AgentSession {
    return this.createSession({
      id: opts.sessionId,
      prompt: opts.prompt,
      model: opts.model,
      maxTurns: opts.maxTurns,
      branch: opts.branch,
      workingDirectory: opts.workingDirectory,
      systemContext: opts.systemContext,
      mcpServers: opts.mcpServers,
      hooks: opts.hooks,
      mcpBroker: opts.mcpBroker,
      useWorktrees: opts.useWorktrees,
    });
  }

  /** Resume a previously suspended session. */
  public resume(opts: ResumeOptions): AgentSession {
    return this.createSession({
      id: opts.sessionId,
      prompt: this.resumePrompt,
      model: "",
      maxTurns: 0,
      resumeSessionId: opts.runtimeSessionId,
    });
  }
}
