import { describe, it, expect } from "vitest";
import {
  isNearAnchor,
  computeScrollCompensation,
  SCROLL_ANCHOR_THRESHOLD_PX,
} from "./scrollUtils.js";

describe("isNearAnchor", () => {
  // Default mode — anchor at bottom
  it("returns true when near the bottom in default mode", () => {
    // scrollHeight=1000, clientHeight=400, scrollTop=570 → distance = 1000-570-400 = 30 < 50
    expect(isNearAnchor(570, 1000, 400, false)).toBe(true);
  });

  it("returns false when scrolled well above the bottom in default mode", () => {
    // distance = 1000 - 200 - 400 = 400 > 50
    expect(isNearAnchor(200, 1000, 400, false)).toBe(false);
  });

  it("returns true when fully scrolled to bottom in default mode", () => {
    // distance = 1000 - 600 - 400 = 0 < 50
    expect(isNearAnchor(600, 1000, 400, false)).toBe(true);
  });

  // Reverse mode — anchor at top
  it("returns true when near the top in reverse mode", () => {
    // scrollTop = 20 < 50
    expect(isNearAnchor(20, 1000, 400, true)).toBe(true);
  });

  it("returns false when scrolled well below the top in reverse mode", () => {
    // scrollTop = 300 > 50
    expect(isNearAnchor(300, 1000, 400, true)).toBe(false);
  });

  it("returns true at exact top in reverse mode", () => {
    expect(isNearAnchor(0, 1000, 400, true)).toBe(true);
  });

  // Custom threshold
  it("respects a custom threshold parameter", () => {
    // distance = 1000 - 880 - 100 = 20, threshold=10 → 20 >= 10 → false
    expect(isNearAnchor(880, 1000, 100, false, 10)).toBe(false);
    // distance = 1000 - 895 - 100 = 5, threshold=10 → 5 < 10 → true
    expect(isNearAnchor(895, 1000, 100, false, 10)).toBe(true);
  });

  it("uses default threshold of SCROLL_ANCHOR_THRESHOLD_PX", () => {
    expect(SCROLL_ANCHOR_THRESHOLD_PX).toBe(50);
  });
});

describe("computeScrollCompensation", () => {
  it("returns positive delta when content was prepended", () => {
    expect(computeScrollCompensation(1000, 1200)).toBe(200);
  });

  it("returns 0 when no change occurred", () => {
    expect(computeScrollCompensation(1000, 1000)).toBe(0);
  });

  it("returns 0 when scrollHeight decreased", () => {
    expect(computeScrollCompensation(1000, 800)).toBe(0);
  });
});
