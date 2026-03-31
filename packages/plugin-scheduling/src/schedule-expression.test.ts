import { describe, it, expect, vi, afterEach } from "vitest";

import {
  parseDuration,
  isIntervalExpression,
  computeNextRunAt,
  validateExpression,
} from "./schedule-expression.js";

describe("schedule-expression", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── parseDuration ────────────────────────────────────────

  describe("parseDuration", () => {
    it("parses seconds", () => {
      expect(parseDuration("30s")).toBe(30_000);
    });

    it("parses minutes", () => {
      expect(parseDuration("5m")).toBe(300_000);
    });

    it("parses hours", () => {
      expect(parseDuration("1h")).toBe(3_600_000);
    });

    it("parses days", () => {
      expect(parseDuration("1d")).toBe(86_400_000);
    });

    it("parses multi-digit values", () => {
      expect(parseDuration("120s")).toBe(120_000);
    });

    it("rejects empty string", () => {
      expect(() => parseDuration("")).toThrow();
    });

    it("rejects zero seconds", () => {
      expect(() => parseDuration("0s")).toThrow();
    });

    it("rejects below minimum (10s)", () => {
      expect(() => parseDuration("3s")).toThrow(/minimum/i);
    });

    it("rejects non-numeric input", () => {
      expect(() => parseDuration("abc")).toThrow();
    });

    it("rejects negative values", () => {
      expect(() => parseDuration("-5m")).toThrow();
    });

    it("accepts exactly 10 seconds", () => {
      expect(parseDuration("10s")).toBe(10_000);
    });
  });

  // ── isIntervalExpression ──────────────────────────────────

  describe("isIntervalExpression", () => {
    it("detects interval shorthand", () => {
      expect(isIntervalExpression("30s")).toBe(true);
      expect(isIntervalExpression("5m")).toBe(true);
      expect(isIntervalExpression("1h")).toBe(true);
      expect(isIntervalExpression("1d")).toBe(true);
    });

    it("rejects cron expressions", () => {
      expect(isIntervalExpression("0 9 * * MON")).toBe(false);
      expect(isIntervalExpression("*/5 * * * *")).toBe(false);
    });

    it("rejects garbage", () => {
      expect(isIntervalExpression("abc")).toBe(false);
      expect(isIntervalExpression("")).toBe(false);
    });
  });

  // ── computeNextRunAt ──────────────────────────────────────

  describe("computeNextRunAt", () => {
    it("computes next run for interval without previous run", () => {
      const now = Date.now();
      const next = computeNextRunAt("30s");
      const nextMs = new Date(next).getTime();
      // Should be approximately now + 30s (within 1s tolerance)
      expect(nextMs).toBeGreaterThanOrEqual(now + 29_000);
      expect(nextMs).toBeLessThanOrEqual(now + 31_000);
    });

    it("anchors to lastRunAt for intervals (prevents drift)", () => {
      const lastRun = "2026-03-25T10:00:00.000Z";
      const lastRunMs = new Date(lastRun).getTime();
      // If lastRun + interval is in the future, use that
      vi.useFakeTimers({ now: lastRunMs + 5_000 }); // 5s after last run
      const next = computeNextRunAt("30s", lastRun);
      expect(new Date(next).getTime()).toBe(lastRunMs + 30_000);
      vi.useRealTimers();
    });

    it("caps at now + interval to prevent burst after downtime", () => {
      const lastRun = "2020-01-01T00:00:00.000Z"; // long ago
      const now = Date.now();
      const next = computeNextRunAt("30s", lastRun);
      const nextMs = new Date(next).getTime();
      // Should be capped to ~now + 30s, not lastRun + 30s (which is in the past)
      expect(nextMs).toBeGreaterThanOrEqual(now + 29_000);
      expect(nextMs).toBeLessThanOrEqual(now + 31_000);
    });

    it("computes next run for cron expression", () => {
      const now = new Date("2026-03-25T08:00:00Z"); // Tuesday 8am
      vi.useFakeTimers({ now });
      const next = computeNextRunAt("0 9 * * *"); // daily at 9am
      const nextDate = new Date(next);
      expect(nextDate.getUTCHours()).toBe(9);
      expect(nextDate.getTime()).toBeGreaterThan(now.getTime());
      vi.useRealTimers();
    });
  });

  // ── validateExpression ────────────────────────────────────

  describe("validateExpression", () => {
    it("accepts valid interval shorthand", () => {
      expect(() => validateExpression("30s")).not.toThrow();
      expect(() => validateExpression("5m")).not.toThrow();
      expect(() => validateExpression("1h")).not.toThrow();
      expect(() => validateExpression("1d")).not.toThrow();
    });

    it("accepts valid cron expressions", () => {
      expect(() => validateExpression("0 9 * * MON")).not.toThrow();
      expect(() => validateExpression("*/5 * * * *")).not.toThrow();
      expect(() => validateExpression("0 0 1 * *")).not.toThrow();
    });

    it("rejects invalid cron expressions", () => {
      expect(() => validateExpression("not a cron")).toThrow();
    });

    it("rejects intervals below minimum", () => {
      expect(() => validateExpression("3s")).toThrow(/minimum/i);
    });

    it("rejects empty string", () => {
      expect(() => validateExpression("")).toThrow();
    });
  });
});
