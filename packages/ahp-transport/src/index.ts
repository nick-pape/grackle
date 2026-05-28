/**
 * `@grackle-ai/ahp-transport` — WebSocket + JSON-RPC 2.0 framing primitive
 * for the Agent Host Protocol (AHP) wire. Provides the low-level transport
 * layer that {@link MultiHostClient} (HR8b) and the PowerLine AHP host
 * (HR8d) build on. The package is consumer-agnostic: it ships the framing,
 * auth handshake, and reconnect semantics; channel-scoped concerns
 * (per-`(host, channel)` `serverSeq` tracking, subscription replay, the
 * generation counter for stale-handle invalidation) live one layer up.
 */

export { JsonRpcSession } from "./json-rpc-session.js";
export type {
  JsonRpcSessionOptions,
  RequestHandler,
  NotificationHandler,
} from "./json-rpc-session.js";

export { AhpServerSocket } from "./ahp-server-socket.js";
export type {
  AhpServerSocketOptions,
  AhpServerConnection,
} from "./ahp-server-socket.js";

export { AhpClientSocket } from "./ahp-client-socket.js";
export type {
  AhpClientSocketOptions,
  AhpConnectionState,
} from "./ahp-client-socket.js";

export type { ClientIdStore } from "./client-id-store.js";
export { FileClientIdStore, InMemoryClientIdStore } from "./client-id-store.js";

export { exponentialBackoff } from "./backoff.js";
export type { BackoffPolicy, ExponentialBackoffOptions } from "./backoff.js";

export { TransportError, WsCloseCode } from "./error-codes.js";
export type { TransportErrorKind } from "./error-codes.js";
