import { logger } from "./logger.js";

/** Mutable task context for a running event processor. */
export interface ProcessorContext {
  sessionId: string;
  logPath: string;
  workspaceId?: string;
  taskId: string;
  /** Set when a budget-exceeded SIGTERM has been sent to this session. */
  budgetSigtermSent?: boolean;
}

/** Registry of active event processor contexts, keyed by sessionId. */
const registry: Map<string, ProcessorContext> = new Map<string, ProcessorContext>();

/** Register a processor context for a running event stream. */
export function register(ctx: ProcessorContext): void {
  registry.set(ctx.sessionId, ctx);
}

/** Unregister a processor context when the event stream ends. */
export function unregister(sessionId: string): void {
  registry.delete(sessionId);
}

/** Retrieve the context for a running event processor, if any. */
export function get(sessionId: string): ProcessorContext | undefined {
  return registry.get(sessionId);
}

/**
 * Late-bind a task to a running processor. Updates workspaceId and taskId so
 * subsequent events are attributed to the task.
 *
 * Idempotent: binding to the same task is a no-op.
 * Throws if the session is already bound to a different task (FR-6).
 * Throws if the session is not registered (not actively processing).
 */
export function lateBind(
  sessionId: string,
  taskId: string,
  workspaceId?: string,
): void {
  const ctx = registry.get(sessionId);
  if (!ctx) {
    throw new Error(`No active event processor for session ${sessionId}`);
  }

  if (ctx.taskId !== "" && ctx.taskId !== taskId) {
    throw new Error(
      `Session ${sessionId} is already bound to task ${ctx.taskId}, cannot rebind to ${taskId}`,
    );
  }

  if (ctx.taskId === taskId) {
    logger.info({ sessionId, taskId }, "Late-bind no-op: session already bound to this task");
    return;
  }

  ctx.workspaceId = workspaceId;
  ctx.taskId = taskId;

  logger.info({ sessionId, taskId, workspaceId }, "Late-bound session to task");
}
