/**
 * JSON-RPC 2.0 framing engine over a single WebSocket. Owns:
 *   - outbound request/response correlation by numeric id
 *   - inbound dispatch to `onRequest` / `onNotification`
 *   - per-request timeouts
 *   - close-rejects-all-pending-with-ConnectionLost
 *
 * Channels (AHP routing) are deliberately NOT understood here — that's
 * `MultiHostClient`'s job. This class only does framing.
 */

import type { AhpNotification, AhpRequest, AhpResponse, CommandMap } from "@grackle-ai/ahp";
import { JsonRpcErrorCodes } from "@grackle-ai/ahp";
import type { RawData, WebSocket } from "ws";

import { TransportError, WsCloseCode } from "./error-codes.js";

/**
 * Result returned by a {@link RequestHandler}. Either a bare `AhpResponse`
 * (from `@grackle-ai/ahp`, the common case), or a wrapped result that
 * includes an `afterSend` callback fired AFTER the response frame has been
 * flushed to the wire. The wrapped form is the deterministic ordering
 * primitive: use it whenever a side effect (e.g., close the session, emit
 * a notification) must follow the response on the wire rather than precede it.
 */
export type RequestHandlerResult =
  | AhpResponse
  | { readonly response: AhpResponse; readonly afterSend: () => void };

/** Handler for inbound peer-initiated requests. */
export type RequestHandler = (req: AhpRequest) => Promise<RequestHandlerResult>;

/** Handler for inbound peer-initiated notifications. */
export type NotificationHandler = (notif: AhpNotification) => void;

/** Construction options for {@link JsonRpcSession}. */
export interface JsonRpcSessionOptions {
  /** An already-OPEN WebSocket. The session takes ownership of close/error events. */
  readonly socket: WebSocket;
  /** Called when the peer sends a JSON-RPC request. Omit to reject all inbound requests. */
  readonly onRequest?: RequestHandler;
  /** Called when the peer sends a JSON-RPC notification. Omit to drop silently. */
  readonly onNotification?: NotificationHandler;
  /** Called once when the socket closes; pending requests have already been rejected. */
  readonly onClose?: (code: number, reason: string) => void;
  /** If set, pending requests time out after this many milliseconds. */
  readonly requestTimeoutMs?: number;
}

interface PendingRequest {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (err: unknown) => void;
  timeoutHandle: NodeJS.Timeout | undefined;
}

/**
 * Bidirectional JSON-RPC session over one WebSocket.
 *
 * @example Wrap an already-OPEN ws connection and exchange a typed request:
 * ```ts
 * import { WebSocket } from "ws";
 * const socket = new WebSocket(url);
 * await new Promise((r) => socket.once("open", r));
 *
 * const session = new JsonRpcSession({
 *   socket,
 *   onNotification: (n) => console.log("inbound:", n.method),
 * });
 * const result = await session.request("ping", { channel: "ahp-root://" });
 * ```
 *
 * @example Send a response that closes the session after the frame flushes:
 * ```ts
 * const session = new JsonRpcSession({
 *   socket,
 *   onRequest: async (req) => ({
 *     response: { jsonrpc: "2.0", id: req.id, error: { code: -32600, message: "bad" } },
 *     afterSend: () => session.close(1000, "bye"),
 *   }),
 * });
 * ```
 */
export class JsonRpcSession {
  private readonly socket: WebSocket;
  private readonly onRequest: RequestHandler | undefined;
  private readonly onNotification: NotificationHandler | undefined;
  private readonly onClose: ((code: number, reason: string) => void) | undefined;
  private readonly requestTimeoutMs: number | undefined;

  private nextRequestId = 1;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private closed = false;

  public constructor(opts: JsonRpcSessionOptions) {
    this.socket = opts.socket;
    this.onRequest = opts.onRequest;
    this.onNotification = opts.onNotification;
    this.onClose = opts.onClose;
    this.requestTimeoutMs = opts.requestTimeoutMs;

    this.socket.on("message", this.handleMessage);
    this.socket.on("close", this.handleClose);
    this.socket.on("error", this.handleError);
  }

  /** Sends a request and resolves with the result (or rejects with the error). */
  public request<M extends keyof CommandMap>(
    method: M,
    params: CommandMap[M]["params"],
  ): Promise<CommandMap[M]["result"]> {
    if (this.closed) {
      return Promise.reject(
        new TransportError("connection-lost", `request ${String(method)} after close`),
      );
    }
    const id = this.nextRequestId++;
    return new Promise<CommandMap[M]["result"]>((resolve, reject) => {
      const entry: PendingRequest = {
        method: String(method),
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutHandle: undefined,
      };
      if (this.requestTimeoutMs !== undefined) {
        entry.timeoutHandle = setTimeout(() => {
          if (this.pendingRequests.delete(id)) {
            reject(
              new TransportError(
                "request-timeout",
                `request ${entry.method} timed out after ${this.requestTimeoutMs}ms`,
              ),
            );
          }
        }, this.requestTimeoutMs);
      }
      this.pendingRequests.set(id, entry);
      // If sending fails (e.g., socket closed mid-call), reject immediately.
      try {
        this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      } catch (err) {
        this.pendingRequests.delete(id);
        if (entry.timeoutHandle !== undefined) {
          clearTimeout(entry.timeoutHandle);
        }
        reject(
          new TransportError(
            "connection-lost",
            `request ${entry.method} failed to send: ${(err as Error).message}`,
          ),
        );
      }
    });
  }

  /** Sends a notification (fire-and-forget). Silently drops if already closed. */
  public notify(method: string, params: unknown): void {
    if (this.closed) {
      return;
    }
    try {
      this.socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
    } catch {
      // Socket closed between the check and send; drop silently.
    }
  }

  /** Closes the underlying socket. Idempotent. */
  public close(code?: number, reason?: string): void {
    if (this.closed) {
      return;
    }
    this.socket.close(code, reason);
  }

  /** True between construction and the socket's "close" event firing. */
  public get isOpen(): boolean {
    return !this.closed;
  }

  // ─── Inbound message dispatch ──────────────────────────────────────

  private readonly handleMessage = (data: RawData, isBinary: boolean): void => {
    if (isBinary) {
      this.socket.close(WsCloseCode.UnsupportedData, "binary frames not supported");
      return;
    }
    const text =
      typeof data === "string"
        ? data
        : Buffer.isBuffer(data)
          ? data.toString("utf8")
          : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)]).toString("utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Malformed JSON: if it looked like a request with an id, we can't
      // recover the id, so just drop. JSON-RPC spec says respond with
      // ParseError + id=null, but a null id is rarely actionable.
      this.tryWriteParseError();
      return;
    }
    if (!isObject(parsed) || parsed["jsonrpc"] !== "2.0") {
      // Not a JSON-RPC envelope; drop.
      return;
    }
    const idValue = parsed["id"];
    const hasId = typeof idValue === "number";
    if (hasId) {
      if ("result" in parsed) {
        this.resolvePending(idValue, parsed["result"]);
        return;
      }
      if ("error" in parsed) {
        this.rejectPending(idValue, parsed["error"]);
        return;
      }
      if (typeof parsed["method"] === "string") {
        void this.handleInboundRequest(parsed as unknown as AhpRequest);
        return;
      }
      // Has an id but neither result/error/method: invalid.
      this.writeError(idValue, JsonRpcErrorCodes.InvalidRequest, "malformed envelope");
      return;
    }
    if (typeof parsed["method"] === "string") {
      this.handleInboundNotification(parsed as unknown as AhpNotification);
      return;
    }
    // No id and no method: drop silently.
  };

  private resolvePending(id: number, result: unknown): void {
    const entry = this.pendingRequests.get(id);
    if (entry === undefined) {
      return;
    }
    this.pendingRequests.delete(id);
    if (entry.timeoutHandle !== undefined) {
      clearTimeout(entry.timeoutHandle);
    }
    entry.resolve(result);
  }

  private rejectPending(id: number, error: unknown): void {
    const entry = this.pendingRequests.get(id);
    if (entry === undefined) {
      return;
    }
    this.pendingRequests.delete(id);
    if (entry.timeoutHandle !== undefined) {
      clearTimeout(entry.timeoutHandle);
    }
    entry.reject(error);
  }

  private async handleInboundRequest(req: AhpRequest): Promise<void> {
    if (this.onRequest === undefined) {
      this.writeError(req.id, JsonRpcErrorCodes.MethodNotFound, `no handler for ${req.method}`);
      return;
    }
    try {
      const result = await this.onRequest(req);
      const isWrapped = isObject(result) && "response" in result && "afterSend" in result;
      if (isWrapped) {
        const { response, afterSend } = result as {
          response: AhpResponse;
          afterSend: () => void;
        };
        this.sendAndThen(response, afterSend);
      } else {
        this.socket.send(JSON.stringify(result));
      }
    } catch (err) {
      this.writeError(
        req.id,
        JsonRpcErrorCodes.InternalError,
        (err as Error).message || "handler threw",
      );
    }
  }

  /**
   * Sends `frame` and invokes `after` once the data has been flushed to the
   * OS socket buffer. Use this when a side effect (e.g., closing the session)
   * MUST follow the frame on the wire.
   *
   * `after` runs even if `socket.send` errors — the typical close-after-error
   * caller wants the close to proceed regardless.
   */
  public sendAndThen(frame: unknown, after: () => void): void {
    if (this.closed) {
      // Fire `after` immediately if the socket is already gone; otherwise the
      // callback would leak.
      after();
      return;
    }
    try {
      this.socket.send(JSON.stringify(frame), (err) => {
        // The callback fires once the data is flushed to the kernel buffer
        // (or immediately with an error if the socket is no longer writable).
        // We always run `after` regardless.
        void err;
        after();
      });
    } catch {
      // Synchronous send failure (socket already closed mid-call). Run after.
      after();
    }
  }

  private handleInboundNotification(notif: AhpNotification): void {
    if (this.onNotification === undefined) {
      return;
    }
    try {
      this.onNotification(notif);
    } catch {
      // Notification handler errors are swallowed to keep the session alive.
    }
  }

  private writeError(id: number, code: number, message: string): void {
    try {
      this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
    } catch {
      // Socket likely closing; ignore.
    }
  }

  private tryWriteParseError(): void {
    try {
      this.socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: JsonRpcErrorCodes.ParseError, message: "parse error" },
        }),
      );
    } catch {
      // Ignore.
    }
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────

  private readonly handleClose = (code: number, reason: Buffer): void => {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const reasonStr = reason.toString("utf8");
    for (const [, entry] of this.pendingRequests) {
      if (entry.timeoutHandle !== undefined) {
        clearTimeout(entry.timeoutHandle);
      }
      entry.reject(
        new TransportError(
          "connection-lost",
          `connection lost while ${entry.method} pending (code=${code})`,
        ),
      );
    }
    this.pendingRequests.clear();
    this.onClose?.(code, reasonStr);
  };

  private readonly handleError = (_err: Error): void => {
    // ws emits "error" before "close" on transport failures. The "close"
    // handler does the work; this listener exists so the EventEmitter doesn't
    // crash the process on unhandled "error" events.
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
