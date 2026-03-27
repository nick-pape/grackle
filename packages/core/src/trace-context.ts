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

/** Maximum length for a trace ID to prevent log bloat. */
const MAX_TRACE_ID_LENGTH: number = 128;

/** Allowed character set for trace IDs: alphanumeric, hyphens, underscores, dots. */
const TRACE_ID_PATTERN: RegExp = /^[A-Za-z0-9_.-]+$/;

/** Validate that a trace ID is non-empty, within length limits, and uses safe characters. */
export function isValidTraceId(value: string | undefined): boolean {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_TRACE_ID_LENGTH
    && TRACE_ID_PATTERN.test(value);
}
