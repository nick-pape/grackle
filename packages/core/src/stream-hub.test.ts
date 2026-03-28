import { describe, it, expect, vi, beforeEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { publish, createStream, createGlobalStream, MAX_SUBSCRIBER_QUEUE_DEPTH, _resetForTesting } from "./stream-hub.js";
import { logger } from "./logger.js";

function makeEvent(sessionId: string, content: string): grackle.SessionEvent {
  return create(grackle.SessionEventSchema, {
    sessionId,
    type: grackle.EventType.TEXT,
    timestamp: "2026-01-01T00:00:00.000Z",
    content,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTesting();
});

describe("stream-hub", () => {
  describe("publish + createStream", () => {
    it("delivers event to session-specific subscriber", async () => {
      const stream = createStream("s1");
      const event = makeEvent("s1", "hello");
      publish(event);

      const iter = stream[Symbol.asyncIterator]();
      const result = await iter.next();
      expect(result.done).toBe(false);
      expect(result.value.content).toBe("hello");

      stream.cancel();
    });

    it("does not deliver to unrelated session subscriber", async () => {
      const stream = createStream("s1");
      publish(makeEvent("s2", "wrong session"));

      // Publish an event for s1 so we can consume without hanging
      publish(makeEvent("s1", "right session"));

      const iter = stream[Symbol.asyncIterator]();
      const result = await iter.next();
      // Should receive only the s1 event, not the s2 event
      expect(result.value.content).toBe("right session");

      stream.cancel();
    });

    it("delivers event to global subscriber via createGlobalStream", async () => {
      const stream = createGlobalStream();
      publish(makeEvent("any-session", "global event"));

      const iter = stream[Symbol.asyncIterator]();
      const result = await iter.next();
      expect(result.done).toBe(false);
      expect(result.value.content).toBe("global event");

      stream.cancel();
    });

    it("delivers to both session and global subscribers", async () => {
      const sessionStream = createStream("s1");
      const globalStream = createGlobalStream();

      publish(makeEvent("s1", "dual delivery"));

      const sessionIter = sessionStream[Symbol.asyncIterator]();
      const globalIter = globalStream[Symbol.asyncIterator]();

      const sessionResult = await sessionIter.next();
      const globalResult = await globalIter.next();

      expect(sessionResult.value.content).toBe("dual delivery");
      expect(globalResult.value.content).toBe("dual delivery");

      sessionStream.cancel();
      globalStream.cancel();
    });
  });

  describe("bounded queue", () => {
    it("drops oldest events when queue exceeds MAX_SUBSCRIBER_QUEUE_DEPTH", async () => {
      const stream = createStream("s1");
      const totalEvents = MAX_SUBSCRIBER_QUEUE_DEPTH + 5;

      // Publish without consuming — fills the queue
      for (let i = 0; i < totalEvents; i++) {
        publish(makeEvent("s1", `event-${i}`));
      }

      // Consume all available events
      const collected: string[] = [];
      const iter = stream[Symbol.asyncIterator]();
      for (let i = 0; i < MAX_SUBSCRIBER_QUEUE_DEPTH; i++) {
        const result = await iter.next();
        collected.push(result.value.content);
      }

      // Should have dropped the first 5
      expect(collected).toHaveLength(MAX_SUBSCRIBER_QUEUE_DEPTH);
      expect(collected[0]).toBe("event-5");
      expect(collected[collected.length - 1]).toBe(`event-${totalEvents - 1}`);

      stream.cancel();
    });

    it("preserves newest events after overflow", async () => {
      const stream = createStream("s1");

      for (let i = 0; i < MAX_SUBSCRIBER_QUEUE_DEPTH + 100; i++) {
        publish(makeEvent("s1", `evt-${i}`));
      }

      // Read the last event
      const iter = stream[Symbol.asyncIterator]();
      let last: string = "";
      for (let i = 0; i < MAX_SUBSCRIBER_QUEUE_DEPTH; i++) {
        const result = await iter.next();
        last = result.value.content;
      }

      expect(last).toBe(`evt-${MAX_SUBSCRIBER_QUEUE_DEPTH + 99}`);
      stream.cancel();
    });

    it("logs warning on first overflow", () => {
      const stream = createStream("s1");

      for (let i = 0; i < MAX_SUBSCRIBER_QUEUE_DEPTH + 1; i++) {
        publish(makeEvent("s1", `evt-${i}`));
      }

      expect(logger.warn).toHaveBeenCalled();
      const call = vi.mocked(logger.warn).mock.calls[0];
      expect(call[1]).toMatch(/overflow/i);

      stream.cancel();
    });

    it("throttles subsequent overflow warnings", () => {
      const stream = createStream("s1");

      // Publish well beyond the limit
      for (let i = 0; i < MAX_SUBSCRIBER_QUEUE_DEPTH + 2500; i++) {
        publish(makeEvent("s1", `evt-${i}`));
      }

      // Should have warned a few times, not 2500 times
      const warnCount = vi.mocked(logger.warn).mock.calls.length;
      expect(warnCount).toBeGreaterThan(0);
      expect(warnCount).toBeLessThan(10);

      stream.cancel();
    });
  });

  describe("cancel", () => {
    it("removes subscriber — no more events delivered after cancel", async () => {
      const stream = createStream("s1");
      publish(makeEvent("s1", "before"));
      stream.cancel();
      publish(makeEvent("s1", "after"));

      // Iterator should return done after cancel
      const iter = stream[Symbol.asyncIterator]();
      // First call returns the queued "before" event
      const first = await iter.next();
      expect(first.value.content).toBe("before");
      // Second call should be done (no "after" event)
      const second = await iter.next();
      expect(second.done).toBe(true);
    });

    it("multiple subscribers are independent — cancel one doesn't affect other", async () => {
      const stream1 = createStream("s1");
      const stream2 = createStream("s1");

      stream1.cancel();
      publish(makeEvent("s1", "only-for-stream2"));

      const iter2 = stream2[Symbol.asyncIterator]();
      const result = await iter2.next();
      expect(result.value.content).toBe("only-for-stream2");

      stream2.cancel();
    });
  });
});
