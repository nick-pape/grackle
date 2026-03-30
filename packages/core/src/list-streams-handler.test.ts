import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as streamRegistry from "./stream-registry.js";
import * as pipeDelivery from "./pipe-delivery.js";
import { createStream, listStreams } from "./session-handlers.js";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";

vi.spyOn(pipeDelivery, "ensureAsyncDeliveryListener").mockImplementation(() => vi.fn());

describe("listStreams", () => {
  beforeEach(() => {
    streamRegistry._resetForTesting();
  });

  it("returns empty list when no streams exist", async () => {
    const res = await listStreams();

    expect(res.streams).toEqual([]);
  });

  it("returns stream with correct metadata", async () => {
    await createStream(
      create(grackle.CreateStreamRequestSchema, {
        sessionId: "session-1",
        name: "test-channel",
      }),
    );

    const res = await listStreams();

    expect(res.streams).toHaveLength(1);
    expect(res.streams[0].name).toBe("test-channel");
    expect(res.streams[0].id).toBeTruthy();
    expect(res.streams[0].subscriberCount).toBe(1);
    expect(res.streams[0].messageBufferDepth).toBe(0);
  });

  it("maps subscriber details correctly", async () => {
    await createStream(
      create(grackle.CreateStreamRequestSchema, {
        sessionId: "session-1",
        name: "sub-test",
      }),
    );

    const res = await listStreams();
    const sub = res.streams[0].subscribers[0];

    expect(sub.sessionId).toBe("session-1");
    expect(sub.fd).toBeGreaterThanOrEqual(3);
    expect(sub.permission).toBe("rw");
    expect(sub.deliveryMode).toBe("async");
    expect(sub.createdBySpawn).toBe(false);
  });

  it("reflects multiple subscribers across streams", async () => {
    const stream1 = await createStream(
      create(grackle.CreateStreamRequestSchema, {
        sessionId: "session-1",
        name: "channel-a",
      }),
    );

    // Attach a second subscriber
    streamRegistry.subscribe(stream1.streamId, "session-2", "r", "sync", false);

    await createStream(
      create(grackle.CreateStreamRequestSchema, {
        sessionId: "session-3",
        name: "channel-b",
      }),
    );

    const res = await listStreams();

    expect(res.streams).toHaveLength(2);

    const channelA = res.streams.find((s) => s.name === "channel-a")!;
    expect(channelA.subscriberCount).toBe(2);
    expect(channelA.subscribers).toHaveLength(2);

    const channelB = res.streams.find((s) => s.name === "channel-b")!;
    expect(channelB.subscriberCount).toBe(1);
  });

  it("reports message buffer depth after publishing", async () => {
    // Use registry directly to create a stream with messages
    const stream = streamRegistry.createStream("depth-test");
    streamRegistry.subscribe(stream.id, "session-1", "rw", "async", false);
    streamRegistry.publish(stream.id, "session-2", "message-1");
    streamRegistry.publish(stream.id, "session-2", "message-2");
    streamRegistry.publish(stream.id, "session-2", "message-3");

    const res = await listStreams();

    expect(res.streams[0].messageBufferDepth).toBe(3);
  });
});
