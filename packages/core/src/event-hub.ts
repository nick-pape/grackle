/**
 * Unified event hub — merges session events (streamHub) and domain events
 * (event-bus) into a single async iterable of ServerEvent proto messages.
 *
 * Replaces the WebSocket broadcast layer. Each call to {@link createEventStream}
 * returns an independent stream that receives both event types.
 *
 * @module
 */

import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import * as streamHub from "./stream-hub.js";
import { subscribe, type GrackleEvent } from "./event-bus.js";

/**
 * A cancellable event stream that yields ServerEvent proto messages.
 */
export interface EventStream {
  /** Async iterable of ServerEvent (session events + domain events). */
  [Symbol.asyncIterator](): AsyncIterator<grackle.ServerEvent>;
  /** Cancel the stream and clean up subscriptions. */
  cancel(): void;
}

/**
 * Create a unified event stream that merges session events and domain events.
 *
 * The stream yields `ServerEvent` proto messages with either a `sessionEvent`
 * or `domainEvent` variant. Callers iterate the stream and route events by type.
 *
 * Call `cancel()` to stop the stream and clean up all subscriptions.
 */
export function createEventStream(): EventStream {
  let cancelled: boolean = false;
  const queue: grackle.ServerEvent[] = [];
  let pendingResolve: (() => void) | undefined;

  /** Push an event into the queue and wake any waiting consumer. */
  function enqueue(event: grackle.ServerEvent): void {
    if (cancelled) {
      return;
    }
    queue.push(event);
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = undefined;
      r();
    }
  }

  // Subscribe to session events (from stream-hub global stream)
  const sessionStream = streamHub.createGlobalStream();
  const sessionPump = (async (): Promise<void> => {
    for await (const event of sessionStream) {
      enqueue(
        create(grackle.ServerEventSchema, {
          event: { case: "sessionEvent", value: event },
        }),
      );
    }
  })();
  // Suppress unhandled rejection — pump ends when sessionStream is cancelled
  sessionPump.catch(() => {});

  // Subscribe to domain events (from event-bus)
  const unsubscribeDomain = subscribe((event: GrackleEvent) => {
    enqueue(
      create(grackle.ServerEventSchema, {
        event: {
          case: "domainEvent",
          value: create(grackle.DomainEventSchema, {
            id: event.id,
            type: event.type,
            timestamp: event.timestamp,
            payloadJson: JSON.stringify(event.payload),
          }),
        },
      }),
    );
  });

  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<grackle.ServerEvent> {
      // eslint-disable-next-line no-unmodified-loop-condition -- cancelled is set by cancel() from outside
      while (!cancelled) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          // Wait for the next event
          await new Promise<void>((resolve) => {
            pendingResolve = resolve;
          });
        }
      }
    },

    cancel(): void {
      cancelled = true;
      sessionStream.cancel();
      unsubscribeDomain();
      // Wake any waiting consumer so the iterator exits
      if (pendingResolve) {
        pendingResolve();
      }
    },
  };
}
