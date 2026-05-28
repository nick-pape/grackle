/**
 * Server-side AHP transport. Mounts on an existing HTTP/HTTP2 server,
 * authenticates the upgrade request via `Authorization: Bearer <token>`,
 * runs the AHP `initialize` handshake, then surfaces an
 * {@link AhpServerConnection} (with a ready-to-use {@link JsonRpcSession})
 * to the application.
 *
 * Heartbeat: WebSocket-level pings every 30s; 2 consecutive missed pongs
 * close with code 4001.
 */

import type {
  InitializeParams,
  InitializeResult,
  AhpNotification,
  AhpRequest,
  AhpResponse,
} from "@grackle-ai/ahp";
import { JsonRpcErrorCodes } from "@grackle-ai/ahp";
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Http2SecureServer } from "node:http2";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";

import { WsCloseCode } from "./error-codes.js";
import { Heartbeat } from "./heartbeat.js";
import { JsonRpcSession, type RequestHandlerResult } from "./json-rpc-session.js";

/** Default WS path mounted on the host HTTP server. */
const DEFAULT_PATH = "/ahp";

/** Default ping interval in milliseconds. */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
/** Default number of consecutive missed pongs before close-4001. */
const DEFAULT_HEARTBEAT_MISSED_LIMIT = 2;

/** A connected, fully-initialized AHP client. */
export interface AhpServerConnection {
  /** Client-supplied stable identifier from `InitializeParams.clientId`. */
  readonly clientId: string;
  /** The initialize params the client sent. */
  readonly initializeParams: InitializeParams;
  /** Bidirectional JSON-RPC session for this connection. */
  readonly session: JsonRpcSession;
  /** Remote socket address, if known. */
  readonly remoteAddress: string | undefined;
}

/** Construction options for {@link AhpServerSocket}. */
export interface AhpServerSocketOptions {
  /** Host HTTP/HTTP2 server. The socket attaches an "upgrade" listener. */
  readonly server: HttpServer | Http2SecureServer;
  /** Bearer token validated on the HTTP upgrade. Pass "" to disable auth (dev only). */
  readonly powerlineToken: string;
  /** Path component of the WS URL. Defaults to "/ahp". */
  readonly path?: string;
  /**
   * Builds the `InitializeResult` (from `@grackle-ai/ahp`) given the client's
   * `InitializeParams`. May return a Promise. Throw or reject to fail the
   * handshake — the session will receive a JSON-RPC error response and close.
   */
  readonly onInitialize: (params: InitializeParams) => Promise<InitializeResult> | InitializeResult;
  /** Handles requests other than `initialize`. */
  readonly onRequest?: (req: AhpRequest, conn: AhpServerConnection) => Promise<AhpResponse>;
  /**
   * Handles client→server notifications (e.g., `dispatchAction`, `unsubscribe`).
   * Fires only after the handshake completes; pre-initialize notifications are dropped.
   */
  readonly onNotification?: (notif: AhpNotification, conn: AhpServerConnection) => void;
  /** Called once the handshake succeeds and the connection is usable. */
  readonly onConnection?: (conn: AhpServerConnection) => void;
  /** Called when a connection closes. */
  readonly onDisconnect?: (clientId: string, code: number, reason: string) => void;
  /** Override the WS-level ping interval (testing). Default 30_000ms. */
  readonly heartbeatIntervalMs?: number;
  /** Override the missed-pong threshold (testing). Default 2. */
  readonly heartbeatMissedLimit?: number;
}

/** Per-connection bookkeeping. */
interface ConnectionState {
  socket: WebSocket;
  session: JsonRpcSession;
  /** Populated by the `initialize` handler once the handshake completes. */
  connection: AhpServerConnection | undefined;
  heartbeat: Heartbeat;
}

/**
 * AHP-spec JSON-RPC/WebSocket server. Mounts on an existing
 * `http.Server`/`http2.SecureServer` and surfaces fully-initialized
 * `AhpServerConnection`s to the application.
 *
 * @example Mount on an HTTP server and accept one client:
 * ```ts
 * import { createServer } from "node:http";
 * const server = createServer();
 * server.listen(7433, "127.0.0.1");
 *
 * const ahp = new AhpServerSocket({
 *   server,
 *   powerlineToken: process.env.GRACKLE_POWERLINE_TOKEN ?? "",
 *   onInitialize: (params) => ({
 *     protocolVersion: "0.1.0",
 *     serverSeq: 0,
 *     snapshots: [],
 *   }),
 *   onConnection: (conn) => {
 *     console.log("client connected:", conn.clientId);
 *     conn.session.notify("action", { channel: "ahp-session:/x", serverSeq: 1, action: {...} });
 *   },
 *   onRequest: async (req, conn) => {
 *     // typed dispatch on req.method
 *     return { jsonrpc: "2.0", id: req.id, result: null };
 *   },
 * });
 * ```
 */
export class AhpServerSocket {
  private readonly server: HttpServer | Http2SecureServer;
  private readonly powerlineToken: string;
  private readonly path: string;
  private readonly onInitialize: AhpServerSocketOptions["onInitialize"];
  private readonly onRequest: AhpServerSocketOptions["onRequest"];
  private readonly onNotification: AhpServerSocketOptions["onNotification"];
  private readonly onConnection: AhpServerSocketOptions["onConnection"];
  private readonly onDisconnect: AhpServerSocketOptions["onDisconnect"];
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatMissedLimit: number;

  private readonly wss: WebSocketServer;
  private readonly connections = new Set<ConnectionState>();
  private readonly upgradeListener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  private closed = false;

  public constructor(opts: AhpServerSocketOptions) {
    this.server = opts.server;
    this.powerlineToken = opts.powerlineToken;
    this.path = opts.path ?? DEFAULT_PATH;
    this.onInitialize = opts.onInitialize;
    this.onRequest = opts.onRequest;
    this.onNotification = opts.onNotification;
    this.onConnection = opts.onConnection;
    this.onDisconnect = opts.onDisconnect;
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.heartbeatMissedLimit = opts.heartbeatMissedLimit ?? DEFAULT_HEARTBEAT_MISSED_LIMIT;

    this.wss = new WebSocketServer({ noServer: true });
    this.upgradeListener = (req, socket, head) => this.handleUpgrade(req, socket, head);
    this.server.on("upgrade", this.upgradeListener);
  }

  /** Stops accepting new connections and closes all existing sessions. */
  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.server.off("upgrade", this.upgradeListener);
    for (const conn of this.connections) {
      conn.heartbeat.stop();
      conn.session.close(WsCloseCode.Normal, "server shutting down");
    }
    this.connections.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  // ─── Upgrade + auth ────────────────────────────────────────────────

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    // Only handle our path; let other listeners see other paths.
    const requestPath = (req.url ?? "/").split("?")[0];
    if (requestPath !== this.path) {
      return;
    }
    if (!this.authorizeUpgrade(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.attachSocket(ws, req));
  }

  private authorizeUpgrade(req: IncomingMessage): boolean {
    if (this.powerlineToken === "") {
      return true;
    }
    const header = (req.headers["authorization"] ?? "").toString();
    const bearerMatch = /^Bearer\s+(\S+)$/i.exec(header);
    if (bearerMatch === null) {
      // Reject anything that isn't an `Authorization: Bearer <token>` header
      // — including a raw token with no scheme prefix.
      return false;
    }
    const supplied = bearerMatch[1] ?? "";
    const a = Buffer.from(supplied);
    const b = Buffer.from(this.powerlineToken);
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }

  // ─── Per-connection lifecycle ──────────────────────────────────────

  private attachSocket(ws: WebSocket, req: IncomingMessage): void {
    const state: ConnectionState = {
      socket: ws,
      session: undefined as unknown as JsonRpcSession,
      connection: undefined,
      heartbeat: undefined as unknown as Heartbeat,
    };
    state.session = new JsonRpcSession({
      socket: ws,
      onRequest: (innerReq) => this.handleRequest(innerReq, state, req),
      onNotification: (notif) => this.handleNotification(notif, state),
      onClose: (code, reason) => this.handleSocketClose(state, code, reason),
    });
    state.heartbeat = new Heartbeat({
      target: {
        ping: () => ws.ping(),
        close: (code, reason) => state.session.close(code, reason),
        on: (event, listener) => {
          ws.on(event, listener);
        },
      },
      intervalMs: this.heartbeatIntervalMs,
      missedLimit: this.heartbeatMissedLimit,
    });
    this.connections.add(state);
    state.heartbeat.start();
  }

  private async handleRequest(
    req: AhpRequest,
    state: ConnectionState,
    httpReq: IncomingMessage,
  ): Promise<RequestHandlerResult> {
    if (req.method === "initialize") {
      if (state.connection !== undefined) {
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: {
            code: JsonRpcErrorCodes.InvalidRequest,
            message: "session already initialized",
          },
        };
      }
      try {
        const params = req.params as InitializeParams;
        const result = await this.onInitialize(params);
        const connection: AhpServerConnection = {
          clientId: params.clientId,
          initializeParams: params,
          session: state.session,
          remoteAddress: httpReq.socket.remoteAddress,
        };
        state.connection = connection;
        // Surface the connection AFTER the initialize response has been
        // flushed to the wire. `afterSend` runs in JsonRpcSession's
        // `ws.send(data, callback)` completion path — deterministic ordering,
        // no event-loop assumptions.
        return {
          response: { jsonrpc: "2.0", id: req.id, result },
          afterSend: () => this.onConnection?.(connection),
        };
      } catch (err) {
        // onInitialize failure: send the error response, then close the
        // session. The handshake boundary requires the peer can't retry
        // initialize on the same socket after a handshake-layer failure.
        return {
          response: {
            jsonrpc: "2.0",
            id: req.id,
            error: {
              code: JsonRpcErrorCodes.InternalError,
              message: (err as Error).message || "onInitialize threw",
            },
          },
          afterSend: () => state.session.close(WsCloseCode.Normal, "initialize failed"),
        };
      }
    }

    const connection = state.connection;
    if (connection === undefined) {
      // Enforce the handshake boundary: the first inbound JSON-RPC must be
      // `initialize`. Close the session after the error response is flushed.
      return {
        response: {
          jsonrpc: "2.0",
          id: req.id,
          error: {
            code: JsonRpcErrorCodes.InvalidRequest,
            message: "first request must be initialize",
          },
        },
        afterSend: () => state.session.close(WsCloseCode.Normal, "initialize required first"),
      };
    }

    if (this.onRequest === undefined) {
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: {
          code: JsonRpcErrorCodes.MethodNotFound,
          message: `no handler for ${req.method}`,
        },
      };
    }

    return this.onRequest(req, connection);
  }

  private handleNotification(notif: AhpNotification, state: ConnectionState): void {
    if (state.connection === undefined) {
      // Pre-initialize notification violates the handshake contract.
      // Notifications have no response to flush, so we can close
      // immediately — no ordering concern.
      state.session.close(WsCloseCode.Normal, "initialize required first");
      return;
    }
    if (this.onNotification === undefined) {
      return;
    }
    try {
      this.onNotification(notif, state.connection);
    } catch {
      // Handler errors are swallowed to keep the session alive.
    }
  }

  private handleSocketClose(state: ConnectionState, code: number, reason: string): void {
    state.heartbeat.stop();
    this.connections.delete(state);
    if (state.connection !== undefined) {
      this.onDisconnect?.(state.connection.clientId, code, reason);
    }
  }
}
