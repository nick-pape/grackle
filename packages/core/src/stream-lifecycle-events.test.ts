import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock logger to suppress output.
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock the domain-event bus so we can assert lifecycle emissions synchronously
// without touching the database. The registry imports `emit` from here (#1309).
vi.mock("./event-bus.js", () => ({
  emit: vi.fn(),
  subscribe: vi.fn(),
}));

import { emit } from "./event-bus.js";
import * as registry from "./stream-registry.js";

const emitMock = vi.mocked(emit);

/** Lifecycle calls only, filtered out of any other emits. */
function lifecycleCalls(type: string): unknown[][] {
  return emitMock.mock.calls.filter((c) => c[0] === type);
}

describe("stream-registry lifecycle events (#1309)", () => {
  beforeEach(() => {
    registry._resetForTesting();
    emitMock.mockClear();
  });

  it("emits stream.created for an observable room", () => {
    const stream = registry.createStream("planning-room", true);
    expect(emitMock).toHaveBeenCalledWith("stream.created", {
      streamId: stream.id,
      name: "planning-room",
      selfEcho: true,
    });
  });

  it("emits stream.attached on subscribe with permission + delivery mode", () => {
    const stream = registry.createStream("room");
    emitMock.mockClear();
    registry.subscribe(stream.id, "session-1", "rw", "async", false);
    expect(emitMock).toHaveBeenCalledWith("stream.attached", {
      streamId: stream.id,
      name: "room",
      sessionId: "session-1",
      permission: "rw",
      deliveryMode: "async",
    });
  });

  it("emits stream.detached on unsubscribe, and stream.closed when the last sub leaves", () => {
    const stream = registry.createStream("room");
    const a = registry.subscribe(stream.id, "session-a", "rw", "async", false);
    const b = registry.subscribe(stream.id, "session-b", "rw", "async", false);
    emitMock.mockClear();

    // First detach: room still has one subscriber — detached only, no close.
    registry.unsubscribe(a.id);
    expect(lifecycleCalls("stream.detached")).toHaveLength(1);
    expect(lifecycleCalls("stream.closed")).toHaveLength(0);

    // Last detach: room evaporates — detached + closed.
    registry.unsubscribe(b.id);
    expect(lifecycleCalls("stream.detached")).toHaveLength(2);
    expect(emitMock).toHaveBeenCalledWith("stream.closed", {
      streamId: stream.id,
      name: "room",
    });
  });

  it("emits stream.closed on deleteStream", () => {
    const stream = registry.createStream("room");
    registry.subscribe(stream.id, "operator:default", "rw", "detach", false);
    emitMock.mockClear();
    registry.deleteStream(stream.id);
    expect(emitMock).toHaveBeenCalledWith("stream.closed", {
      streamId: stream.id,
      name: "room",
    });
  });

  it("suppresses all lifecycle events for reserved (plumbing) stream names", () => {
    for (const name of ["lifecycle:sess-1", "pipe:abc", "stdin:xyz"]) {
      const stream = registry.createStream(name);
      const sub = registry.subscribe(stream.id, "session-1", "rw", "async", false);
      registry.unsubscribe(sub.id);
      registry.createStream(`${name}-2`);
    }
    expect(lifecycleCalls("stream.created")).toHaveLength(0);
    expect(lifecycleCalls("stream.attached")).toHaveLength(0);
    expect(lifecycleCalls("stream.detached")).toHaveLength(0);
    expect(lifecycleCalls("stream.closed")).toHaveLength(0);
  });
});
