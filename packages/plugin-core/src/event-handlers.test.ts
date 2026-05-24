import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";

vi.mock("@grackle-ai/database", () => ({ queryDomainEvents: vi.fn(() => []) }));

import { queryDomainEvents as storeQuery } from "@grackle-ai/database";
import { queryDomainEvents as handler } from "./event-handlers.js";

const storeMock = vi.mocked(storeQuery);

describe("queryDomainEvents handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMock.mockReturnValue([]);
  });

  it("maps non-empty request filters to the store query", async () => {
    await handler(create(grackle.QueryDomainEventsRequestSchema, {
      afterId: "01A",
      type: "task.created",
      since: "2026-05-23T00:00:00.000Z",
      limit: 50,
    }));
    expect(storeMock).toHaveBeenCalledWith({
      afterId: "01A",
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
