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

    it("returns false for write-only subscription even when messages exist", () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "sender", "rw", "async", true);
      const writeSub = registry.subscribe(stream.id, "writer", "w", "detach", false);

      registry.publish(stream.id, "sender", "some message");

      // write-only can never consume — should always be false
      expect(registry.hasUndeliveredMessages(writeSub.id)).toBe(false);
    });
  });

  // ─── Self-echo ─────────────────────────────────────────────

  describe("selfEcho", () => {
    it("createStream stores selfEcho=true", () => {
      const stream = registry.createStream("chat", true);
      expect(stream.selfEcho).toBe(true);
    });

    it("createStream defaults selfEcho to false", () => {
      const stream = registry.createStream("pipe");
      expect(stream.selfEcho).toBe(false);
    });

    it("publish with selfEcho=false skips sender (default behavior)", () => {
      const stream = registry.createStream("pipe", false);
      const senderSub = registry.subscribe(stream.id, "sender", "rw", "async", true);

      const received: StreamMessage[] = [];
      registry.registerAsyncListener("sender", (_sub, msg) => {
        received.push(msg);
      });

      registry.publish(stream.id, "sender", "hello");

      expect(received).toHaveLength(0);
      expect(registry.hasUndeliveredMessages(senderSub.id)).toBe(false);
    });

    it("publish with selfEcho=true does NOT call async listener for sender (#1184)", () => {
      const stream = registry.createStream("chat", true);
      const senderSub = registry.subscribe(stream.id, "sender", "rw", "async", true);
      // Add a detach subscriber so the message is not immediately pruned after sender delivery
      registry.subscribe(stream.id, "observer", "rw", "detach", false);

      const received: StreamMessage[] = [];
      registry.registerAsyncListener("sender", (_sub, msg) => {
        received.push(msg);
      });

      registry.publish(stream.id, "sender", "echo me");

      // Async listener must NOT fire for the sender — would trigger a full agent turn
      expect(received).toHaveLength(0);
      // Message is still in stream history (observer detach sub keeps it alive)
      expect(stream.messages).toHaveLength(1);
      expect(stream.messages[0].content).toBe("echo me");
      // Marked delivered so pruning works correctly (no memory leak)
      expect(stream.messages[0].deliveredTo.has(senderSub.id)).toBe(true);
    });

    it("publish with selfEcho=true still delivers to sender via sync after #1184 fix", async () => {
      // Regression guard: the async-listener suppression must not affect sync delivery
      const stream = registry.createStream("chat", true);
      const senderSub = registry.subscribe(stream.id, "sender", "rw", "sync", true);

      const consumePromise = registry.consumeSync(senderSub.id);
      registry.publish(stream.id, "sender", "sync echo");

      const msg = await consumePromise;
      expect(msg.content).toBe("sync echo");
      expect(msg.deliveredTo.has(senderSub.id)).toBe(true);
    });

    it("hasUndeliveredMessages returns true for sender when selfEcho=true", () => {
      const stream = registry.createStream("chat", true);
      const senderSub = registry.subscribe(stream.id, "sender", "rw", "detach", true);

      registry.publish(stream.id, "sender", "my message");

      expect(registry.hasUndeliveredMessages(senderSub.id)).toBe(true);
    });

    it("hasUndeliveredMessages returns false for sender when selfEcho=false", () => {
      const stream = registry.createStream("pipe", false);
      const senderSub = registry.subscribe(stream.id, "sender", "rw", "detach", true);

      registry.publish(stream.id, "sender", "my message");

      expect(registry.hasUndeliveredMessages(senderSub.id)).toBe(false);
    });

    it("pruneDeliveredMessages does not prune sender message when selfEcho=true and sender unread", () => {
      const stream = registry.createStream("chat", true);
      registry.subscribe(stream.id, "sender", "rw", "detach", true);
      registry.subscribe(stream.id, "other", "rw", "detach", false);

      // Sender publishes; mark "other" as delivered — sender still hasn't read it
      const msg = registry.publish(stream.id, "sender", "hello");
      const otherSub = Array.from(stream.subscriptions.values()).find((s) => s.sessionId === "other")!;
      msg.deliveredTo.add(otherSub.id);

      // Trigger a second publish, which calls pruneDeliveredMessages again
      registry.publish(stream.id, "sender", "second message");

      // Original message must still be present — sender's echo is unread
      expect(stream.messages).toHaveLength(2);
    });

    it("selfEcho delivers to receiver but NOT sender via async listener (#1184)", () => {
      const stream = registry.createStream("chat", true);
      const senderSub = registry.subscribe(stream.id, "alice", "rw", "async", true);
      const receiverSub = registry.subscribe(stream.id, "bob", "rw", "async", false);

      const aliceReceived: StreamMessage[] = [];
      const bobReceived: StreamMessage[] = [];
      registry.registerAsyncListener("alice", (_sub, msg) => { aliceReceived.push(msg); });
      registry.registerAsyncListener("bob", (_sub, msg) => { bobReceived.push(msg); });

      registry.publish(stream.id, "alice", "hi everyone");

      // Bob receives via async listener; alice does NOT (would trigger agent turn)
      expect(aliceReceived).toHaveLength(0);
      expect(bobReceived).toHaveLength(1);
      // Both subs are marked delivered (alice via immediate mark, bob via listener)
      expect(bobReceived[0].deliveredTo.has(senderSub.id)).toBe(true);
      expect(bobReceived[0].deliveredTo.has(receiverSub.id)).toBe(true);
    });

    it("selfEcho=true async sender: hasUndeliveredMessages returns false (#1184)", () => {
      const stream = registry.createStream("chat", true);
      const senderSub = registry.subscribe(stream.id, "sender", "rw", "async", true);
      registry.registerAsyncListener("sender", vi.fn());

      registry.publish(stream.id, "sender", "my message");

      // Message should be marked delivered immediately — no stale undelivered state
      expect(registry.hasUndeliveredMessages(senderSub.id)).toBe(false);
    });

    it("selfEcho=true async sender: pruneDeliveredMessages cleans up correctly (#1184)", () => {
      const stream = registry.createStream("chat", true);
      registry.subscribe(stream.id, "sender", "rw", "async", true);
      registry.subscribe(stream.id, "other", "rw", "async", false);
      registry.registerAsyncListener("sender", vi.fn());
      registry.registerAsyncListener("other", vi.fn());

      // Publish two messages — both fully delivered (sender via immediate mark, other via async listener)
      registry.publish(stream.id, "sender", "first");
      registry.publish(stream.id, "sender", "second");

      // All messages pruned — proves no unbounded accumulation (memory leak fix)
      expect(stream.messages).toHaveLength(0);
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

  // ─── Async delivery (Promise-returning listeners) ──────────

  describe("awaitPendingDeliveries", () => {
    it("defers marking delivered when listener returns a resolving Promise", async () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "parent", "rw", "async", true);
      const childSub = registry.subscribe(stream.id, "child", "rw", "async", false);

      registry.registerAsyncListener("child", async (_sub, _msg) => {
        // async listener — returns a Promise
      });

      const msg = registry.publish(stream.id, "parent", "hello");

      // Not yet delivered synchronously
      expect(msg.deliveredTo.has(childSub.id)).toBe(false);

      await registry.awaitPendingDeliveries(msg);

      // Now marked delivered
      expect(msg.deliveredTo.has(childSub.id)).toBe(true);
    });

    it("leaves message undelivered when listener returns a rejecting Promise", async () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "parent", "rw", "async", true);
      const childSub = registry.subscribe(stream.id, "child", "rw", "async", false);

      registry.registerAsyncListener("child", async (_sub, _msg) => {
        throw new Error("gRPC send failed");
      });

      const msg = registry.publish(stream.id, "parent", "hello");
      await registry.awaitPendingDeliveries(msg);

      expect(msg.deliveredTo.has(childSub.id)).toBe(false);
    });

    it("marks delivered immediately for sync (void) listeners — backward compatible", () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "parent", "rw", "async", true);
      const childSub = registry.subscribe(stream.id, "child", "rw", "async", false);

      registry.registerAsyncListener("child", (_sub, _msg) => {
        // sync listener — returns undefined
      });

      const msg = registry.publish(stream.id, "parent", "hello");

      // Sync listener: delivered immediately without awaiting
      expect(msg.deliveredTo.has(childSub.id)).toBe(true);
    });

    it("handles partial delivery: one resolves, one rejects", async () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "sender", "rw", "async", true);
      const sub1 = registry.subscribe(stream.id, "receiver1", "rw", "async", false);
      const sub2 = registry.subscribe(stream.id, "receiver2", "rw", "async", false);

      registry.registerAsyncListener("receiver1", async () => {
        // resolves
      });
      registry.registerAsyncListener("receiver2", async () => {
        throw new Error("delivery failed");
      });

      const msg = registry.publish(stream.id, "sender", "hello");
      await registry.awaitPendingDeliveries(msg);

      expect(msg.deliveredTo.has(sub1.id)).toBe(true);
      expect(msg.deliveredTo.has(sub2.id)).toBe(false);
    });

    it("is a no-op when no pending deliveries exist (sync listener)", async () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "parent", "rw", "async", true);
      registry.subscribe(stream.id, "child", "rw", "async", false);

      registry.registerAsyncListener("child", () => {
        // sync
      });

      const msg = registry.publish(stream.id, "parent", "hello");
      // Should resolve immediately with no effect
      await expect(registry.awaitPendingDeliveries(msg)).resolves.toBeUndefined();
    });

    it("hasUndeliveredMessages returns true while delivery is pending", async () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "parent", "rw", "async", true);
      const childSub = registry.subscribe(stream.id, "child", "rw", "async", false);

      let resolveDelivery!: () => void;
      const deliveryPromise = new Promise<void>((resolve) => {
        resolveDelivery = resolve;
      });

      registry.registerAsyncListener("child", () => deliveryPromise);

      const msg = registry.publish(stream.id, "parent", "hello");

      // Still in-flight: undelivered
      expect(registry.hasUndeliveredMessages(childSub.id)).toBe(true);

      // Resolve and await
      resolveDelivery();
      await registry.awaitPendingDeliveries(msg);

      expect(registry.hasUndeliveredMessages(childSub.id)).toBe(false);
    });

    it("defers pruning until pending deliveries resolve", async () => {
      const stream = registry.createStream("pipe");
      registry.subscribe(stream.id, "parent", "rw", "async", true);
      registry.subscribe(stream.id, "child", "rw", "async", false);

      let resolveDelivery!: () => void;
      const deliveryPromise = new Promise<void>((resolve) => {
        resolveDelivery = resolve;
      });

      registry.registerAsyncListener("child", () => deliveryPromise);

      const msg = registry.publish(stream.id, "parent", "hello");

      // Message should still be in the buffer (not pruned yet)
      expect(stream.messages).toContain(msg);

      // Resolve and await — now it can be pruned
      resolveDelivery();
      await registry.awaitPendingDeliveries(msg);
      // Flush any remaining microtasks so the auto-finalize Promise.allSettled callback
      // (which calls pruneDeliveredMessages) has a chance to run before we assert.
      await Promise.resolve();

      // After delivery, the message is eligible for pruning
      expect(stream.messages).not.toContain(msg);
    });
  });

  // ─── replayUndeliveredMessages ─────────────────────────────

  describe("replayUndeliveredMessages", () => {
    it("invokes async listener for buffered undelivered messages", async () => {
      const stream = registry.createStream("pipe:child");
      const parentSub = registry.subscribe(stream.id, "parent", "rw", "async", true);
      registry.subscribe(stream.id, "child", "rw", "async", false);

      // Publish without a listener registered → message stays undelivered
      registry.publish(stream.id, "child", "offline message");
      expect(registry.hasUndeliveredMessages(parentSub.id)).toBe(true);

      // Register listener and replay
      const deliveredTexts: string[] = [];
      registry.registerAsyncListener("parent", (_sub, msg) => {
        deliveredTexts.push(msg.content);
      });
      registry.replayUndeliveredMessages(parentSub.id);

      expect(deliveredTexts).toEqual(["offline message"]);
    });

    it("skips messages already delivered to the subscription", () => {
      const stream = registry.createStream("pipe:child");
      const parentSub = registry.subscribe(stream.id, "parent", "rw", "async", true);
      registry.subscribe(stream.id, "child", "rw", "async", false);

      const delivered: string[] = [];
      registry.registerAsyncListener("parent", (_sub, msg) => {
        delivered.push(msg.content);
      });

      // Publish and deliver (listener is registered, so it fires immediately)
      registry.publish(stream.id, "child", "already delivered");
      expect(registry.hasUndeliveredMessages(parentSub.id)).toBe(false);

      // Replay should not re-deliver
      registry.replayUndeliveredMessages(parentSub.id);
      expect(delivered).toHaveLength(1); // only the original delivery, not a second from replay
    });

    it("no-ops for write-only subscriptions", () => {
      const stream = registry.createStream("pipe:child");
      // Write-only subscriptions can only use "detach" delivery mode
      const writeSub = registry.subscribe(stream.id, "server", "w", "detach", false);
      registry.subscribe(stream.id, "child", "rw", "async", false);

      const delivered: string[] = [];
      registry.registerAsyncListener("server", (_sub, msg) => {
        delivered.push(msg.content);
      });

      registry.publish(stream.id, "child", "some message");
      registry.replayUndeliveredMessages(writeSub.id);

      // Write-only subscription cannot receive — replay is a no-op
      expect(delivered).toHaveLength(0);
    });

    it("no-ops when no async listener is registered for the session", () => {
      const stream = registry.createStream("pipe:child");
      const parentSub = registry.subscribe(stream.id, "parent", "rw", "async", true);
      registry.subscribe(stream.id, "child", "rw", "async", false);

      registry.publish(stream.id, "child", "buffered");
      expect(registry.hasUndeliveredMessages(parentSub.id)).toBe(true);

      // No listener registered — replay is a no-op, message stays undelivered
      registry.replayUndeliveredMessages(parentSub.id);
      expect(registry.hasUndeliveredMessages(parentSub.id)).toBe(true);
    });

    it("marks messages delivered after async listener promise resolves", async () => {
      const stream = registry.createStream("pipe:child");
      const parentSub = registry.subscribe(stream.id, "parent", "rw", "async", true);
      registry.subscribe(stream.id, "child", "rw", "async", false);

      registry.publish(stream.id, "child", "async payload");
      expect(registry.hasUndeliveredMessages(parentSub.id)).toBe(true);

      let resolveDelivery!: () => void;
      const deliveryPromise = new Promise<void>((resolve) => {
        resolveDelivery = resolve;
      });
      registry.registerAsyncListener("parent", () => deliveryPromise);
      registry.replayUndeliveredMessages(parentSub.id);

      // Still undelivered until the promise resolves
      expect(registry.hasUndeliveredMessages(parentSub.id)).toBe(true);

      resolveDelivery();
      await Promise.resolve(); // flush microtasks
      await Promise.resolve();

      expect(registry.hasUndeliveredMessages(parentSub.id)).toBe(false);
    });

    it("does not dispatch a second sendInput when called again before the first delivery resolves", () => {
      const stream = registry.createStream("pipe:child");
      const parentSub = registry.subscribe(stream.id, "parent", "rw", "async", true);
      registry.subscribe(stream.id, "child", "rw", "async", false);

      registry.publish(stream.id, "child", "buffered message");

      let listenerCallCount = 0;
      // Listener returns a never-resolving Promise to keep the delivery in-flight
      registry.registerAsyncListener("parent", () => {
        listenerCallCount++;
        return new Promise<void>(() => {});
      });

      // First replay — listener fires once
      registry.replayUndeliveredMessages(parentSub.id);
      expect(listenerCallCount).toBe(1);

      // Second replay while first is still in-flight — must NOT fire listener again
      registry.replayUndeliveredMessages(parentSub.id);
      expect(listenerCallCount).toBe(1);
    });
  });
});
