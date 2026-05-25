import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";

vi.mock("@grackle-ai/database", () => ({
  queryDomainEvents: vi.fn(() => []),
  queryStreamMessages: vi.fn(() => []),
  querySessionActions: vi.fn(() => []),
}));

import {
  queryDomainEvents as storeQuery,
  queryStreamMessages as streamStoreQuery,
  querySessionActions as sessionStoreQuery,
} from "@grackle-ai/database";
import {
  queryDomainEvents as handler,
  getStreamTranscript as transcriptHandler,
  getSessionActions as sessionActionsHandler,
} from "./event-handlers.js";

const storeMock = vi.mocked(storeQuery);
const streamStoreMock = vi.mocked(streamStoreQuery);
const sessionStoreMock = vi.mocked(sessionStoreQuery);

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

describe("getSessionActions handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStoreMock.mockReturnValue([]);
  });

  it("maps request to the store query (session id + from cursor + limit)", async () => {
    await sessionActionsHandler(create(grackle.GetSessionActionsRequestSchema, {
      sessionId: "sess-1",
      fromSeq: "01Z",
      limit: 25,
    }));
    expect(sessionStoreMock).toHaveBeenCalledWith({ sessionId: "sess-1", fromSeq: "01Z", limit: 25 });
  });

  it("omits an empty from cursor and a zero limit", async () => {
    await sessionActionsHandler(create(grackle.GetSessionActionsRequestSchema, { sessionId: "sess-1" }));
    expect(sessionStoreMock).toHaveBeenCalledWith({ sessionId: "sess-1" });
  });

  it("maps rows to proto SessionAction (oldest first / replay order)", async () => {
    sessionStoreMock.mockReturnValue([
      { seq: "01A", sessionId: "sess-1", type: "text", content: "hi", raw: "", timestamp: "2026-05-24T00:00:00.000Z" },
      { seq: "01B", sessionId: "sess-1", type: "tool_use", content: "ran", raw: '{"n":1}', timestamp: "2026-05-24T00:00:01.000Z" },
    ]);
    const res = await sessionActionsHandler(create(grackle.GetSessionActionsRequestSchema, { sessionId: "sess-1" }));
    expect(res.actions).toHaveLength(2);
    expect(res.actions.map((a) => a.seq)).toEqual(["01A", "01B"]);
    expect(res.actions[1]).toMatchObject({
      seq: "01B",
      sessionId: "sess-1",
      type: "tool_use",
      content: "ran",
      raw: '{"n":1}',
      timestamp: "2026-05-24T00:00:01.000Z",
    });
  });
});
