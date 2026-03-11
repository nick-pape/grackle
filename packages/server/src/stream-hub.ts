import type { grackle } from "@grackle-ai/common";

type SessionEvent = grackle.SessionEvent;
type Subscriber = (event: SessionEvent) => void;

const sessionSubs: Map<string, Set<Subscriber>> = new Map<string, Set<Subscriber>>();
const globalSubs: Set<Subscriber> = new Set<Subscriber>();

/** Broadcast a session event to all session-specific and global subscribers. */
export function publish(event: SessionEvent): void {
  // Notify session-specific subscribers
  const subs = sessionSubs.get(event.sessionId);
  if (subs) {
    for (const sub of subs) sub(event);
  }
  // Notify global subscribers
  for (const sub of globalSubs) sub(event);
}

/** Create a cancellable async iterable that yields events for a specific session. */
export function createStream(sessionId: string): AsyncIterable<SessionEvent> & { cancel(): void } {
  const queue: SessionEvent[] = [];
  let waiting: (() => void) | undefined = undefined;
  const state: { done: boolean } = { done: false };

  const subscriber: Subscriber = (event: SessionEvent) => {
    queue.push(event);
    if (waiting) {
      waiting();
      waiting = undefined;
    }
  };

  // Subscribe
  let subs: Set<Subscriber> | undefined = sessionSubs.get(sessionId);
  if (!subs) {
    subs = new Set();
    sessionSubs.set(sessionId, subs);
  }
  subs.add(subscriber);

  const stream: AsyncIterable<SessionEvent> & { cancel(): void } = {
    cancel() {
      state.done = true;
      subs!.delete(subscriber);
      if (subs!.size === 0) sessionSubs.delete(sessionId);
      if (waiting) waiting();
    },
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<SessionEvent>> {
          while (queue.length === 0 && !state.done) {
            await new Promise<void>((resolve: () => void) => { waiting = resolve; });
          }
          if (queue.length > 0) {
            return { value: queue.shift()!, done: false };
          }
          return { value: undefined as unknown as SessionEvent, done: true };
        },
      };
    },
  };

  return stream;
}

/** Create a cancellable async iterable that yields events from all sessions. */
export function createGlobalStream(): AsyncIterable<SessionEvent> & { cancel(): void } {
  const queue: SessionEvent[] = [];
  let waiting: (() => void) | undefined = undefined;
  const state: { done: boolean } = { done: false };

  const subscriber: Subscriber = (event: SessionEvent) => {
    queue.push(event);
    if (waiting) {
      waiting();
      waiting = undefined;
    }
  };

  globalSubs.add(subscriber);

  const stream: AsyncIterable<SessionEvent> & { cancel(): void } = {
    cancel() {
      state.done = true;
      globalSubs.delete(subscriber);
      if (waiting) waiting();
    },
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<SessionEvent>> {
          while (queue.length === 0 && !state.done) {
            await new Promise<void>((resolve: () => void) => { waiting = resolve; });
          }
          if (queue.length > 0) {
            return { value: queue.shift()!, done: false };
          }
          return { value: undefined as unknown as SessionEvent, done: true };
        },
      };
    },
  };

  return stream;
}
