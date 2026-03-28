import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// ── Mock fs before importing ──────────────
const mockStreams = new Map<string, MockWriteStream>();

class MockWriteStream extends EventEmitter {
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  backpressured: boolean = false;

  constructor() {
    super();
    this.write = vi.fn((_data: string) => !this.backpressured);
    this.end = vi.fn();
  }
}

/** The most recently created mock write stream (simplifies lookup). */
let lastMockStream: MockWriteStream | undefined;

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  createWriteStream: vi.fn((_path: string) => {
    const mock = new MockWriteStream();
    lastMockStream = mock;
    mockStreams.set(_path, mock);
    return mock;
  }),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
  openSync: vi.fn(),
  readSync: vi.fn(),
  closeSync: vi.fn(),
}));

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initLog, writeEvent, endSession } from "./log-writer.js";
import { logger } from "./logger.js";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";

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
  mockStreams.clear();
  lastMockStream = undefined;
});

describe("log-writer", () => {
  describe("writeEvent", () => {
    it("writes a JSONL line to the stream", async () => {
      initLog("/tmp/test-log");
      const ws = lastMockStream!;

      await writeEvent("/tmp/test-log", makeEvent("s1", "hello"));

      expect(ws.write).toHaveBeenCalledTimes(1);
      const written = ws.write.mock.calls[0][0] as string;
      expect(written).toMatch(/\n$/);
      const parsed = JSON.parse(written.trim()) as { session_id: string; content: string; type: string };
      expect(parsed.session_id).toBe("s1");
      expect(parsed.content).toBe("hello");
      expect(parsed.type).toBe("text");
    });

    it("resolves immediately when write() returns true", async () => {
      initLog("/tmp/fast-log");
      const ws = lastMockStream!;
      ws.backpressured = false;

      const promise = writeEvent("/tmp/fast-log", makeEvent("s1", "fast"));
      // Should resolve without needing drain
      await promise;

      expect(ws.write).toHaveBeenCalledTimes(1);
      // No drain listener should have been registered
      expect(ws.listenerCount("drain")).toBe(0);
    });

    it("awaits drain when write() returns false", async () => {
      initLog("/tmp/slow-log");
      const ws = lastMockStream!;
      ws.backpressured = true;

      let resolved = false;
      const promise = writeEvent("/tmp/slow-log", makeEvent("s1", "slow")).then(() => {
        resolved = true;
      });

      // Give microtasks a chance to run
      await new Promise((r) => setTimeout(r, 10));
      expect(resolved).toBe(false);

      // Emit drain to release
      ws.emit("drain");
      await promise;
      expect(resolved).toBe(true);
    });

    it("is a no-op when stream is not initialized", async () => {
      // Don't call initLog — writeEvent should resolve immediately
      await writeEvent("/tmp/no-such-log", makeEvent("s1", "ghost"));
      // No error, no write
    });

    it("is a no-op after endSession closes the stream", async () => {
      initLog("/tmp/closed-log");
      const ws = lastMockStream!;
      endSession("/tmp/closed-log");

      await writeEvent("/tmp/closed-log", makeEvent("s1", "after-close"));
      // write should not have been called after close
      // (initLog called write 0 times, endSession removed the stream)
      expect(ws.write).not.toHaveBeenCalled();
    });

    it("logs a warning when drain is needed", async () => {
      initLog("/tmp/warn-log");
      const ws = lastMockStream!;
      ws.backpressured = true;

      const promise = writeEvent("/tmp/warn-log", makeEvent("s1", "pressure"));

      // Release drain
      await new Promise((r) => setTimeout(r, 10));
      ws.emit("drain");
      await promise;

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ logPath: "/tmp/warn-log" }),
        expect.stringContaining("backpressure"),
      );
    });
  });

  describe("endSession", () => {
    it("calls ws.end() and removes from cache", async () => {
      initLog("/tmp/end-log");
      const ws = lastMockStream!;

      endSession("/tmp/end-log");
      expect(ws.end).toHaveBeenCalledTimes(1);

      // Subsequent writeEvent should be no-op
      await writeEvent("/tmp/end-log", makeEvent("s1", "nope"));
      expect(ws.write).not.toHaveBeenCalled();
    });
  });
});
