import type { AgentSession, AgentEvent } from "./runtime.js";
import { SESSION_STATUS } from "@grackle-ai/common";
import type { SessionStatus } from "@grackle-ai/common";
import { AsyncQueue } from "../utils/async-queue.js";
import { logger } from "../logger.js";

/**
 * Abstract base class for agent sessions that use the eventQueue + waiting_input lifecycle.
 *
 * Provides the shared session lifecycle:
 * - `stream()` yields an initial system message, drives `runSession()` in the background,
 *   and yields events from the queue.
 * - `runSession()` calls `setupSdk()`, handles resume vs initial query, transitions to waiting_input.
 * - `sendInput()` transitions to running, delegates to `executeFollowUp()`, transitions back.
 * - `kill()` aborts active work, releases resources, and closes the queue.
 *
 * Subclasses implement the SDK-specific abstract methods.
 */
export abstract class BaseAgentSession implements AgentSession {
  public id: string;
  public abstract runtimeName: string;
  public runtimeSessionId: string;
  public status: SessionStatus = SESSION_STATUS.RUNNING;

  protected readonly eventQueue: AsyncQueue<AgentEvent> = new AsyncQueue<AgentEvent>();
  protected killed: boolean = false;
  protected readonly prompt: string;
  protected readonly model: string;
  protected readonly maxTurns: number;
  protected readonly resumeSessionId?: string;
  protected readonly branch?: string;
  protected readonly worktreeBasePath?: string;
  protected readonly systemContext?: string;
  protected readonly mcpServers?: Record<string, unknown>;
  protected readonly hooks?: Record<string, unknown>;

  /** Human-readable display name for system messages (e.g. "Claude Code", "Codex"). */
  protected abstract readonly runtimeDisplayName: string;

  /** Error message displayed when the initial query returns zero messages. */
  protected abstract readonly noMessagesError: string;

  public constructor(
    id: string,
    prompt: string,
    model: string,
    maxTurns: number,
    resumeSessionId?: string,
    branch?: string,
    worktreeBasePath?: string,
    systemContext?: string,
    mcpServers?: Record<string, unknown>,
    hooks?: Record<string, unknown>,
  ) {
    this.id = id;
    this.prompt = prompt;
    this.model = model;
    this.maxTurns = maxTurns;
    this.resumeSessionId = resumeSessionId;
    this.branch = branch;
    this.worktreeBasePath = worktreeBasePath;
    this.systemContext = systemContext;
    this.mcpServers = mcpServers;
    this.hooks = hooks;
    this.runtimeSessionId = resumeSessionId ?? "";
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
   */
  protected abstract setupForResume(): Promise<void>;

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

  /** Check whether the session is ready to accept follow-up input via `sendInput()`. */
  protected abstract canAcceptInput(): boolean;

  /** Abort the currently active stream or query. */
  protected abstract abortActive(): void;

  /**
   * Release SDK resources for garbage collection.
   * Called on kill and on fatal error. Default is a no-op.
   */
  protected releaseResources(): void {
    // Default: no-op. Override in subclasses that hold SDK references.
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
      this.status = SESSION_STATUS.FAILED;
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
        return;
      }

      // Build final prompt with system context
      const finalPrompt = this.systemContext
        ? `${this.systemContext}\n\n---\n\n${this.prompt}`
        : this.prompt;

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
      // The queue stays open so sendInput() can push more events.
      this.status = SESSION_STATUS.IDLE;
      this.eventQueue.push({ type: "status", timestamp: ts(), content: "waiting_input" });
    } catch (err) {
      this.status = SESSION_STATUS.FAILED;
      this.eventQueue.push({ type: "error", timestamp: ts(), content: String(err) });
      this.eventQueue.push({ type: "status", timestamp: ts(), content: "failed" });
      this.releaseResources();
      this.eventQueue.close();
    }
  }

  /** Send follow-up input by delegating to the SDK-specific `executeFollowUp()`. */
  public sendInput(text: string): void {
    if (this.killed || !this.canAcceptInput()) {
      return;
    }
    const ts: () => string = () => new Date().toISOString();
    this.status = SESSION_STATUS.RUNNING;
    this.eventQueue.push({ type: "status", timestamp: ts(), content: "running" });

    this.executeFollowUp(text)
      .then(() => {
        if (this.killed) {
          // Session was terminated during follow-up (e.g. maxTurns reached).
          // Release resources and close the queue so stream() callers don't hang.
          this.releaseResources();
          this.eventQueue.close();
        } else {
          this.status = SESSION_STATUS.IDLE;
          this.eventQueue.push({ type: "status", timestamp: ts(), content: "waiting_input" });
        }
      })
      .catch((err: unknown) => {
        logger.warn({ err }, `Failed to process follow-up input in ${this.runtimeDisplayName} session`);
        this.eventQueue.push({ type: "error", timestamp: ts(), content: String(err) });
      });
  }

  /** Forcefully terminate the session. */
  public kill(): void {
    this.killed = true;
    this.status = SESSION_STATUS.INTERRUPTED;
    this.abortActive();
    this.releaseResources();
    this.eventQueue.close();
  }
}
