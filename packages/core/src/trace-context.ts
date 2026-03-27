import { AsyncLocalStorage } from "node:async_hooks";

/** Trace context carried through async operations via AsyncLocalStorage. */
interface TraceContext {
  traceId: string;
}

const store: AsyncLocalStorage<TraceContext> = new AsyncLocalStorage<TraceContext>();

/** Retrieve the active trace ID, or undefined if no trace context is active. */
export function getTraceId(): string | undefined {
  return store.getStore()?.traceId;
}

/** Run a callback within a trace context so that {@link getTraceId} returns `traceId`. */
export function runWithTrace<T>(traceId: string, fn: () => T): T {
  return store.run({ traceId }, fn);
}
