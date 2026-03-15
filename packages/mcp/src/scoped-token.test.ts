import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  createScopedToken,
  verifyScopedToken,
  revokeTask,
  isRevokedTask,
  pruneRevocations,
  clearRevocations,
} from "./scoped-token.js";

const SIGNING_SECRET = "a".repeat(64);

const CLAIMS = {
  sub: "task-1",
  pid: "project-1",
  per: "persona-1",
  sid: "session-1",
};

describe("scoped-token", () => {
  beforeEach(() => {
    clearRevocations();
    vi.restoreAllMocks();
  });

  /** Round-trip: create → verify returns matching claims. */
  test("round-trip create and verify returns matching claims", () => {
    const token = createScopedToken(CLAIMS, SIGNING_SECRET);
    const result = verifyScopedToken(token, SIGNING_SECRET);
    expect(result).not.toBeUndefined();
    expect(result!.sub).toBe(CLAIMS.sub);
    expect(result!.pid).toBe(CLAIMS.pid);
    expect(result!.per).toBe(CLAIMS.per);
    expect(result!.sid).toBe(CLAIMS.sid);
    expect(typeof result!.iat).toBe("number");
    expect(typeof result!.exp).toBe("number");
    expect(result!.exp).toBeGreaterThan(result!.iat);
  });

  /** Tampered payload should fail verification. */
  test("tampered payload returns null", () => {
    const token = createScopedToken(CLAIMS, SIGNING_SECRET);
    const [payload, signature] = token.split(".");
    // Flip a character in the payload
    const tampered = payload.slice(0, -1) + (payload.endsWith("A") ? "B" : "A");
    const result = verifyScopedToken(`${tampered}.${signature}`, SIGNING_SECRET);
    expect(result).toBeUndefined();
  });

  /** Tampered signature should fail verification. */
  test("tampered signature returns null", () => {
    const token = createScopedToken(CLAIMS, SIGNING_SECRET);
    const [payload, signature] = token.split(".");
    const tampered = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
    const result = verifyScopedToken(`${payload}.${tampered}`, SIGNING_SECRET);
    expect(result).toBeUndefined();
  });

  /** Expired token should fail verification. */
  test("expired token returns null", () => {
    // Create a token with 1ms TTL
    const token = createScopedToken(CLAIMS, SIGNING_SECRET, 1);
    // The token was just created but with TTL < 1 second, so exp <= iat
    // Since exp is in epoch seconds and TTL is 1ms, Math.floor(1/1000) = 0 seconds added
    const result = verifyScopedToken(token, SIGNING_SECRET);
    expect(result).toBeUndefined();
  });

  /** Wrong signing secret should fail verification. */
  test("wrong signing secret returns null", () => {
    const token = createScopedToken(CLAIMS, SIGNING_SECRET);
    const result = verifyScopedToken(token, "b".repeat(64));
    expect(result).toBeUndefined();
  });

  /** Empty string token should fail. */
  test("empty string returns null", () => {
    expect(verifyScopedToken("", SIGNING_SECRET)).toBeUndefined();
  });

  /** Token without a dot should fail. */
  test("no dot returns null", () => {
    expect(verifyScopedToken("nodothere", SIGNING_SECRET)).toBeUndefined();
  });

  /** Token with multiple dots should fail. */
  test("triple dot returns null", () => {
    expect(verifyScopedToken("a.b.c", SIGNING_SECRET)).toBeUndefined();
  });

  /** Token with dot at start should fail. */
  test("dot at start returns null", () => {
    expect(verifyScopedToken(".signature", SIGNING_SECRET)).toBeUndefined();
  });

  /** Token with dot at end should fail. */
  test("dot at end returns null", () => {
    expect(verifyScopedToken("payload.", SIGNING_SECRET)).toBeUndefined();
  });

  /** revokeTask marks a task as revoked. */
  test("revokeTask and isRevokedTask work correctly", () => {
    expect(isRevokedTask("task-1")).toBe(false);
    revokeTask("task-1");
    expect(isRevokedTask("task-1")).toBe(true);
    expect(isRevokedTask("task-2")).toBe(false);
  });

  /** pruneRevocations removes stale entries. */
  test("pruneRevocations removes old entries", () => {
    revokeTask("task-old");
    // Manually backdate the revocation by mocking Date.now
    const originalNow = Date.now;
    // Prune with a 0ms TTL — all entries are stale
    vi.spyOn(Date, "now").mockReturnValue(originalNow() + 25 * 60 * 60 * 1000);
    pruneRevocations();
    vi.restoreAllMocks();
    expect(isRevokedTask("task-old")).toBe(false);
  });

  /** pruneRevocations keeps recent entries. */
  test("pruneRevocations keeps recent entries", () => {
    revokeTask("task-recent");
    pruneRevocations();
    expect(isRevokedTask("task-recent")).toBe(true);
  });
});
