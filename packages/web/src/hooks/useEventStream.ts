/**
 * ConnectRPC event stream hook — replaces the WebSocket transport.
 *
 * Calls `grackleClient.streamEvents({})` to receive a unified stream of
 * session events and domain events. Handles auto-reconnect with backoff.
 *
 * @module
 */

import { useState, useEffect, useRef } from "react";
import { ConnectError, Code } from "@connectrpc/connect";
import { grackleClient } from "./useGrackleClient.js";
import { PAIR_PATH } from "../utils/navigation.js";

/** Reconnect delay in milliseconds. */
const RECONNECT_DELAY_MS: number = 3_000;

/** Options for the event stream hook. */
export interface UseEventStreamOptions {
  /** Called for each session event (agent output, status changes). */
  onSessionEvent: (event: { sessionId: string; type: number; timestamp: string; content: string; raw: string }) => void;
  /** Called for each domain event (task.created, environment.changed, etc.). */
  onDomainEvent: (event: { id: string; type: string; timestamp: string; payloadJson: string }) => void;
  /** Called immediately after a new stream is created (including reconnects), before any events are received. */
  onConnect?: () => void;
  /** Called when the stream disconnects. */
  onDisconnect?: () => void;
}

/** Return value of the event stream hook. */
export interface UseEventStreamResult {
  /** Whether the event stream is currently connected. */
  connected: boolean;
}

/**
 * Hook that subscribes to the unified `StreamEvents` gRPC server-streaming RPC.
 * Replaces `useWebSocket` — no more WebSocket transport.
 */
export function useEventStream(options: UseEventStreamOptions): UseEventStreamResult {
  const [connected, setConnected] = useState(false);

  // Store callbacks in refs so the effect doesn't re-run when they change.
  const onSessionEventRef = useRef(options.onSessionEvent);
  onSessionEventRef.current = options.onSessionEvent;
  const onDomainEventRef = useRef(options.onDomainEvent);
  onDomainEventRef.current = options.onDomainEvent;
  const onConnectRef = useRef(options.onConnect);
  onConnectRef.current = options.onConnect;
  const onDisconnectRef = useRef(options.onDisconnect);
  onDisconnectRef.current = options.onDisconnect;

  useEffect(() => {
    let cancelled: boolean = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    async function connectStream(): Promise<void> {
      if (cancelled) {
        return;
      }

      try {
        const stream = grackleClient.streamEvents({});

        // Mark connected immediately — ConnectRPC streams don't have a
        // separate "open" event. The stream object exists once the HTTP
        // request is initiated. Data loading in onConnect runs optimistically.
        setConnected(true);
        onConnectRef.current?.();

        for await (const serverEvent of stream) {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- set by cleanup function
          if (cancelled) {
            break;
          }

          // Route the event based on the oneof case
          const evt = serverEvent.event;
          if (evt.case === "sessionEvent") {
            const v = evt.value;
            onSessionEventRef.current({
              sessionId: v.sessionId,
              type: v.type,
              timestamp: v.timestamp,
              content: v.content,
              raw: v.raw,
            });
          } else if (evt.case === "domainEvent") {
            const v = evt.value;
            onDomainEventRef.current({
              id: v.id,
              type: v.type,
              timestamp: v.timestamp,
              payloadJson: v.payloadJson,
            });
          }
        }
      } catch (err) {
        // Redirect to pairing page on unauthenticated error
        if (err instanceof ConnectError && err.code === Code.Unauthenticated) {
          window.location.href = PAIR_PATH;
          return;
        }
      }

      // Stream ended or errored — reconnect
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- set by cleanup function
      if (!cancelled) {
        setConnected(false);
        onDisconnectRef.current?.();
        reconnectTimer = setTimeout(() => {
          connectStream().catch(() => {});
        }, RECONNECT_DELAY_MS);
      }
    }

    connectStream().catch(() => {});

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      setConnected(false);
    };
  }, []);

  return { connected };
}
