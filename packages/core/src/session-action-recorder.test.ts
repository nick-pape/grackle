import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";

// Mock the durable store and logger before importing the module under test.
vi.mock("@grackle-ai/database", () => ({
  persistSessionAction: vi.fn(),
}));
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { persistSessionAction } from "@grackle-ai/database";
import { logger } from "./logger.js";
import { recordSessionAction } from "./session-action-recorder.js";

const persistMock = vi.mocked(persistSessionAction);

/** Build a SessionEvent with sensible defaults for recording. */
function makeEvent(overrides: Partial<grackle.SessionEvent> = {}): grackle.SessionEvent {
  return create(grackle.SessionEventSchema, {
    sessionId: "sess-1",
    type: grackle.EventType.TEXT,
    content: "hello",
    raw: "",
    timestamp: "2026-05-24T00:00:00.000Z",
    ...overrides,
  });
}

describe("recordSessionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists the event with the enum mapped to its string type and a serverSeq", () => {
    recordSessionAction(
      makeEvent({ type: grackle.EventType.TOOL_USE, content: "ran", raw: '{"n":1}' }),
    );

    expect(persistMock).toHaveBeenCalledTimes(1);
    const record = persistMock.mock.calls[0][0];
    expect(record).toMatchObject({
      sessionId: "sess-1",
      type: "tool_use", // eventTypeToString(TOOL_USE)
      content: "ran",
      raw: '{"n":1}',
      timestamp: "2026-05-24T00:00:00.000Z",
    });
    expect(typeof record.seq).toBe("string");
    expect(record.seq.length).toBeGreaterThan(0);
  });

  it("assigns strictly increasing seq across successive calls (single shared generator)", () => {
    recordSessionAction(makeEvent({ content: "a" }));
    recordSessionAction(makeEvent({ content: "b" }));

    const seqA = persistMock.mock.calls[0][0].seq;
    const seqB = persistMock.mock.calls[1][0].seq;
    expect(seqA).not.toBe(seqB);
    // ULIDs sort lexicographically; the second must order after the first.
    expect(seqA < seqB).toBe(true);
  });

  it("is non-fatal — a persist failure is swallowed and logged, never thrown", () => {
    persistMock.mockImplementationOnce(() => {
      throw new Error("db down");
    });

    expect(() => recordSessionAction(makeEvent())).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess-1" }),
      "Failed to persist session action",
    );
  });
});
