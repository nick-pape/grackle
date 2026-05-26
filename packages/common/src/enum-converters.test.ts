import { describe, it, expect } from "vitest";
import { eventTypeToEnum, eventTypeToString } from "./enum-converters.js";
import { EventType } from "./gen/grackle/grackle_types_pb.js";

describe("EventType converters — widget", () => {
  it("maps the widget string to the enum and back", () => {
    expect(eventTypeToEnum("widget")).toBe(EventType.WIDGET);
    expect(eventTypeToString(EventType.WIDGET)).toBe("widget");
  });

  it("falls back to UNSPECIFIED / empty for unknown values", () => {
    expect(eventTypeToEnum("nope")).toBe(EventType.UNSPECIFIED);
    expect(eventTypeToString(999 as EventType)).toBe("");
  });
});

describe("EventType converters — turn framing (AHP HR2)", () => {
  it("round-trips turn_started / turn_complete / input_needed", () => {
    expect(eventTypeToEnum("turn_started")).toBe(EventType.TURN_STARTED);
    expect(eventTypeToEnum("turn_complete")).toBe(EventType.TURN_COMPLETE);
    expect(eventTypeToEnum("input_needed")).toBe(EventType.INPUT_NEEDED);
    expect(eventTypeToString(EventType.TURN_STARTED)).toBe("turn_started");
    expect(eventTypeToString(EventType.TURN_COMPLETE)).toBe("turn_complete");
    expect(eventTypeToString(EventType.INPUT_NEEDED)).toBe("input_needed");
  });
});
