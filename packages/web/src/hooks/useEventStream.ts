/**
 * ConnectRPC event stream hook — replaces the WebSocket transport.
 *
 * Calls `coreClient.streamEvents({})` to receive a unified stream of
 * session events and domain events. Handles auto-reconnect with a fixed delay.
 *
 * @module
 */

import { useState, useEffect, useRef } from "react";
import { ConnectError, Code } from "@connectrpc/connect";
import { coreClient as grackleClient } from "./useGrackleClient.js";
import type { ConnectionStatus } from "@grackle-ai/web-components";
import { PAIR_PATH } from "@grackle-ai/web-components";

/** Reconnect delay in milliseconds. */
export const RECONNECT_DELAY_MS: number = 3_000;

/**
 * Grace period before marking the stream as "connected" when no event has been received.
 * Matches the reconnect delay so that the two values cannot drift independently.
 * Must exceed the worst-case ECONNREFUSED propagation time (~2 s on Windows HTTP/2
 * due to connection-pool reuse) so that a failed reconnect attempt never briefly
 * shows "Connected" before reverting to "Connecting...".
 */
export const CONNECT_GRACE_PERIOD_MS: number = RECONNECT_DELAY_MS;

/** Options for the event stream hook. */
export interface UseEventStreamOptions {
  /** Called for each session event (agent output, status changes). */
  onSessionEvent: (event: { sessionId: string; type: number; timestamp: string; content: string; raw: string }) => void;
  /** Called for each domain event (task.created, environment.changed, etc.). */
  onDomainEvent: (event: { id: string; type: string; timestamp: string; payloadJson: string }) => void;
  /** Called immediately after a new stream is created (including reconnects), before any events are received. */
  onConnect?: () => void | Promise<void>;
  /** Called when the stream disconnects. */
  onDisconnect?: () => void;
}

/** Return value of the event stream hook. */
export interface UseEventStreamResult {
  /** Current connection state of the event stream. */
  connectionStatus: ConnectionStatus;
}

/**
 * Hook that subscribes to the unified `StreamEvents` gRPC server-streaming RPC.
 * Replaces `useWebSocket` — no more WebSocket transport.
 */
export function useEventStream(options: UseEventStreamOptions): UseEventStreamResult {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");

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
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;

    async function connectStream(): Promise<void> {
      if (cancelled) {
        return;
      }

      // Fire onConnect immediately — data loading is optimistic and domain
      // hooks handle request failures gracefully.  This is kept separate from
      // the "connected" status so the UI status accurately reflects stream
      // liveness without delaying data fetching.
      Promise.resolve(onConnectRef.current?.()).catch(() => {});

      // Transition to "connected" on first data received OR after a grace
      // period for servers that are alive but idle.
      // On Windows, HTTP/2 connection-pool reuse means ECONNREFUSED can take
      // ~2 s to propagate.  3 000 ms ensures the timer is cancelled before it
      // fires when the server is unreachable (matching the reconnect delay for
      // symmetry).
      let markedConnected: boolean = false;
      const markConnected = (): void => {
        if (!markedConnected && !cancelled) {
          markedConnected = true;
          setConnectionStatus("connected");
        }
      };
      connectTimer = setTimeout(markConnected, CONNECT_GRACE_PERIOD_MS);

      try {
        const stream = grackleClient.streamEvents({});

        for await (const serverEvent of stream) {
          markConnected(); // also fire immediately on first data
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
        clearTimeout(connectTimer);
        // Redirect to pairing page on unauthenticated error
        if (err instanceof ConnectError && err.code === Code.Unauthenticated) {
          window.location.href = PAIR_PATH;
          return;
        }
      }

      clearTimeout(connectTimer);
      // Stream ended or errored — schedule reconnect.
      // Show "connecting" during the retry delay rather than "disconnected",
      // so the UI does not oscillate between states on transient drops.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- set by cleanup function
      if (!cancelled) {
        setConnectionStatus("connecting");
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
      clearTimeout(connectTimer);
      // No state update here: React 18 StrictMode double-invokes the cleanup
      // while the component is still mounted, which can cause unexpected state
      // flashes. After a real unmount, state updates are silently dropped by
      // React anyway.
    };
  }, []);

  return { connectionStatus };
}
