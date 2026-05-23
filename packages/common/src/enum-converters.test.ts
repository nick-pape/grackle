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
