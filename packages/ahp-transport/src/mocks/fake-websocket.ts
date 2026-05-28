/**
 * EventEmitter-shaped WebSocket double for unit tests. Implements just the
 * subset of `ws.WebSocket` that `JsonRpcSession` and `AhpClientSocket`
 * actually call, plus test-only helpers (`open`, `receive`, `receivePong`,
 * `remoteClose`) for driving inbound events.
 *
 * Tests pass instances to consumers via `as unknown as WebSocket` casts.
 * Excluded from coverage by the rig's `src/**\/mocks/**` glob.
 */

import { EventEmitter } from "node:events";

/** Mirrors `ws.WebSocket` `readyState` constants. */
export const FakeReadyState = {
  Connecting: 0,
  Open: 1,
  Closing: 2,
  Closed: 3,
} as const;

export type FakeReadyState = (typeof FakeReadyState)[keyof typeof FakeReadyState];

/** Test-only WebSocket double. */
export class FakeWebSocket extends EventEmitter {
  public readyState: FakeReadyState = FakeReadyState.Connecting;
  /** Frames the SUT sent. UTF-8 strings appear as strings; binary frames as Buffer. */
  public readonly sent: Array<string | Buffer> = [];
  /** Counts of `ping()` calls made by the SUT. */
  public pingCount = 0;
  /** Captured close calls from the SUT. */
  public closedBy: { code?: number; reason?: string } | undefined;

  // ─── ws.WebSocket surface used by JsonRpcSession ───────────────────

  public send(data: string | Buffer): void {
    if (this.readyState !== FakeReadyState.Open) {
      throw new Error(`FakeWebSocket: send() called in readyState=${this.readyState}`);
    }
    this.sent.push(data);
  }

  public close(code?: number, reason?: string): void {
    if (this.readyState === FakeReadyState.Closed) {
      return;
    }
    this.closedBy = { code, reason };
    this.readyState = FakeReadyState.Closing;
    // Synthesize the close event asynchronously, matching ws behavior.
    queueMicrotask(() => {
      this.readyState = FakeReadyState.Closed;
      this.emit("close", code ?? 1000, Buffer.from(reason ?? ""));
    });
  }

  public ping(): void {
    this.pingCount += 1;
  }

  // ─── Test-only inbound drivers ─────────────────────────────────────

  /** Transitions to OPEN and fires the "open" event. */
  public open(): void {
    this.readyState = FakeReadyState.Open;
    this.emit("open");
  }

  /** Fires a "message" event with a text frame. */
  public receive(text: string): void {
    this.emit("message", Buffer.from(text, "utf8"), false);
  }

  /** Fires a "message" event with a binary frame. */
  public receiveBinary(data: Buffer): void {
    this.emit("message", data, true);
  }

  /** Fires a "pong" event. */
  public receivePong(): void {
    this.emit("pong", Buffer.alloc(0));
  }

  /** Simulates a remote close: fires "close" without going through close(). */
  public remoteClose(code: number, reason = ""): void {
    this.readyState = FakeReadyState.Closed;
    this.emit("close", code, Buffer.from(reason));
  }

  /** Simulates a transport error. */
  public emitError(err: Error): void {
    this.emit("error", err);
  }
}
