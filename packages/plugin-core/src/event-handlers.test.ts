import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";

vi.mock("@grackle-ai/database", () => ({
  queryDomainEvents: vi.fn(() => []),
  queryStreamMessages: vi.fn(() => []),
}));

import { queryDomainEvents as storeQuery, queryStreamMessages as streamStoreQuery } from "@grackle-ai/database";
import { queryDomainEvents as handler, getStreamTranscript as transcriptHandler } from "./event-handlers.js";

const storeMock = vi.mocked(storeQuery);
const streamStoreMock = vi.mocked(streamStoreQuery);

describe("queryDomainEvents handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMock.mockReturnValue([]);
  });

  it("maps non-empty request filters to the store query", async () => {
    await handler(create(grackle.QueryDomainEventsRequestSchema, {
      beforeId: "01Z",
      type: "task.created",
      since: "2026-05-23T00:00:00.000Z",
      limit: 50,
    }));
    expect(storeMock).toHaveBeenCalledWith({
      beforeId: "01Z",
      type: "task.created",
      since: "2026-05-23T00:00:00.000Z",
      limit: 50,
    });
  });

  it("omits empty filters and a zero limit", async () => {
    await handler(create(grackle.QueryDomainEventsRequestSchema, {}));
    expect(storeMock).toHaveBeenCalledWith({});
  });

  it("maps rows to proto DomainEvent (payload column -> payloadJson)", async () => {
    storeMock.mockReturnValue([
      { id: "01A", type: "task.created", timestamp: "2026-05-23T01:00:00.000Z", payload: '{"taskId":"t1"}' },
    ]);
    const res = await handler(create(grackle.QueryDomainEventsRequestSchema, {}));
    expect(res.events).toHaveLength(1);
    expect(res.events[0]).toMatchObject({
      id: "01A",
      type: "task.created",
      timestamp: "2026-05-23T01:00:00.000Z",
      payloadJson: '{"taskId":"t1"}',
    });
  });
});

describe("getStreamTranscript handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamStoreMock.mockReturnValue([]);
  });

  it("maps request to the store query (stream id + before cursor + limit)", async () => {
    await transcriptHandler(create(grackle.GetStreamTranscriptRequestSchema, {
      streamId: "stream-1",
      beforeSeq: "01Z",
      limit: 25,
    }));
    expect(streamStoreMock).toHaveBeenCalledWith({ streamId: "stream-1", beforeSeq: "01Z", limit: 25 });
  });

  it("omits an empty before cursor and a zero limit", async () => {
    await transcriptHandler(create(grackle.GetStreamTranscriptRequestSchema, { streamId: "stream-1" }));
    expect(streamStoreMock).toHaveBeenCalledWith({ streamId: "stream-1" });
  });

  it("maps rows to proto StreamMessageEvent", async () => {
    streamStoreMock.mockReturnValue([
      { seq: "01A", streamId: "stream-1", senderId: "sess-1", content: "hi", timestamp: "2026-05-24T00:00:00.000Z" },
    ]);
    const res = await transcriptHandler(create(grackle.GetStreamTranscriptRequestSchema, { streamId: "stream-1" }));
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0]).toMatchObject({
      streamId: "stream-1",
      seq: "01A",
      senderId: "sess-1",
      content: "hi",
      timestamp: "2026-05-24T00:00:00.000Z",
    });
  });
});
