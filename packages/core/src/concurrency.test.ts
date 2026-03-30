import { describe, it, expect, vi } from "vitest";

import { getEffectiveLimit, hasCapacity, type ConcurrencyDeps } from "./concurrency.js";
import { DEFAULT_MAX_CONCURRENT_SESSIONS, SETTINGS_KEY_MAX_CONCURRENT_SESSIONS } from "@grackle-ai/common";

function createMockDeps(overrides: Partial<ConcurrencyDeps> = {}): ConcurrencyDeps {
  return {
    countActiveForEnvironment: vi.fn().mockReturnValue(0),
    getEnvironment: vi.fn().mockReturnValue({ maxConcurrentSessions: 0 }),
    getSetting: vi.fn().mockReturnValue(undefined),
    ...overrides,
  };
}

describe("getEffectiveLimit", () => {
  it("uses environment override when non-zero", () => {
    const deps = createMockDeps({
      getEnvironment: vi.fn().mockReturnValue({ maxConcurrentSessions: 2 }),
      getSetting: vi.fn().mockReturnValue("10"),
    });
    expect(getEffectiveLimit("env-1", deps)).toBe(2);
  });

  it("falls back to global setting when environment is 0", () => {
    const deps = createMockDeps({
      getEnvironment: vi.fn().mockReturnValue({ maxConcurrentSessions: 0 }),
      getSetting: vi.fn().mockReturnValue("6"),
    });
    expect(getEffectiveLimit("env-1", deps)).toBe(6);
    expect(deps.getSetting).toHaveBeenCalledWith(SETTINGS_KEY_MAX_CONCURRENT_SESSIONS);
  });

  it("falls back to DEFAULT_MAX_CONCURRENT_SESSIONS when no setting", () => {
    const deps = createMockDeps({
      getEnvironment: vi.fn().mockReturnValue({ maxConcurrentSessions: 0 }),
      getSetting: vi.fn().mockReturnValue(undefined),
    });
    expect(getEffectiveLimit("env-1", deps)).toBe(DEFAULT_MAX_CONCURRENT_SESSIONS);
  });

  it("falls back to default when environment not found", () => {
    const deps = createMockDeps({
      getEnvironment: vi.fn().mockReturnValue(undefined),
      getSetting: vi.fn().mockReturnValue(undefined),
    });
    expect(getEffectiveLimit("env-1", deps)).toBe(DEFAULT_MAX_CONCURRENT_SESSIONS);
  });

  it("ignores invalid (non-numeric) global setting", () => {
    const deps = createMockDeps({
      getSetting: vi.fn().mockReturnValue("not-a-number"),
    });
    expect(getEffectiveLimit("env-1", deps)).toBe(DEFAULT_MAX_CONCURRENT_SESSIONS);
  });

  it("ignores zero or negative global setting", () => {
    const deps = createMockDeps({
      getSetting: vi.fn().mockReturnValue("0"),
    });
    expect(getEffectiveLimit("env-1", deps)).toBe(DEFAULT_MAX_CONCURRENT_SESSIONS);
  });
});

describe("hasCapacity", () => {
  it("returns true when active count is below limit", () => {
    const deps = createMockDeps({
      countActiveForEnvironment: vi.fn().mockReturnValue(1),
      getEnvironment: vi.fn().mockReturnValue({ maxConcurrentSessions: 3 }),
    });
    expect(hasCapacity("env-1", deps)).toBe(true);
  });

  it("returns false when active count equals limit", () => {
    const deps = createMockDeps({
      countActiveForEnvironment: vi.fn().mockReturnValue(3),
      getEnvironment: vi.fn().mockReturnValue({ maxConcurrentSessions: 3 }),
    });
    expect(hasCapacity("env-1", deps)).toBe(false);
  });

  it("returns false when active count exceeds limit", () => {
    const deps = createMockDeps({
      countActiveForEnvironment: vi.fn().mockReturnValue(5),
      getEnvironment: vi.fn().mockReturnValue({ maxConcurrentSessions: 3 }),
    });
    expect(hasCapacity("env-1", deps)).toBe(false);
  });

  it("uses default limit when no overrides set", () => {
    const deps = createMockDeps({
      countActiveForEnvironment: vi.fn().mockReturnValue(DEFAULT_MAX_CONCURRENT_SESSIONS - 1),
    });
    expect(hasCapacity("env-1", deps)).toBe(true);

    vi.mocked(deps.countActiveForEnvironment).mockReturnValue(DEFAULT_MAX_CONCURRENT_SESSIONS);
    expect(hasCapacity("env-1", deps)).toBe(false);
  });
});
