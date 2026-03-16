import { describe, it, expect } from "vitest";
import { fuzzySearch } from "./search.js";

interface Item {
  title: string;
  description: string;
}

const ITEMS: Item[] = [
  { title: "Fix login bug", description: "Users cannot login with SSO" },
  { title: "Add dashboard widget", description: "Create analytics dashboard" },
  { title: "Update auth middleware", description: "Refactor authentication layer" },
  { title: "Implement JWT tokens", description: "Add token-based auth" },
  { title: "Fix signup page", description: "Email validation broken" },
];

const KEYS = [
  { name: "title", weight: 2 },
  { name: "description", weight: 1 },
];

describe("fuzzySearch", () => {
  it("returns empty array for empty query", () => {
    expect(fuzzySearch(ITEMS, "", KEYS)).toEqual([]);
  });

  it("returns empty array for whitespace-only query", () => {
    expect(fuzzySearch(ITEMS, "   ", KEYS)).toEqual([]);
  });

  it("matches by title substring", () => {
    const results = fuzzySearch(ITEMS, "login", KEYS);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].item.title).toBe("Fix login bug");
  });

  it("matches by description", () => {
    const results = fuzzySearch(ITEMS, "analytics", KEYS);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].item.title).toBe("Add dashboard widget");
  });

  it("is case-insensitive", () => {
    const results = fuzzySearch(ITEMS, "JWT", KEYS);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].item.title).toBe("Implement JWT tokens");
  });

  it("ranks title matches higher than description matches", () => {
    // "auth" appears in title of "Update auth middleware" and description of "Implement JWT tokens"
    const results = fuzzySearch(ITEMS, "auth", KEYS);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].item.title).toBe("Update auth middleware");
  });

  it("returns results sorted by score (best first)", () => {
    const results = fuzzySearch(ITEMS, "fix", KEYS);
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i - 1].score);
    }
  });

  it("respects limit parameter", () => {
    const results = fuzzySearch(ITEMS, "fix", KEYS, { limit: 1 });
    expect(results).toHaveLength(1);
  });

  it("excludes results above threshold", () => {
    const results = fuzzySearch(ITEMS, "xyznonexistent", KEYS, { threshold: 0.2 });
    expect(results).toHaveLength(0);
  });

  it("returns score between 0 and 1", () => {
    const results = fuzzySearch(ITEMS, "login", KEYS);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it("works with single-field search", () => {
    const results = fuzzySearch(ITEMS, "dashboard", [{ name: "title", weight: 1 }]);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].item.title).toBe("Add dashboard widget");
  });
});
