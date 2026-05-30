import { describe, it, expect } from "vitest";
import { buildSummary } from "./sessionsSummary.js";

describe("buildSummary", () => {
  it("reports the empty state when there are no sessions", () => {
    expect(buildSummary(0, 0, 0)).toBe("No sessions yet");
  });

  it("pluralizes sessions and environments correctly", () => {
    expect(buildSummary(1, 1, 1)).toBe("1 active of 1 session across 1 environment");
    expect(buildSummary(5, 2, 3)).toBe("2 active of 5 sessions across 3 environments");
  });
});
