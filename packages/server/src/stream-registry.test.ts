import { describe, it, expect, beforeEach, vi } from "vitest";
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
  });

  describe("deleteStream", () => {
    it("removes stream and its subscriptions", () => {
      const stream = registry.createStream("doomed");
      registry.subscribe(stream.id, "session-1", "rw", "async", true);

      registry.deleteStream(stream.id);

      expect(registry.getStream(stream.id)).toBeUndefined();
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
    });

    it("keeps stream alive when other subscriptions remain", () => {
      const stream = registry.createStream("pipe");
      const sub1 = registry.subscribe(stream.id, "sess-1", "rw", "async", true);
      registry.subscribe(stream.id, "sess-2", "rw", "async", true);

      registry.unsubscribe(sub1.id);

      expect(registry.getStream(stream.id)).toBeDefined();
    });

    it("no-op for unknown subscription", () => {
      registry.unsubscribe("nonexistent"); // should not throw
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
      expect(stream.messages).toHaveLength(1);
      expect(stream.messages[0]).toBe(msg);
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

    it("throws for non-sync subscription", async () => {
      await expect(registry.consumeSync("nonexistent"))
        .rejects.toThrow("No sync queue");
    });
  });

  describe("hasUndeliveredMessages", () => {
    it("returns true when messages are pending", () => {
      const stream = registry.createStream("pipe");
      const sub1 = registry.subscribe(stream.id, "parent", "rw", "detach", true);
      const sub2 = registry.subscribe(stream.id, "child", "rw", "detach", false);

      registry.publish(stream.id, "parent", "unread");

      // child has undelivered message
      expect(registry.hasUndeliveredMessages(sub2.id)).toBe(true);
      // parent sent the message, so it's excluded
      expect(registry.hasUndeliveredMessages(sub1.id)).toBe(false);
    });

    it("returns false when all messages delivered", () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "parent", "rw", "async", true);
      const syncSub = registry.subscribe(stream.id, "child", "rw", "sync", false);

      registry.publish(stream.id, "parent", "will be consumed");

      // sync publish enqueues + we consume
      // The publish already enqueued it, but deliveredTo is set on consumeSync
      // For sync subs, the message is pushed to the queue on publish but deliveredTo
      // is only set on consumeSync. So hasUndeliveredMessages checks deliveredTo.
      expect(registry.hasUndeliveredMessages(syncSub.id)).toBe(true);
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
      expect(registry.getSubscriptionsForSession("sess-1")).toEqual([]);
    });
  });
});
