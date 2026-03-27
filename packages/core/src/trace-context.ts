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

/**
 * Wrap an AsyncIterable so that each iteration step runs within the given trace context.
 * This is needed for streaming RPCs where the generator body runs outside the interceptor's
 * {@link runWithTrace} scope.
 */
export function wrapAsyncIterableWithTrace<T>(traceId: string, iterable: AsyncIterable<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      const iterator = iterable[Symbol.asyncIterator]();
      return {
        next(): Promise<IteratorResult<T>> {
          return store.run({ traceId }, () => iterator.next());
        },
        return(value?: unknown): Promise<IteratorResult<T>> {
          if (iterator.return) {
            return store.run({ traceId }, () => iterator.return!(value));
          }
          return Promise.resolve({ done: true, value: undefined as unknown as T });
        },
      };
    },
  };
}
