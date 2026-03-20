import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isGrackleEvent, parseWsMessage } from "./types.js";

describe("isGrackleEvent", () => {
  it("returns true for a valid GrackleEvent", () => {
    expect(
      isGrackleEvent({
        id: "01ABC",
        type: "task.created",
        timestamp: "2026-01-01T00:00:00Z",
        payload: { taskId: "t1" },
      }),
    ).toBe(true);
  });

  it("returns false when id is missing", () => {
    expect(
      isGrackleEvent({
        type: "task.created",
        timestamp: "2026-01-01T00:00:00Z",
        payload: {},
      }),
    ).toBe(false);
  });

  it("returns false when timestamp is missing", () => {
    expect(
      isGrackleEvent({
        id: "01ABC",
        type: "task.created",
        payload: {},
      }),
    ).toBe(false);
  });

  it("returns false for a plain WsMessage (no id/timestamp)", () => {
    expect(isGrackleEvent({ type: "list_environments" })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isGrackleEvent(null)).toBe(false);
  });

  it("returns false for a primitive", () => {
    expect(isGrackleEvent("hello")).toBe(false);
  });

  it("returns false when payload is not an object", () => {
    expect(
      isGrackleEvent({
        id: "01ABC",
        type: "task.created",
        timestamp: "2026-01-01T00:00:00Z",
        payload: "not-an-object",
      }),
    ).toBe(false);
  });
});

describe("parseWsMessage", () => {
  // Suppress console.warn output — parseWsMessage warns on invalid input and we
  // keep test output clean and focused by silencing this noise during tests.
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  it("returns a GrackleEvent when id and timestamp are present", () => {
    const json = JSON.stringify({
      id: "01ABC",
      type: "task.created",
      timestamp: "2026-01-01T00:00:00Z",
      payload: { taskId: "t1" },
    });
    const result = parseWsMessage(json);
    expect(result).toEqual({
      id: "01ABC",
      type: "task.created",
      timestamp: "2026-01-01T00:00:00Z",
      payload: { taskId: "t1" },
    });
    expect(isGrackleEvent(result)).toBe(true);
  });

  it("returns a plain WsMessage when id/timestamp are absent", () => {
    const json = JSON.stringify({ type: "list_environments", payload: { foo: 1 } });
    const result = parseWsMessage(json);
    expect(result).toEqual({ type: "list_environments", payload: { foo: 1 } });
    expect(isGrackleEvent(result)).toBe(false);
  });

  it("defaults payload to {} for GrackleEvent when payload is missing", () => {
    const json = JSON.stringify({
      id: "01ABC",
      type: "task.created",
      timestamp: "2026-01-01T00:00:00Z",
    });
    const result = parseWsMessage(json);
    expect(result).toEqual({
      id: "01ABC",
      type: "task.created",
      timestamp: "2026-01-01T00:00:00Z",
      payload: {},
    });
  });

  it("defaults payload to undefined for plain WsMessage when payload is missing", () => {
    const json = JSON.stringify({ type: "ping" });
    const result = parseWsMessage(json);
    expect(result).toEqual({ type: "ping", payload: undefined });
  });

  it("returns undefined for invalid JSON", () => {
    expect(parseWsMessage("not json")).toBeUndefined();
  });

  it("returns undefined when type field is missing", () => {
    expect(parseWsMessage(JSON.stringify({ id: "01ABC" }))).toBeUndefined();
  });

  it("returns undefined for a non-object JSON value", () => {
    expect(parseWsMessage(JSON.stringify(42))).toBeUndefined();
  });
});
