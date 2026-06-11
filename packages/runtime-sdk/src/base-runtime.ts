import type {
  AgentRuntime,
  AgentSession,
  SpawnOptions,
  ResumeOptions,
  CreateSessionOptions,
  RuntimeCapabilities,
} from "./runtime.js";

/** Placeholder prompt passed on resume when `capabilities.requiresNonEmptyResumePrompt` is true. */
const RESUMED_PROMPT_PLACEHOLDER: string = "(resumed)";

/**
 * Default capabilities for runtimes that extend `BaseAgentRuntime`.
 * Subclasses override `capabilities` to declare their actual affordances.
 */
const DEFAULT_CAPABILITIES: RuntimeCapabilities = {
  supportsHooks: false,
  supportsResume: true,
  requiresNonEmptyResumePrompt: false,
};

/**
 * Abstract base class for agent runtimes that share the spawn/resume pattern.
 *
 * Subclasses implement `createSession()` to construct the runtime-specific session,
 * and declare their actual capability surface by overriding `capabilities`.
 * `spawn()` drops `hooks` for runtimes where `capabilities.supportsHooks` is false.
 * `resume()` uses a non-empty placeholder prompt when `capabilities.requiresNonEmptyResumePrompt`
 * is true.
 */
export abstract class BaseAgentRuntime implements AgentRuntime {
  public abstract name: string;

  /** Declarative capability surface — consumers gate on these flags rather than branching on `name`. */
  public readonly capabilities: RuntimeCapabilities = DEFAULT_CAPABILITIES;

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
      // Only forward hooks to runtimes that support them.
      hooks: this.capabilities.supportsHooks ? opts.hooks : undefined,
      mcpBroker: opts.mcpBroker,
      useWorktrees: opts.useWorktrees,
    });
  }

  /** Resume a previously suspended session. */
  public resume(opts: ResumeOptions): AgentSession {
    const prompt: string = this.capabilities.requiresNonEmptyResumePrompt
      ? RESUMED_PROMPT_PLACEHOLDER
      : "";
    return this.createSession({
      id: opts.sessionId,
      prompt,
      model: "",
      maxTurns: 0,
      resumeSessionId: opts.runtimeSessionId,
    });
  }
}
