import { JsonRpcErrorCodes } from "@grackle-ai/ahp";
import type { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TransportError, WsCloseCode } from "./error-codes.js";
import { JsonRpcSession } from "./json-rpc-session.js";
import { FakeWebSocket } from "./mocks/fake-websocket.js";

function makeOpenSocket(): FakeWebSocket {
  const ws = new FakeWebSocket();
  ws.open();
  return ws;
}

function sentJson(ws: FakeWebSocket, index = -1): Record<string, unknown> {
  const frame = ws.sent.at(index);
  if (typeof frame !== "string") {
    throw new Error(`expected text frame, got ${typeof frame}`);
  }
  return JSON.parse(frame);
}

describe("JsonRpcSession", () => {
  describe("outbound requests", () => {
    it("writes a JSON-RPC envelope with monotonic id and resolves on matching success", async () => {
      const ws = makeOpenSocket();
      const session = new JsonRpcSession({ socket: ws as unknown as WebSocket });

      const promise = session.request("ping", { _meta: undefined });
      const frame = sentJson(ws);
      expect(frame).toMatchObject({ jsonrpc: "2.0", id: 1, method: "ping" });

      ws.receive(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }));
      await expect(promise).resolves.toBeNull();
    });

    it("rejects on matching error response", async () => {
      const ws = makeOpenSocket();
      const session = new JsonRpcSession({ socket: ws as unknown as WebSocket });
      const promise = session.request("ping", { _meta: undefined });
      ws.receive(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: JsonRpcErrorCodes.InternalError, message: "bad" },
        }),
      );
      await expect(promise).rejects.toMatchObject({
        code: JsonRpcErrorCodes.InternalError,
        message: "bad",
      });
    });

    it("handles two concurrent requests with out-of-order responses", async () => {
      const ws = makeOpenSocket();
      const session = new JsonRpcSession({ socket: ws as unknown as WebSocket });
      const p1 = session.request("ping", { _meta: undefined });
      const p2 = session.request("ping", { _meta: undefined });
      // Respond to id=2 first.
      ws.receive(JSON.stringify({ jsonrpc: "2.0", id: 2, result: "second" }));
      ws.receive(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "first" }));
      await expect(p1).resolves.toBe("first");
      await expect(p2).resolves.toBe("second");
    });

    it("ignores a response whose id has no pending entry", async () => {
      const ws = makeOpenSocket();
      const session = new JsonRpcSession({ socket: ws as unknown as WebSocket });
      // No pending requests; this should be silently dropped (not throw).
      expect(() =>
        ws.receive(JSON.stringify({ jsonrpc: "2.0", id: 99, result: null })),
      ).not.toThrow();
      expect(session.isOpen).toBe(true);
    });
  });

  describe("inbound notifications and requests", () => {
    it("dispatches notifications to onNotification", () => {
      const ws = makeOpenSocket();
      const seen: unknown[] = [];
      const session = new JsonRpcSession({
        socket: ws as unknown as WebSocket,
        onNotification: (n) => {
          seen.push(n);
        },
      });
      ws.receive(JSON.stringify({ jsonrpc: "2.0", method: "action", params: { channel: "x" } }));
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ method: "action", params: { channel: "x" } });
      expect(session.isOpen).toBe(true);
    });

    it("drops notifications silently when onNotification is undefined", () => {
      const ws = makeOpenSocket();
      new JsonRpcSession({ socket: ws as unknown as WebSocket });
      expect(() =>
        ws.receive(JSON.stringify({ jsonrpc: "2.0", method: "action", params: {} })),
      ).not.toThrow();
    });

    it("calls onRequest for inbound requests and writes the response back", async () => {
      const ws = makeOpenSocket();
      new JsonRpcSession({
        socket: ws as unknown as WebSocket,
        onRequest: async (req) => ({ jsonrpc: "2.0", id: req.id, result: { ok: true } }),
      });
      ws.receive(
        JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping", params: { _meta: undefined } }),
      );
      // Wait for the response to be written (handler is async).
      await new Promise((r) => setImmediate(r));
      expect(sentJson(ws)).toMatchObject({ jsonrpc: "2.0", id: 7, result: { ok: true } });
    });

    it("returns MethodNotFound when onRequest is not provided", async () => {
      const ws = makeOpenSocket();
      new JsonRpcSession({ socket: ws as unknown as WebSocket });
      ws.receive(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping", params: {} }));
      await new Promise((r) => setImmediate(r));
      expect(sentJson(ws)).toMatchObject({
        jsonrpc: "2.0",
        id: 7,
        error: { code: JsonRpcErrorCodes.MethodNotFound },
      });
    });

    it("returns InternalError when onRequest throws", async () => {
      const ws = makeOpenSocket();
      new JsonRpcSession({
        socket: ws as unknown as WebSocket,
        onRequest: async () => {
          throw new Error("boom");
        },
      });
      ws.receive(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping", params: {} }));
      await new Promise((r) => setImmediate(r));
      expect(sentJson(ws)).toMatchObject({
        jsonrpc: "2.0",
        id: 9,
        error: { code: JsonRpcErrorCodes.InternalError, message: "boom" },
      });
    });

    it("swallows errors thrown by the notification handler so the session stays alive", () => {
      const ws = makeOpenSocket();
      const session = new JsonRpcSession({
        socket: ws as unknown as WebSocket,
        onNotification: () => {
          throw new Error("user bug");
        },
      });
      expect(() =>
        ws.receive(JSON.stringify({ jsonrpc: "2.0", method: "action", params: {} })),
      ).not.toThrow();
      expect(session.isOpen).toBe(true);
    });
  });

  describe("notify (outbound)", () => {
    it("sends a JSON-RPC notification frame (no id)", () => {
      const ws = makeOpenSocket();
      const session = new JsonRpcSession({ socket: ws as unknown as WebSocket });
      session.notify("unsubscribe", { channel: "ahp-session:/x" });
      expect(sentJson(ws)).toEqual({
        jsonrpc: "2.0",
        method: "unsubscribe",
        params: { channel: "ahp-session:/x" },
      });
    });

    it("silently drops notify() after close", async () => {
      const ws = makeOpenSocket();
      const session = new JsonRpcSession({ socket: ws as unknown as WebSocket });
      session.close();
      await new Promise((r) => setImmediate(r));
      expect(() => session.notify("unsubscribe", {})).not.toThrow();
    });
  });

  describe("close & rejection", () => {
    it("rejects pending requests on close", async () => {
      const ws = makeOpenSocket();
      const session = new JsonRpcSession({ socket: ws as unknown as WebSocket });
      const p1 = session.request("ping", { _meta: undefined });
      const p2 = session.request("ping", { _meta: undefined });
      session.close(1000, "bye");
      await Promise.all([
        expect(p1).rejects.toBeInstanceOf(TransportError),
        expect(p2).rejects.toBeInstanceOf(TransportError),
      ]);
    });

    it("fires onClose with the close code and reason", async () => {
      const ws = makeOpenSocket();
      const closes: Array<{ code: number; reason: string }> = [];
      new JsonRpcSession({
        socket: ws as unknown as WebSocket,
        onClose: (code, reason) => closes.push({ code, reason }),
      });
      ws.remoteClose(1001, "going away");
      expect(closes).toEqual([{ code: 1001, reason: "going away" }]);
    });

    it("reports isOpen=false after close", async () => {
      const ws = makeOpenSocket();
      const session = new JsonRpcSession({ socket: ws as unknown as WebSocket });
      expect(session.isOpen).toBe(true);
      ws.remoteClose(1000);
      expect(session.isOpen).toBe(false);
    });

    it("rejects request() called after close immediately with ConnectionLost", async () => {
      const ws = makeOpenSocket();
      const session = new JsonRpcSession({ socket: ws as unknown as WebSocket });
      ws.remoteClose(1000);
      await expect(session.request("ping", { _meta: undefined })).rejects.toMatchObject({
        kind: "connection-lost",
      });
    });

    it("close() is idempotent", async () => {
      const ws = makeOpenSocket();
      const session = new JsonRpcSession({ socket: ws as unknown as WebSocket });
      session.close();
      await new Promise((r) => setImmediate(r));
      expect(() => session.close()).not.toThrow();
    });
  });

  describe("malformed input", () => {
    it("writes ParseError for malformed JSON", () => {
      const ws = makeOpenSocket();
      new JsonRpcSession({ socket: ws as unknown as WebSocket });
      ws.receive("not json {{{");
      expect(sentJson(ws)).toMatchObject({
        error: { code: JsonRpcErrorCodes.ParseError },
      });
    });

    it("drops non-JSON-RPC envelopes silently", () => {
      const ws = makeOpenSocket();
      const session = new JsonRpcSession({ socket: ws as unknown as WebSocket });
      ws.receive(JSON.stringify({ hello: "world" }));
      expect(ws.sent).toEqual([]);
      expect(session.isOpen).toBe(true);
    });

    it("writes InvalidRequest for envelope with id but no result/error/method", () => {
      const ws = makeOpenSocket();
      new JsonRpcSession({ socket: ws as unknown as WebSocket });
      ws.receive(JSON.stringify({ jsonrpc: "2.0", id: 5 }));
      expect(sentJson(ws)).toMatchObject({
        jsonrpc: "2.0",
        id: 5,
        error: { code: JsonRpcErrorCodes.InvalidRequest },
      });
    });

    it("closes with code 1003 on binary frames", () => {
      const ws = makeOpenSocket();
      new JsonRpcSession({ socket: ws as unknown as WebSocket });
      ws.receiveBinary(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
      expect(ws.closedBy).toEqual({
        code: WsCloseCode.UnsupportedData,
        reason: expect.any(String),
      });
    });
  });

  describe("request timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("rejects with TransportError(kind=request-timeout) after the configured ms", async () => {
      const ws = makeOpenSocket();
      const session = new JsonRpcSession({
        socket: ws as unknown as WebSocket,
        requestTimeoutMs: 5_000,
      });
      const promise = session.request("ping", { _meta: undefined });
      promise.catch(() => undefined); // prevent unhandled rejection
      vi.advanceTimersByTime(5_001);
      await expect(promise).rejects.toMatchObject({ kind: "request-timeout" });
    });

    it("ignores a response that arrives after the timeout", async () => {
      const ws = makeOpenSocket();
      const session = new JsonRpcSession({
        socket: ws as unknown as WebSocket,
        requestTimeoutMs: 5_000,
      });
      const promise = session.request("ping", { _meta: undefined });
      promise.catch(() => undefined);
      vi.advanceTimersByTime(5_001);
      await expect(promise).rejects.toMatchObject({ kind: "request-timeout" });
      // Late response: no double-resolve, no throw.
      expect(() =>
        ws.receive(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "late" })),
      ).not.toThrow();
    });

    it("clears the timeout when the response arrives in time", async () => {
      const ws = makeOpenSocket();
      const session = new JsonRpcSession({
        socket: ws as unknown as WebSocket,
        requestTimeoutMs: 5_000,
      });
      const promise = session.request("ping", { _meta: undefined });
      ws.receive(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" }));
      await expect(promise).resolves.toBe("ok");
      // Advance past the timeout — nothing happens, no double-anything.
      vi.advanceTimersByTime(10_000);
    });
  });
});
