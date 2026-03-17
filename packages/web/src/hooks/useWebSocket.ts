/**
 * Low-level WebSocket transport hook.
 *
 * Manages connection lifecycle, automatic reconnection, and auth redirects.
 * Domain hooks register via the `onMessage` / `onConnect` / `onDisconnect`
 * callbacks passed in through {@link UseWebSocketOptions}.
 *
 * @module
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { PAIR_PATH } from "../utils/navigation.js";
import type { WsMessage, SendFunction } from "./types.js";
import { parseWsMessage, WS_RECONNECT_DELAY_MS, WS_CLOSE_UNAUTHORIZED } from "./types.js";

/** Options accepted by {@link useWebSocket}. */
export interface UseWebSocketOptions {
  /** Called for every parsed incoming message. */
  onMessage: (msg: WsMessage) => void;
  /** Called when the socket opens — use to send initial data requests. */
  onConnect: (send: SendFunction) => void;
  /** Called when the socket closes (before reconnect scheduling). */
  onDisconnect?: () => void;
}

/** Values returned by {@link useWebSocket}. */
export interface UseWebSocketResult {
  /** Whether the WebSocket is currently connected. */
  connected: boolean;
  /** Send a message over the WebSocket (no-op when disconnected). */
  send: SendFunction;
}

/**
 * Hook that manages a WebSocket connection with automatic reconnect and
 * unauthorized-redirect handling.
 *
 * @param url - The WebSocket URL to connect to.
 * @param options - Callbacks for message routing, connect, and disconnect events.
 * @returns Connection state and a send function.
 */
export function useWebSocket(
  url: string | undefined,
  options: UseWebSocketOptions,
): UseWebSocketResult {
  const wsUrl =
    url ||
    (typeof window !== "undefined"
      ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`
      : "ws://localhost:3000");

  const wsRef = useRef<WebSocket | undefined>(undefined);
  const [connected, setConnected] = useState(false);

  // Store callbacks in refs so the effect doesn't re-run when they change.
  const onMessageRef = useRef(options.onMessage);
  onMessageRef.current = options.onMessage;
  const onConnectRef = useRef(options.onConnect);
  onConnectRef.current = options.onConnect;
  const onDisconnectRef = useRef(options.onDisconnect);
  onDisconnectRef.current = options.onDisconnect;

  const send = useCallback((msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect(): void {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        onConnectRef.current(send);
      };

      ws.onmessage = (e: MessageEvent<unknown>) => {
        if (typeof e.data !== "string") {
          console.warn("[ws] Received non-string WebSocket message; ignoring");
          return;
        }
        const msg = parseWsMessage(e.data);
        if (!msg) {
          return;
        }
        onMessageRef.current(msg);
      };

      ws.onclose = (event: CloseEvent) => {
        setConnected(false);
        wsRef.current = undefined;
        onDisconnectRef.current?.();
        clearTimeout(reconnectTimer);

        // If the server rejected us as unauthorized, redirect to the pairing page
        if (event.code === WS_CLOSE_UNAUTHORIZED) {
          window.location.href = PAIR_PATH;
          return;
        }

        reconnectTimer = setTimeout(connect, WS_RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ws may be uninitialized if cleanup runs before connect()
      ws?.close();
    };
  }, [wsUrl, send]);

  return { connected, send };
}
