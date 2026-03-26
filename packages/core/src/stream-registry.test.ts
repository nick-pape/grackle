import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock logger to suppress output in tests
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as registry from "./stream-registry.js";
import type { Subscription, StreamMessage } from "./stream-registry.js";

describe("stream-registry", () => {
  beforeEach(() => {
    registry._resetForTesting();
  });

  // ─── Stream lifecycle ──────────────────────────────────────

  describe("createStream / getStream", () => {
    it("creates a stream with id and name", () => {
      const stream = registry.createStream("test-pipe");
      expect(stream.id).toBeTruthy();
      expect(stream.name).toBe("test-pipe");
      expect(stream.messages).toEqual([]);
      expect(stream.subscriptions.size).toBe(0);
    });

    it("getStream retrieves by id", () => {
      const stream = registry.createStream("my-stream");
      expect(registry.getStream(stream.id)).toBe(stream);
    });

    it("getStream returns undefined for unknown id", () => {
      expect(registry.getStream("nonexistent")).toBeUndefined();
    });

    it("enforces unique stream names", () => {
      registry.createStream("unique-name");
      expect(() => registry.createStream("unique-name"))
        .toThrow('Stream with name "unique-name" already exists');
    });

    it("getStreamByName retrieves by name", () => {
      const stream = registry.createStream("named");
      expect(registry.getStreamByName("named")).toBe(stream);
      expect(registry.getStreamByName("unknown")).toBeUndefined();
    });
  });

  describe("deleteStream", () => {
    it("removes stream and its subscriptions", () => {
      const stream = registry.createStream("doomed");
      registry.subscribe(stream.id, "session-1", "rw", "async", true);

      registry.deleteStream(stream.id);

      expect(registry.getStream(stream.id)).toBeUndefined();
      expect(registry.getStreamByName("doomed")).toBeUndefined();
      expect(registry.getSubscriptionsForSession("session-1")).toEqual([]);
    });

    it("no-op for unknown stream", () => {
      registry.deleteStream("nonexistent"); // should not throw
    });
  });

  // ─── Subscriptions ─────────────────────────────────────────

  describe("subscribe", () => {
    it("creates a subscription with fd starting at 3", () => {
      const stream = registry.createStream("pipe");
      const sub = registry.subscribe(stream.id, "sess-1", "rw", "async", true);

      expect(sub.fd).toBe(3);
      expect(sub.streamId).toBe(stream.id);
      expect(sub.sessionId).toBe("sess-1");
      expect(sub.permission).toBe("rw");
      expect(sub.deliveryMode).toBe("async");
      expect(sub.createdBySpawn).toBe(true);
    });

    it("assigns incrementing fds per session", () => {
      const stream = registry.createStream("pipe");
      const sub1 = registry.subscribe(stream.id, "sess-1", "rw", "async", true);
      const sub2 = registry.subscribe(stream.id, "sess-1", "r", "async", false);

      expect(sub1.fd).toBe(3);
      expect(sub2.fd).toBe(4);
    });

    it("different sessions have independent fd counters", () => {
      const stream = registry.createStream("pipe");
      const sub1 = registry.subscribe(stream.id, "sess-1", "rw", "async", true);
      const sub2 = registry.subscribe(stream.id, "sess-2", "rw", "async", true);

      expect(sub1.fd).toBe(3);
      expect(sub2.fd).toBe(3);
    });

    it("throws for unknown stream", () => {
      expect(() => registry.subscribe("bad-id", "sess-1", "rw", "async", true))
        .toThrow("Stream not found");
    });

    it("adds subscription to stream's subscription map", () => {
      const stream = registry.createStream("pipe");
      const sub = registry.subscribe(stream.id, "sess-1", "rw", "async", true);

      expect(stream.subscriptions.get(sub.id)).toBe(sub);
    });

    it("rejects w-only with sync delivery mode", () => {
      const stream = registry.createStream("pipe");
      expect(() => registry.subscribe(stream.id, "sess-1", "w", "sync", true))
        .toThrow('Write-only subscription cannot use "sync" delivery mode');
    });

    it("rejects w-only with async delivery mode", () => {
      const stream = registry.createStream("pipe");
      expect(() => registry.subscribe(stream.id, "sess-1", "w", "async", true))
        .toThrow('Write-only subscription cannot use "async" delivery mode');
    });

    it("allows w-only with detach delivery mode", () => {
      const stream = registry.createStream("pipe");
      const sub = registry.subscribe(stream.id, "sess-1", "w", "detach", true);
      expect(sub.permission).toBe("w");
      expect(sub.deliveryMode).toBe("detach");
    });
  });

  describe("unsubscribe", () => {
    it("removes subscription from stream and session", () => {
      const stream = registry.createStream("pipe");
      const sub = registry.subscribe(stream.id, "sess-1", "rw", "async", true);

      registry.unsubscribe(sub.id);

      expect(registry.getSubscription("sess-1", sub.fd)).toBeUndefined();
      expect(stream.subscriptions.has(sub.id)).toBe(false);
    });

    it("deletes stream when last subscription removed", () => {
      const stream = registry.createStream("pipe");
      const sub = registry.subscribe(stream.id, "sess-1", "rw", "async", true);

      registry.unsubscribe(sub.id);

      expect(registry.getStream(stream.id)).toBeUndefined();
      expect(registry.getStreamByName("pipe")).toBeUndefined();
    });

    it("keeps stream alive when other subscriptions remain", () => {
      const stream = registry.createStream("pipe");
      const sub1 = registry.subscribe(stream.id, "sess-1", "rw", "async", true);
      registry.subscribe(stream.id, "sess-2", "rw", "async", true);

      registry.unsubscribe(sub1.id);

      expect(registry.getStream(stream.id)).toBeDefined();
    });

    it("cleans up fdCounters when session has no more subs", () => {
      const stream = registry.createStream("pipe");
      const sub = registry.subscribe(stream.id, "sess-1", "rw", "async", true);

      registry.unsubscribe(sub.id);

      // Re-subscribing should start at fd 3 again
      const stream2 = registry.createStream("pipe2");
      const sub2 = registry.subscribe(stream2.id, "sess-1", "rw", "async", true);
      expect(sub2.fd).toBe(3);
    });

    it("no-op for unknown subscription", () => {
      registry.unsubscribe("nonexistent"); // should not throw
    });

    it("unblocks pending consumeSync on unsubscribe", async () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "parent", "rw", "async", true);
      const syncSub = registry.subscribe(stream.id, "child", "rw", "sync", false);

      // Start blocking consume
      const consumePromise = registry.consumeSync(syncSub.id);

      // Unsubscribe should unblock the consumer
      registry.unsubscribe(syncSub.id);

      await expect(consumePromise).rejects.toThrow("Subscription closed");
    });
  });

  describe("getSubscription / getSubscriptionsForSession", () => {
    it("looks up by session + fd", () => {
      const stream = registry.createStream("pipe");
      const sub = registry.subscribe(stream.id, "sess-1", "rw", "async", true);

      expect(registry.getSubscription("sess-1", 3)).toBe(sub);
      expect(registry.getSubscription("sess-1", 99)).toBeUndefined();
      expect(registry.getSubscription("other", 3)).toBeUndefined();
    });

    it("returns all subscriptions for a session", () => {
      const s1 = registry.createStream("pipe-1");
      const s2 = registry.createStream("pipe-2");
      registry.subscribe(s1.id, "sess-1", "rw", "async", true);
      registry.subscribe(s2.id, "sess-1", "r", "async", false);

      const subs = registry.getSubscriptionsForSession("sess-1");
      expect(subs).toHaveLength(2);
    });

    it("returns empty array for unknown session", () => {
      expect(registry.getSubscriptionsForSession("unknown")).toEqual([]);
    });
  });

  describe("getOwnedSubscriptions", () => {
    it("returns only createdBySpawn=true subscriptions", () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "sess-1", "rw", "async", true);
      registry.subscribe(stream.id, "sess-1", "r", "async", false);

      const owned = registry.getOwnedSubscriptions("sess-1");
      expect(owned).toHaveLength(1);
      expect(owned[0].createdBySpawn).toBe(true);
    });
  });

  // ─── Messaging ─────────────────────────────────────────────

  describe("publish", () => {
    it("adds message to stream buffer", () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "sess-1", "rw", "async", true);

      const msg = registry.publish(stream.id, "sess-1", "hello");

      expect(msg.content).toBe("hello");
      expect(msg.senderId).toBe("sess-1");
      expect(msg.timestamp).toBeTruthy();
    });

    it("throws for unknown stream", () => {
      expect(() => registry.publish("bad-id", "sess-1", "hello"))
        .toThrow("Stream not found");
    });

    it("invokes async listener for async subscribers (not sender)", () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "parent", "rw", "async", true);
      registry.subscribe(stream.id, "child", "rw", "async", false);

      const received: Array<{ sub: Subscription; msg: StreamMessage }> = [];
      registry.registerAsyncListener("child", (sub, msg) => {
        received.push({ sub, msg });
      });

      registry.publish(stream.id, "parent", "hello child");

      expect(received).toHaveLength(1);
      expect(received[0].msg.content).toBe("hello child");
      expect(received[0].sub.sessionId).toBe("child");
    });

    it("does not invoke async listener for the sender", () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "sess-1", "rw", "async", true);

      const received: StreamMessage[] = [];
      registry.registerAsyncListener("sess-1", (_sub, msg) => {
        received.push(msg);
      });

      registry.publish(stream.id, "sess-1", "self-message");

      expect(received).toHaveLength(0);
    });

    it("does not notify detach subscribers", () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "parent", "rw", "async", true);
      registry.subscribe(stream.id, "detached", "rw", "detach", false);

      const received: StreamMessage[] = [];
      registry.registerAsyncListener("detached", (_sub, msg) => {
        received.push(msg);
      });

      registry.publish(stream.id, "parent", "hello");

      expect(received).toHaveLength(0);
    });

    it("does not deliver to w-only subscriptions", () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "parent", "rw", "async", true);
      registry.subscribe(stream.id, "writer", "w", "detach", false);

      const msg = registry.publish(stream.id, "parent", "hello");

      // w-only sub should not appear in deliveredTo
      expect(msg.deliveredTo.size).toBe(0); // parent is sender (skipped), writer is w-only (skipped)
    });

    it("only marks async delivered when listener exists and succeeds", () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "parent", "rw", "async", true);
      registry.subscribe(stream.id, "child", "rw", "async", false);

      // No listener registered — message should stay undelivered
      const msg1 = registry.publish(stream.id, "parent", "no listener");
      expect(msg1.deliveredTo.size).toBe(0);

      // Register listener that throws
      registry.registerAsyncListener("child", () => {
        throw new Error("listener error");
      });
      const msg2 = registry.publish(stream.id, "parent", "throws");
      expect(msg2.deliveredTo.size).toBe(0);
    });
  });

  describe("consumeSync", () => {
    it("blocks then resolves when message is published", async () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "parent", "rw", "async", true);
      const syncSub = registry.subscribe(stream.id, "child", "rw", "sync", false);

      // Start consuming (will block)
      const consumePromise = registry.consumeSync(syncSub.id);

      // Publish after a tick
      await new Promise((r) => setTimeout(r, 5));
      registry.publish(stream.id, "parent", "sync message");

      const msg = await consumePromise;
      expect(msg.content).toBe("sync message");
      expect(msg.deliveredTo.has(syncSub.id)).toBe(true);
    });

    it("returns immediately if message already buffered", async () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "parent", "rw", "async", true);
      const syncSub = registry.subscribe(stream.id, "child", "rw", "sync", false);

      // Publish first
      registry.publish(stream.id, "parent", "already here");

      // Consume should return immediately
      const msg = await registry.consumeSync(syncSub.id);
      expect(msg.content).toBe("already here");
    });

    it("throws for nonexistent subscription", async () => {
      await expect(registry.consumeSync("nonexistent"))
        .rejects.toThrow("No sync queue");
    });

    it("throws for an existing async subscription", async () => {
      const stream = registry.createStream("pipe");
      const asyncSub = registry.subscribe(stream.id, "sess-1", "rw", "async", true);

      await expect(registry.consumeSync(asyncSub.id))
        .rejects.toThrow("No sync queue");
    });
  });

  describe("hasUndeliveredMessages", () => {
    it("returns true when messages are pending for detach subscriber", () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "parent", "rw", "detach", true);
      const sub2 = registry.subscribe(stream.id, "child", "rw", "detach", false);

      registry.publish(stream.id, "parent", "unread");

      // child has undelivered message
      expect(registry.hasUndeliveredMessages(sub2.id)).toBe(true);
    });

    it("returns false for sender's own messages", () => {
      const stream = registry.createStream("pipe");
      const sub1 = registry.subscribe(stream.id, "parent", "rw", "detach", true);
      registry.subscribe(stream.id, "child", "rw", "detach", false);

      registry.publish(stream.id, "parent", "my own msg");

      // parent sent the message, so it's excluded
      expect(registry.hasUndeliveredMessages(sub1.id)).toBe(false);
    });

    it("returns false after sync consume", async () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "parent", "rw", "async", true);
      const syncSub = registry.subscribe(stream.id, "child", "rw", "sync", false);

      registry.publish(stream.id, "parent", "will be consumed");

      // Before consume: undelivered
      expect(registry.hasUndeliveredMessages(syncSub.id)).toBe(true);

      // After consume: delivered
      await registry.consumeSync(syncSub.id);
      expect(registry.hasUndeliveredMessages(syncSub.id)).toBe(false);
    });

    it("returns false for unknown subscription", () => {
      expect(registry.hasUndeliveredMessages("nonexistent")).toBe(false);
    });
  });

  // ─── Async Listener ────────────────────────────────────────

  describe("registerAsyncListener", () => {
    it("returns an unsubscribe function", () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "parent", "rw", "async", true);
      registry.subscribe(stream.id, "child", "rw", "async", false);

      const received: StreamMessage[] = [];
      const unsub = registry.registerAsyncListener("child", (_sub, msg) => {
        received.push(msg);
      });

      registry.publish(stream.id, "parent", "before unsub");
      unsub();
      registry.publish(stream.id, "parent", "after unsub");

      expect(received).toHaveLength(1);
      expect(received[0].content).toBe("before unsub");
    });
  });

  // ─── Reset ─────────────────────────────────────────────────

  describe("_resetForTesting", () => {
    it("clears all state", () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "sess-1", "rw", "async", true);

      registry._resetForTesting();

      expect(registry.getStream(stream.id)).toBeUndefined();
      expect(registry.getStreamByName("pipe")).toBeUndefined();
      expect(registry.getSubscriptionsForSession("sess-1")).toEqual([]);
    });
  });

  // ─── listStreams ──────────────────────────────────────────

  describe("listStreams", () => {
    it("returns empty array when no streams", () => {
      expect(registry.listStreams()).toEqual([]);
    });

    it("returns all created streams", () => {
      registry.createStream("stream-a");
      registry.createStream("stream-b");
      registry.createStream("stream-c");

      const streams = registry.listStreams();
      expect(streams).toHaveLength(3);
      expect(streams.map((s) => s.name).sort()).toEqual(["stream-a", "stream-b", "stream-c"]);
    });

    it("excludes deleted streams", () => {
      const a = registry.createStream("stream-a");
      registry.createStream("stream-b");
      registry.deleteStream(a.id);

      const streams = registry.listStreams();
      expect(streams).toHaveLength(1);
      expect(streams[0].name).toBe("stream-b");
    });
  });

  // ─── onSessionRevived callback ────────────────────────────

  describe("onSessionRevived callback", () => {
    it("fires when external subscription added to lifecycle stream", () => {
      const callback = vi.fn();
      registry.onSessionRevived(callback);

      const stream = registry.createStream("lifecycle:target-sess");
      // Session's own subscription — should NOT fire
      registry.subscribe(stream.id, "target-sess", "rw", "detach", false);
      expect(callback).not.toHaveBeenCalled();

      // External subscription — SHOULD fire
      registry.subscribe(stream.id, "parent-sess", "rw", "detach", true);
      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith("target-sess", "parent-sess");
    });

    it("does NOT fire for the session's own subscription", () => {
      const callback = vi.fn();
      registry.onSessionRevived(callback);

      const stream = registry.createStream("lifecycle:my-sess");
      registry.subscribe(stream.id, "my-sess", "rw", "detach", false);

      expect(callback).not.toHaveBeenCalled();
    });

    it("does NOT fire for non-lifecycle streams", () => {
      const callback = vi.fn();
      registry.onSessionRevived(callback);

      const stream = registry.createStream("custom-pipe");
      registry.subscribe(stream.id, "some-sess", "rw", "detach", true);

      expect(callback).not.toHaveBeenCalled();
    });

    it("does NOT fire when callback is not registered", () => {
      // No callback registered — should not throw
      const stream = registry.createStream("lifecycle:target-sess");
      expect(() => {
        registry.subscribe(stream.id, "parent-sess", "rw", "detach", true);
      }).not.toThrow();
    });

    it("passes target sessionId and subscriber sessionId", () => {
      const callback = vi.fn();
      registry.onSessionRevived(callback);

      const stream = registry.createStream("lifecycle:child-123");
      registry.subscribe(stream.id, "parent-456", "rw", "detach", true);

      expect(callback).toHaveBeenCalledWith("child-123", "parent-456");
    });
  });
});
