/**
 * Per-stream subagent delegation tracker.
 *
 * Manages the `delegationByToolCall` Map that links a parent session's
 * `tool_use` event to the child session it materialized, so the paired
 * `tool_result` can append/close that child, and so the finally block can
 * interrupt any synchronous-spawn child still open when the stream ends.
 *
 * Extracted from {@link ./event-processor.ts} (#1075 block) because it is
 * a self-contained concern with its own mutable state and lifecycle.
 * One tracker is created per `processEventStream` invocation.
 */
import {
  detectDelegation,
  delegationIdentityKey,
  deriveChildSessionId,
  readAgentResultStatus,
} from "@grackle-ai/common";
import { logger } from "./logger.js";
import {
  ensureChildSession,
  closeChildSession,
  appendChildActivity,
  interruptChildSession,
  unwrapResultContent,
} from "./subagent-session.js";

/** Per-call state for a delegation tool_use → child session link. */
interface DelegationLink {
  childId: string;
  isPoll: boolean;
  isBackground: boolean;
}

/**
 * Tracks subagent delegation for one parent event stream (#1075).
 *
 * Maps `tool_use` call IDs to the child sessions they materialized so the
 * paired `tool_result` can close/append the child. On stream end, any
 * synchronous-spawn children still in the map are interrupted.
 */
export class DelegationTracker {
  private readonly sessionId: string;
  private readonly delegationByToolCall: Map<string, DelegationLink> = new Map();

  /** @param sessionId - The parent session ID this tracker is scoped to. */
  public constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Process a `tool_use` event. If the tool is a delegation tool (Claude `Agent`,
   * Copilot `task`/`read_agent`, etc.), materialize a child session and record the link.
   */
  public onToolUse(eventToolCallId: string, eventContent: string): void {
    try {
      const parsed = JSON.parse(eventContent || "{}") as Record<string, unknown>;
      const toolName = String(parsed.tool ?? parsed.tool_name ?? parsed.name ?? "");
      const toolArgs = parsed.args ?? parsed.input ?? parsed.arguments;
      const info = toolName ? detectDelegation(toolName, toolArgs) : undefined;
      if (info) {
        const identityKey = delegationIdentityKey(info, eventToolCallId);
        const childId = deriveChildSessionId(this.sessionId, identityKey);
        ensureChildSession({
          childSessionId: childId,
          parentSessionId: this.sessionId,
          info,
        });
        this.delegationByToolCall.set(eventToolCallId, {
          childId,
          isPoll: info.isPoll === true,
          isBackground: info.isBackground === true,
        });
      }
    } catch (err) {
      logger.warn({ err, sessionId: this.sessionId }, "Failed to process delegation tool_use");
    }
  }

  /**
   * Process a `tool_result` event. If the call ID matches a tracked delegation,
   * close or append to the child session based on its spawn type.
   */
  public onToolResult(
    eventToolCallId: string,
    eventContent: string,
    eventToolError: boolean,
  ): void {
    const link = this.delegationByToolCall.get(eventToolCallId);
    if (!link) {
      return;
    }
    // Every tool_result pairs (and consumes) its tool_use entry, so only
    // genuinely-unpaired synchronous spawns remain in the map for the
    // finally block to interrupt. A background/polled child whose work
    // outlives the parent stream is independent and must NOT be interrupted.
    this.delegationByToolCall.delete(eventToolCallId);
    if (link.isPoll) {
      // A read_agent poll surfaces partial output. On a terminal status,
      // closeChildSession records the result and stops the child; otherwise
      // append the partial output. Recording happens in exactly one path so
      // the terminal poll output isn't duplicated in the child log.
      // Unwrap first: the result may be a JSON envelope
      // ({"is_ok":true,"content":"Agent completed. agent_id: …"}), and the
      // status prefix lives in `content`, not the envelope.
      const status = readAgentResultStatus(unwrapResultContent(eventContent));
      if (
        status === "completed" ||
        status === "failed" ||
        status === "error" ||
        status === "cancelled"
      ) {
        closeChildSession(link.childId, eventContent, status !== "completed");
      } else {
        appendChildActivity(link.childId, eventContent);
      }
    } else if (link.isBackground) {
      // A background spawn's result is just a handle, not completion —
      // keep the child running; its output arrives via read_agent polls.
      appendChildActivity(link.childId, eventContent);
    } else {
      // Synchronous spawn (e.g. Claude `Agent`): the result IS the summary.
      closeChildSession(link.childId, eventContent, eventToolError);
    }
  }

  /**
   * Called from the `finally` block when the stream ends.
   * Interrupts any synchronous-spawn child still open (i.e. the stream ended
   * before the paired `tool_result` arrived). Background and polled children
   * run independently and must NOT be interrupted here.
   */
  public onStreamEnd(): void {
    for (const link of this.delegationByToolCall.values()) {
      if (!link.isBackground && !link.isPoll) {
        interruptChildSession(link.childId);
      }
    }
    this.delegationByToolCall.clear();
  }
}
