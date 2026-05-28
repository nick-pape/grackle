/**
 * Local transport-layer errors. These are NEVER sent on the wire — they are
 * thrown / used to reject pending promises inside this package when a request
 * cannot complete (connection lost, timed out, etc.).
 *
 * On-the-wire JSON-RPC + AHP error codes live in `@grackle-ai/ahp`'s
 * `JsonRpcErrorCodes` / `AhpErrorCodes` (spec-defined integers).
 */

/** Discriminator for {@link TransportError}. */
export type TransportErrorKind =
  /** A pending request was abandoned because the underlying socket closed. */
  | "connection-lost"
  /** A pending request exceeded its `requestTimeoutMs`. */
  | "request-timeout"
  /** Authentication was rejected by the host (HTTP 401 on upgrade, or close-code 4401). */
  | "auth-failed"
  /** Peer sent a binary frame; we close 1003 and abort. */
  | "binary-frame"
  /** Peer sent a non-`initialize` request before the handshake completed. */
  | "not-initialized"
  /** Peer sent `initialize` twice on the same connection. */
  | "already-initialized"
  /** Operation attempted after the caller invoked `.close()`. */
  | "user-closed";

/** Error thrown / used to reject promises for transport-internal failures. */
export class TransportError extends Error {
  public readonly kind: TransportErrorKind;

  public constructor(kind: TransportErrorKind, message: string) {
    super(message);
    this.name = "TransportError";
    this.kind = kind;
  }
}

/**
 * WebSocket close codes used by this package. The 4xxx range is the
 * application-defined range per [RFC 6455 §7.4.2](https://www.rfc-editor.org/rfc/rfc6455#section-7.4.2).
 */
export const WsCloseCode = {
  /** Normal closure initiated by either peer. */
  Normal: 1000,
  /** Peer sent a binary frame; we don't speak binary. */
  UnsupportedData: 1003,
  /** Heartbeat: 2 consecutive missed pongs. */
  HeartbeatTimeout: 4001,
  /** Auth rejected mid-session (rare; pre-upgrade auth covers most cases). */
  AuthRejected: 4401,
} as const;

export type WsCloseCode = (typeof WsCloseCode)[keyof typeof WsCloseCode];
