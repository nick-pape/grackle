import { describe, it, expect } from "vitest";
import { formatTokens, formatCost } from "./format.js";

describe("formatTokens", () => {
  it("shows small numbers as-is", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(4)).toBe("4");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands with k suffix", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(1952)).toBe("2.0k");
    expect(formatTokens(12345)).toBe("12.3k");
    expect(formatTokens(999999)).toBe("1000.0k");
  });

  it("formats millions with M suffix", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(1_234_567)).toBe("1.2M");
  });
});

describe("formatCost", () => {
  it("shows dash for zero", () => {
    expect(formatCost(0)).toBe("-");
  });

  it("shows 4 decimal places for small costs", () => {
    expect(formatCost(0.0039)).toBe("$0.0039");
    expect(formatCost(0.005)).toBe("$0.0050");
  });

  it("shows 2 decimal places for larger costs", () => {
    expect(formatCost(0.01)).toBe("$0.01");
    expect(formatCost(1.23)).toBe("$1.23");
    expect(formatCost(12.5)).toBe("$12.50");
  });
});
