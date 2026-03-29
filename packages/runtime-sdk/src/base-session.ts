import type { AgentSession, AgentEvent, CreateSessionOptions } from "./runtime.js";
import { SESSION_STATUS } from "@grackle-ai/common";
import type { SessionStatus } from "@grackle-ai/common";
import { AsyncQueue } from "./async-queue.js";
import { resolveWorkingDirectory, resolveMcpServers } from "./runtime-utils.js";
import type { ResolvedMcpConfig } from "./runtime-utils.js";
import { logger } from "./logger.js";

/**
 * Abstract base class for agent sessions that use the eventQueue + waiting_input lifecycle.
 *
 * Provides the shared session lifecycle:
 * - `stream()` yields an initial system message, drives `runSession()` in the background,
 *   and yields events from the queue.
 * - `runSession()` calls `setupSdk()`, handles resume vs initial query, transitions to waiting_input,
 *   then starts the input processing loop.
 * - `sendInput()` enqueues input for sequential processing by the input loop.
 * - `processInputLoop()` dequeues inputs and calls `executeFollowUp()` one at a time,
 *   preventing concurrent follow-ups across all runtimes.
 * - `kill()` aborts active work, closes the input queue, releases resources, and closes the event queue.
 *
 * Subclasses implement the SDK-specific abstract methods.
 */
export abstract class BaseAgentSession implements AgentSession {
  public id: string;
  public abstract runtimeName: string;
  public runtimeSessionId: string;
  public status: SessionStatus = SESSION_STATUS.RUNNING;

  protected readonly eventQueue: AsyncQueue<AgentEvent> = new AsyncQueue<AgentEvent>();
  private readonly inputQueue: AsyncQueue<string> = new AsyncQueue<string>();
  protected killed: boolean = false;
  protected readonly prompt: string;
  protected readonly model: string;
  protected readonly maxTurns: number;
  protected readonly resumeSessionId?: string;
  protected readonly branch?: string;
  protected readonly workingDirectory?: string;
  protected readonly useWorktrees: boolean;
  protected readonly systemContext?: string;
  protected readonly mcpServers?: Record<string, unknown>;
  protected readonly hooks?: Record<string, unknown>;
  protected readonly mcpBroker?: { url: string; token: string };

  /** Human-readable display name for system messages (e.g. "Claude Code", "Codex"). */
  protected abstract readonly runtimeDisplayName: string;

  /** Error message displayed when the initial query returns zero messages. */
  protected abstract readonly noMessagesError: string;

  public constructor(opts: CreateSessionOptions) {
    this.id = opts.id;
    this.prompt = opts.prompt;
    this.model = opts.model;
    this.maxTurns = opts.maxTurns;
    this.resumeSessionId = opts.resumeSessionId;
    this.branch = opts.branch;
    this.workingDirectory = opts.workingDirectory;
    this.useWorktrees = opts.useWorktrees ?? true;
    this.systemContext = opts.systemContext;
    this.mcpServers = opts.mcpServers;
    this.hooks = opts.hooks;
    this.mcpBroker = opts.mcpBroker;
    this.runtimeSessionId = opts.resumeSessionId || "";
  }

  // ─── Abstract methods for subclasses ──────────────────────

  /**
   * Initialize the SDK (import libraries, create instances, resolve worktree).
   * Called once at the start of `runSession()`, before resume checks or initial query.
   */
  protected abstract setupSdk(): Promise<void>;

  /**
   * Perform resume-specific setup (e.g. resume thread, emit system message).
   * Called only when `resumeSessionId` is set.
   *
   * Default implementation pushes a "Session resumed" system event.
   * Override in subclasses that need SDK-specific resume logic (e.g. resuming a thread),
   * and call `super.setupForResume()` to preserve the system event.
   */
  protected async setupForResume(): Promise<void> {
    this.eventQueue.push({
      type: "system",
      timestamp: new Date().toISOString(),
      content: `Session resumed (id: ${this.resumeSessionId})`,
    });
  }

  /**
   * Run the initial query with the given prompt.
   * Should consume the SDK stream/query and push events to `eventQueue`.
   * Returns the number of meaningful messages processed.
   */
  protected abstract runInitialQuery(prompt: string): Promise<number>;

  /**
   * Execute a follow-up input on the existing session.
   * Should consume the SDK stream/query and push events to `eventQueue`.
   * Resolves when the follow-up is complete.
   */
  protected abstract executeFollowUp(text: string): Promise<void>;

  /** Abort the currently active stream or query. */
  protected abstract abortActive(): void;

  /**
   * Release SDK resources for garbage collection.
   * Called on kill and on fatal error. Default is a no-op.
   */
  protected releaseResources(): void {
    // Default: no-op. Override in subclasses that hold SDK references.
  }

  /**
   * Build the initial prompt by combining system context with the user prompt.
   * Subclasses that inject system context via SDK-native mechanisms should
   * override this to return just `this.prompt`.
   */
  protected buildInitialPrompt(): string {
    return this.systemContext
      ? `${this.systemContext}\n\n---\n\n${this.prompt}`
      : this.prompt;
  }

  // ─── Shared convenience helpers ─────────────────────────

  /**
   * Resolve the working directory for the session, delegating to `resolveWorkingDirectory`
   * with the session's branch, workingDirectory, useWorktrees, and eventQueue fields.
   */
  protected async resolveWorkDir(requireNonEmpty?: boolean): Promise<string | undefined> {
    return resolveWorkingDirectory({
      branch: this.branch,
      workingDirectory: this.workingDirectory,
      useWorktrees: this.useWorktrees,
      eventQueue: this.eventQueue,
      ...(requireNonEmpty ? { requireNonEmpty } : {}),
    });
  }

  /** Resolve MCP server configuration from the session's mcpServers and mcpBroker. */
  protected resolveMcp(): ResolvedMcpConfig {
    return resolveMcpServers(this.mcpServers, this.mcpBroker);
  }

  /**
   * Push a usage event with a standardized JSON shape.
   * Skips the push when all values are zero (no meaningful usage to report).
   */
  protected pushUsageEvent(inputTokens: number, outputTokens: number, costUsd: number): void {
    if (inputTokens === 0 && outputTokens === 0 && costUsd === 0) {
      return;
    }
    this.eventQueue.push({
      type: "usage",
      timestamp: new Date().toISOString(),
      content: JSON.stringify({
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
      }),
    });
  }

  /**
   * Set the runtime session ID and emit a `runtime_session_id` event.
   * Idempotent: the event is only emitted on the first call with a non-empty ID.
   */
  protected setRuntimeSessionId(id: string): void {
    const wasEmpty = !this.runtimeSessionId;
    this.runtimeSessionId = id;
    if (wasEmpty && id) {
      this.eventQueue.push({
        type: "runtime_session_id",
        timestamp: new Date().toISOString(),
        content: id,
      });
    }
  }

  // ─── Shared lifecycle implementation ──────────────────────

  public async *stream(): AsyncIterable<AgentEvent> {
    const ts: () => string = () => new Date().toISOString();

    yield { type: "system", timestamp: ts(), content: `Starting ${this.runtimeDisplayName} runtime...` };

    // Drive the session in the background; events are pushed to the queue
    // and yielded from this generator.
    this.runSession().catch((err) => {
      this.eventQueue.push({ type: "error", timestamp: ts(), content: String(err) });
      this.eventQueue.push({ type: "status", timestamp: ts(), content: "failed" });
      this.status = SESSION_STATUS.STOPPED;
      this.eventQueue.close();
    });

    for await (const event of this.eventQueue) {
      yield event;
    }
  }

  /** Core session logic: setup SDK, handle resume or initial query, transition to waiting_input. */
  private async runSession(): Promise<void> {
    const ts: () => string = () => new Date().toISOString();

    try {
      await this.setupSdk();

      // For resumed sessions, perform resume-specific setup and wait for input.
      if (this.resumeSessionId) {
        await this.setupForResume();
        this.status = SESSION_STATUS.IDLE;
        this.eventQueue.push({ type: "status", timestamp: ts(), content: "waiting_input" });
        this.startInputLoop();
        return;
      }

      // Build final prompt with system context
      const finalPrompt = this.buildInitialPrompt();

      const messageCount = await this.runInitialQuery(finalPrompt);

      if (this.killed) {
        this.releaseResources();
        this.eventQueue.close();
        return;
      }

      if (messageCount === 0) {
        this.eventQueue.push({ type: "error", timestamp: ts(), content: this.noMessagesError });
      }

      // Session is idle — ready for follow-up input via sendInput().
      // The input loop owns the eventQueue lifecycle from this point.
      this.status = SESSION_STATUS.IDLE;
      this.eventQueue.push({ type: "status", timestamp: ts(), content: "waiting_input" });
      this.startInputLoop();
    } catch (err) {
      this.killed = true;
      this.status = SESSION_STATUS.STOPPED;
      this.eventQueue.push({ type: "error", timestamp: ts(), content: String(err) });
      this.eventQueue.push({ type: "status", timestamp: ts(), content: "failed" });
      this.inputQueue.close();
      this.releaseResources();
      this.eventQueue.close();
    }
  }

  /** Queue follow-up input for sequential processing by the input loop. */
  public sendInput(text: string): void {
    if (this.killed) {
      return;
    }
    this.inputQueue.push(text);
  }

  /**
   * Background loop that dequeues input and calls `executeFollowUp()` sequentially.
   * Started after the initial query (or resume setup) completes. Owns the eventQueue
   * lifecycle — closes it when the loop exits.
   */
  private async processInputLoop(): Promise<void> {
    const ts: () => string = () => new Date().toISOString();
    for await (const text of this.inputQueue) {
      if (this.killed) {
        break;
      }
      this.status = SESSION_STATUS.RUNNING;
      this.eventQueue.push({ type: "status", timestamp: ts(), content: "running" });

      try {
        await this.executeFollowUp(text);
      } catch (err: unknown) {
        logger.warn({ err }, `Failed to process follow-up input in ${this.runtimeDisplayName} session`);
        this.eventQueue.push({ type: "error", timestamp: ts(), content: String(err) });
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- killed changes asynchronously via kill()
      if (this.killed) {
        break;
      }
      this.status = SESSION_STATUS.IDLE;
      this.eventQueue.push({ type: "status", timestamp: ts(), content: "waiting_input" });
    }

    // Loop exited — queue closed (kill) or drained.
    this.releaseResources();
    this.eventQueue.close();
  }

  /** Fire-and-forget launch of the input processing loop. */
  private startInputLoop(): void {
    this.processInputLoop().catch((err) => {
      const ts = new Date().toISOString();
      logger.error({ err }, `Input loop crashed in ${this.runtimeDisplayName} session`);
      this.status = SESSION_STATUS.STOPPED;
      this.eventQueue.push({ type: "error", timestamp: ts, content: String(err) });
      this.eventQueue.push({ type: "status", timestamp: ts, content: "failed" });
      this.inputQueue.close();
      this.releaseResources();
      this.eventQueue.close();
    });
  }

  /** Forcefully terminate the session. Emits a final status event with the given reason. */
  public kill(reason: string = "killed"): void {
    this.killed = true;
    this.status = SESSION_STATUS.STOPPED;
    this.abortActive();
    this.inputQueue.close();
    // Emit a final status event BEFORE closing the queue so the server receives it.
    this.eventQueue.push({
      type: "status",
      timestamp: new Date().toISOString(),
      content: reason,
    });
    // releaseResources() and eventQueue.close() are also called by processInputLoop()
    // when it exits, but we call them here too for the case where kill() is called
    // before the input loop starts (e.g. during the initial query).
    // Both are idempotent — safe to call multiple times.
    this.releaseResources();
    this.eventQueue.close();
  }

  /** Drain any buffered events that were not yet consumed by the stream. */
  public drainBufferedEvents(): AgentEvent[] {
    return this.eventQueue.drain();
  }
}
