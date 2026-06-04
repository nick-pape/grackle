import { describe, it, expect } from "vitest";
import {
  SESSION_TRANSITIONS,
  isValidTransition,
  assertTransition,
  InvalidSessionTransitionError,
} from "./session-state-machine.js";
import { SESSION_STATUS } from "./types.js";
import type { SessionStatus } from "./types.js";

const ALL_STATUSES: SessionStatus[] = Object.values(SESSION_STATUS);

const LEGAL_TRANSITIONS: Array<[SessionStatus, SessionStatus]> = [
  // pending
  [SESSION_STATUS.PENDING, SESSION_STATUS.RUNNING],
  [SESSION_STATUS.PENDING, SESSION_STATUS.STOPPED],
  // running
  [SESSION_STATUS.RUNNING, SESSION_STATUS.IDLE],
  [SESSION_STATUS.RUNNING, SESSION_STATUS.STOPPED],
  [SESSION_STATUS.RUNNING, SESSION_STATUS.SUSPENDED],
  // idle
  [SESSION_STATUS.IDLE, SESSION_STATUS.RUNNING],
  [SESSION_STATUS.IDLE, SESSION_STATUS.STOPPED],
  [SESSION_STATUS.IDLE, SESSION_STATUS.SUSPENDED],
  // stopped is terminal — no outgoing transitions
  // suspended
  [SESSION_STATUS.SUSPENDED, SESSION_STATUS.RUNNING],
  [SESSION_STATUS.SUSPENDED, SESSION_STATUS.STOPPED],
];

describe("SESSION_TRANSITIONS", () => {
  it("covers every SessionStatus value as a key", () => {
    for (const status of ALL_STATUSES) {
      expect(SESSION_TRANSITIONS.has(status)).toBe(true);
    }
  });
});

describe("isValidTransition", () => {
  it.each(LEGAL_TRANSITIONS)("%s → %s is valid", (from, to) => {
    expect(isValidTransition(from, to)).toBe(true);
  });

  it("same-state transitions are valid (idempotent)", () => {
    for (const status of ALL_STATUSES) {
      expect(isValidTransition(status, status)).toBe(true);
    }
  });

  it("rejects all illegal transitions", () => {
    const legalSet = new Set(LEGAL_TRANSITIONS.map(([f, t]) => `${f}->${t}`));
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (from === to) {
          continue;
        }
        const key = `${from}->${to}`;
        if (!legalSet.has(key)) {
          expect(isValidTransition(from, to)).toBe(false);
        }
      }
    }
  });
});

describe("assertTransition", () => {
  it.each(LEGAL_TRANSITIONS)("%s → %s does not throw", (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it("same-state transitions do not throw", () => {
    for (const status of ALL_STATUSES) {
      expect(() => assertTransition(status, status)).not.toThrow();
    }
  });

  it("throws InvalidSessionTransitionError on illegal transition", () => {
    expect(() => assertTransition(SESSION_STATUS.PENDING, SESSION_STATUS.IDLE)).toThrow(
      InvalidSessionTransitionError,
    );
  });

  it("error carries from and to fields", () => {
    try {
      assertTransition(SESSION_STATUS.STOPPED, SESSION_STATUS.IDLE);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidSessionTransitionError);
      const e = err as InvalidSessionTransitionError;
      expect(e.from).toBe(SESSION_STATUS.STOPPED);
      expect(e.to).toBe(SESSION_STATUS.IDLE);
      expect(e.message).toContain("stopped");
      expect(e.message).toContain("idle");
    }
  });

  it("rejects all illegal transitions", () => {
    const legalSet = new Set(LEGAL_TRANSITIONS.map(([f, t]) => `${f}->${t}`));
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (from === to) {
          continue;
        }
        const key = `${from}->${to}`;
        if (!legalSet.has(key)) {
          expect(() => assertTransition(from, to)).toThrow(InvalidSessionTransitionError);
        }
      }
    }
  });
});
