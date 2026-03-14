import { logger } from "./logger.js";

/** Mutable task context for a running event processor. */
export interface ProcessorContext {
  sessionId: string;
  logPath: string;
  projectId: string;
  taskId: string;
  onComplete?: () => void;
}

/** Registry of active event processor contexts, keyed by sessionId. */
const registry: Map<string, ProcessorContext> = new Map<string, ProcessorContext>();

/** Callbacks invoked when a processor's task context is late-bound. */
const bindListeners: Map<string, Array<() => void>> = new Map<string, Array<() => void>>();

/** Register a processor context for a running event stream. */
export function register(ctx: ProcessorContext): void {
  registry.set(ctx.sessionId, ctx);
}

/** Unregister a processor context when the event stream ends. */
export function unregister(sessionId: string): void {
  registry.delete(sessionId);
  bindListeners.delete(sessionId);
}

/** Retrieve the context for a running event processor, if any. */
export function get(sessionId: string): ProcessorContext | undefined {
  return registry.get(sessionId);
}

/**
 * Late-bind a task to a running processor. Updates projectId, taskId, and onComplete,
 * then fires all registered bind listeners.
 *
 * Idempotent: binding to the same task is a no-op.
 * Throws if the session is already bound to a different task (FR-6).
 * Throws if the session is not registered (not actively processing).
 */
export function lateBind(
  sessionId: string,
  taskId: string,
  projectId: string,
  onComplete?: () => void,
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

  ctx.projectId = projectId;
  ctx.taskId = taskId;
  if (onComplete) {
    ctx.onComplete = onComplete;
  }

  logger.info({ sessionId, taskId, projectId }, "Late-bound session to task");

  const listeners = bindListeners.get(sessionId);
  if (listeners) {
    for (const listener of listeners) {
      listener();
    }
  }
}

/** Register a callback to be invoked when lateBind is called for this session. */
export function onBind(sessionId: string, listener: () => void): void {
  let listeners = bindListeners.get(sessionId);
  if (!listeners) {
    listeners = [];
    bindListeners.set(sessionId, listeners);
  }
  listeners.push(listener);
}
