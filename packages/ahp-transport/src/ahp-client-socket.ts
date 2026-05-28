/**
 * Client-side AHP transport. Connects to an {@link AhpServerSocket} over a
 * WebSocket, performs the AHP `initialize` handshake, persists the client
 * identifier via a {@link ClientIdStore}, and reconnects with exponential
 * backoff on transport failures.
 *
 * Channel-scoped concerns (per-`(host, channel)` `serverSeq` tracking,
 * subscription replay, generation counter) live in `MultiHostClient`
 * (HR8b). This class only owns the per-host connection lifecycle.
 */

import type { CommandMap, InitializeParams, InitializeResult } from "@grackle-ai/ahp";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";

import { exponentialBackoff, type BackoffPolicy } from "./backoff.js";
import type { ClientIdStore } from "./client-id-store.js";
import { TransportError, WsCloseCode } from "./error-codes.js";
import {
  JsonRpcSession,
  type NotificationHandler,
  type RequestHandler,
} from "./json-rpc-session.js";

/** Protocol versions the client offers in `InitializeParams.protocolVersions`. */
const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = ["0.1.0"];

/** Connection-lifecycle state for an {@link AhpClientSocket}. */
export type AhpConnectionState = "connecting" | "open" | "reconnecting" | "closed";

/** Construction options for {@link AhpClientSocket}. */
export interface AhpClientSocketOptions {
  /** Full WebSocket URL, e.g. `ws://host:7433/ahp`. */
  readonly url: string;
  /** Bearer token sent on the HTTP upgrade. Empty string disables auth. */
  readonly powerlineToken: string;
  /** Persistent store for the AHP clientId across reconnects/restarts. */
  readonly clientIdStore: ClientIdStore;
  /** Namespacing key for the clientId in the store (e.g., the host identifier). */
  readonly clientIdKey: string;
  /** Called when the host sends a JSON-RPC notification. */
  readonly onNotification?: NotificationHandler;
  /** Called when the host sends a JSON-RPC request (e.g., resourceRequest). */
  readonly onRequest?: RequestHandler;
  /** Called on every connection-state transition. */
  readonly onStateChange?: (state: AhpConnectionState) => void;
  /** Override the reconnect backoff policy (testing). */
  readonly backoff?: BackoffPolicy;
  /** Override the WebSocket constructor (testing). */
  readonly webSocketCtor?: typeof WebSocket;
  /** Locale forwarded to the host in InitializeParams.locale. */
  readonly locale?: string;
}

interface PendingOperation {
  run(session: JsonRpcSession): void;
  reject(err: unknown): void;
}

/** Bidirectional AHP transport over a single WebSocket with reconnect. */
export class AhpClientSocket {
  private readonly url: string;
  private readonly powerlineToken: string;
  private readonly clientIdStore: ClientIdStore;
  private readonly clientIdKey: string;
  private readonly onNotification: NotificationHandler | undefined;
  private readonly onRequest: RequestHandler | undefined;
  private readonly onStateChange: ((state: AhpConnectionState) => void) | undefined;
  private readonly backoff: BackoffPolicy;
  private readonly WebSocketCtor: typeof WebSocket;
  private readonly locale: string | undefined;

  private currentState: AhpConnectionState = "closed";
  private currentClientId: string | undefined;
  private session: JsonRpcSession | undefined;
  private socket: WebSocket | undefined;
  private userClosed = false;
  private openInProgress = false;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private readonly pendingOps: PendingOperation[] = [];

  public constructor(opts: AhpClientSocketOptions) {
    this.url = opts.url;
    this.powerlineToken = opts.powerlineToken;
    this.clientIdStore = opts.clientIdStore;
    this.clientIdKey = opts.clientIdKey;
    this.onNotification = opts.onNotification;
    this.onRequest = opts.onRequest;
    this.onStateChange = opts.onStateChange;
    this.backoff = opts.backoff ?? exponentialBackoff();
    this.WebSocketCtor = opts.webSocketCtor ?? WebSocket;
    this.locale = opts.locale;
  }

  /** Current lifecycle state. */
  public get state(): AhpConnectionState {
    return this.currentState;
  }

  /** Current AHP clientId, available once `open()` has resolved at least once. */
  public get clientId(): string | undefined {
    return this.currentClientId;
  }

  /** Opens the connection and resolves after the initialize handshake. */
  public async open(): Promise<InitializeResult> {
    if (this.userClosed) {
      throw new TransportError("user-closed", "open() called after close()");
    }
    if (this.openInProgress || this.currentState !== "closed") {
      // "connecting", "open", "reconnecting", or a concurrent open() in
      // flight before the first await reached `connectOnce()`.
      throw new TransportError("connection-lost", `open() called in state '${this.currentState}'`);
    }
    // Synchronously claim the lifecycle so a concurrent open() call (which
    // also runs to its first await without yielding) sees the flag and bails.
    this.openInProgress = true;
    try {
      this.currentClientId = this.currentClientId ?? (await this.loadOrMintClientId());
      return await this.connectOnce(/* isReconnect */ false);
    } finally {
      this.openInProgress = false;
    }
  }

  /** Sends a request; queues during reconnect, rejects after `.close()`. */
  public request<M extends keyof CommandMap>(
    method: M,
    params: CommandMap[M]["params"],
  ): Promise<CommandMap[M]["result"]> {
    if (this.currentState === "closed" || this.userClosed) {
      return Promise.reject(
        new TransportError("user-closed", `request ${String(method)} after close`),
      );
    }
    if (this.currentState === "open" && this.session !== undefined) {
      return this.session.request(method, params);
    }
    return new Promise((resolve, reject) => {
      this.pendingOps.push({
        run: (s) => {
          s.request(method, params).then(resolve as (v: unknown) => void, reject);
        },
        reject,
      });
    });
  }

  /** Fires a notification; silently drops if not currently open. */
  public notify(method: string, params: unknown): void {
    if (this.currentState === "open" && this.session !== undefined) {
      this.session.notify(method, params);
    }
  }

  /** Closes the connection permanently. Idempotent. */
  public async close(): Promise<void> {
    if (this.userClosed) {
      return;
    }
    this.userClosed = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const wasInTerminal = this.currentState === "closed";
    if (this.session !== undefined) {
      this.session.close(WsCloseCode.Normal, "client closed");
    } else if (this.socket !== undefined) {
      try {
        this.socket.close(WsCloseCode.Normal, "client closed");
      } catch {
        // ignore
      }
    }
    this.failPendingOps(new TransportError("user-closed", "close() called"));
    if (!wasInTerminal) {
      this.setState("closed");
    }
  }

  // ─── Internals ─────────────────────────────────────────────────────

  private async loadOrMintClientId(): Promise<string> {
    const stored = await this.clientIdStore.load(this.clientIdKey);
    if (stored !== undefined) {
      return stored;
    }
    const minted = randomUUID();
    await this.clientIdStore.save(this.clientIdKey, minted);
    return minted;
  }

  private connectOnce(isReconnect: boolean): Promise<InitializeResult> {
    this.setState(isReconnect ? "reconnecting" : "connecting");
    return new Promise<InitializeResult>((resolveOuter, rejectOuter) => {
      // Distinguishes "expected" closes (handshake failed, terminal teardown
      // during connectOnce) from real transport drops that should trigger
      // reconnect. Set BEFORE calling session.close() in the failure paths.
      let suppressReconnect = false;

      const failTransport = (err: unknown): void => {
        // Transport-layer failure (TCP error, WS upgrade rejected, etc.).
        // On reconnect attempts, chain the next retry; on initial open,
        // terminate.
        rejectOuter(err);
        if (isReconnect && !this.userClosed) {
          this.scheduleReconnect();
        } else {
          this.socket = undefined;
          this.session = undefined;
          this.failPendingOps(err);
          this.setState("closed");
        }
      };

      const failHandshake = (err: unknown): void => {
        // Handshake-layer failure (initialize rejected). Always terminal —
        // a stale clientId or unsupported protocol won't fix itself on retry.
        rejectOuter(err);
        this.socket = undefined;
        this.session = undefined;
        this.failPendingOps(err);
        this.setState("closed");
      };

      let ws: WebSocket;
      try {
        ws = new this.WebSocketCtor(this.url, {
          headers: this.headersForUpgrade(),
        });
      } catch (err) {
        failTransport(err);
        return;
      }
      this.socket = ws;

      const onError = (err: Error): void => {
        // ws emits "error" before "close" on transport failures. If the
        // session is already constructed (we're past initialize), let
        // handleSessionClose drive recovery; otherwise this is a transport
        // failure during the upgrade.
        if (this.session !== undefined) {
          return;
        }
        failTransport(err);
      };

      ws.once("open", () => {
        ws.off("error", onError);
        const session = new JsonRpcSession({
          socket: ws,
          onRequest: this.onRequest,
          onNotification: this.onNotification,
          onClose: (code, reason) => {
            if (suppressReconnect) {
              // Expected close after a handshake failure — failHandshake
              // already cleaned up the session/socket and set state.
              void code;
              void reason;
              return;
            }
            this.handleSessionClose(code, reason);
          },
        });
        this.session = session;
        // Send initialize.
        const params: InitializeParams = {
          channel: "ahp-root://",
          protocolVersions: SUPPORTED_PROTOCOL_VERSIONS as string[],
          clientId: this.currentClientId as string,
          ...(this.locale !== undefined ? { locale: this.locale } : {}),
        };
        session.request("initialize", params).then(
          (result) => {
            this.setState("open");
            this.backoff.reset();
            this.flushPendingOps();
            resolveOuter(result);
          },
          (err) => {
            // Handshake failure is terminal on both initial and reconnect
            // attempts. Suppress the session-close handler so it doesn't
            // schedule a reconnect, then run the handshake-failure cleanup.
            suppressReconnect = true;
            session.close(WsCloseCode.Normal, "initialize failed");
            failHandshake(err);
          },
        );
      });

      ws.once("error", onError);
    });
  }

  private headersForUpgrade(): Record<string, string> {
    if (this.powerlineToken === "") {
      return {};
    }
    return { Authorization: `Bearer ${this.powerlineToken}` };
  }

  private handleSessionClose(code: number, _reason: string): void {
    this.session = undefined;
    this.socket = undefined;
    if (this.userClosed) {
      this.setState("closed");
      return;
    }
    if (code === WsCloseCode.AuthRejected) {
      this.failPendingOps(new TransportError("auth-failed", `host closed with code ${code}`));
      this.setState("closed");
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.userClosed) {
      return;
    }
    this.setState("reconnecting");
    const delay = this.backoff.next();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.userClosed) {
        return;
      }
      // Fire-and-forget; on success/failure we update state internally.
      this.connectOnce(/* isReconnect */ true).catch(() => {
        // connectOnce schedules its own reconnect on failure.
      });
    }, delay);
  }

  private flushPendingOps(): void {
    if (this.session === undefined) {
      return;
    }
    const ops = this.pendingOps.splice(0, this.pendingOps.length);
    for (const op of ops) {
      op.run(this.session);
    }
  }

  private failPendingOps(err: unknown): void {
    const ops = this.pendingOps.splice(0, this.pendingOps.length);
    for (const op of ops) {
      op.reject(err);
    }
  }

  private setState(next: AhpConnectionState): void {
    if (next === this.currentState) {
      return;
    }
    this.currentState = next;
    this.onStateChange?.(next);
  }
}

// AhpRequest / AhpResponse are not re-exported from this package — consumers
// import them directly from `@grackle-ai/ahp`.
