import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@grackle-ai/database", () => ({ persistStreamMessage: vi.fn() }));

import { persistStreamMessage } from "@grackle-ai/database";
import * as registry from "./stream-registry.js";
import * as bus from "./stream-message-bus.js";
import type { StreamMessageEvent } from "./stream-message-bus.js";

const persistMock = vi.mocked(persistStreamMessage);

describe("publish() observation log (RFC #1264 Phase 2)", () => {
  let emitted: StreamMessageEvent[];

  beforeEach(() => {
    registry._resetForTesting();
    bus._resetForTesting();
    persistMock.mockReset();
    emitted = [];
    bus.subscribeStreamMessages((e) => { emitted.push(e); });
  });

  it("persists and emits for an observable (non-reserved) stream", () => {
    const stream = registry.createStream("planning-room");
    const msg = registry.publish(stream.id, "sess-1", "hello");

    expect(persistMock).toHaveBeenCalledTimes(1);
    const record = persistMock.mock.calls[0]![0];
    expect(record.streamId).toBe(stream.id);
    expect(record.senderId).toBe("sess-1");
    expect(record.content).toBe("hello");
    expect(typeof record.seq).toBe("string");

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ streamId: stream.id, content: "hello", seq: record.seq });
    expect(msg.content).toBe("hello"); // delivery is unaffected
  });

  it("skips reserved/internal streams (pipe:/stdin:/lifecycle:)", () => {
    const stream = registry.createStream("pipe:a-b");
    registry.publish(stream.id, "sess-1", "internal plumbing");

    expect(persistMock).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(0);
  });

  it("is non-fatal: a persistence failure does not break delivery", () => {
    persistMock.mockImplementation(() => { throw new Error("db down"); });
    const stream = registry.createStream("resilient-room");

    const msg = registry.publish(stream.id, "sess-1", "still delivered");

    expect(msg.content).toBe("still delivered");
    expect(emitted).toHaveLength(0); // emit is skipped because persist threw first
  });
});
