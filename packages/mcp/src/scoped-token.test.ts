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
const FLIP_LOWEST_BIT_MASK = 0x01;

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

  /** Tampered payload returns undefined. */
  test("tampered payload returns undefined", () => {
    const token = createScopedToken(CLAIMS, SIGNING_SECRET);
    const [payload, signature] = token.split(".");
    // Flip a character in the payload
    const tampered = payload.slice(0, -1) + (payload.endsWith("A") ? "B" : "A");
    const result = verifyScopedToken(`${tampered}.${signature}`, SIGNING_SECRET);
    expect(result).toBeUndefined();
  });

  /** Tampered signature returns undefined. */
  test("tampered signature returns undefined", () => {
    const token = createScopedToken(CLAIMS, SIGNING_SECRET);
    const [payload, signature] = token.split(".");
    const signatureBytes = Buffer.from(signature, "base64url");
    signatureBytes[0] ^= FLIP_LOWEST_BIT_MASK;
    const tampered = signatureBytes.toString("base64url");
    const result = verifyScopedToken(`${payload}.${tampered}`, SIGNING_SECRET);
    expect(result).toBeUndefined();
  });

  /** Expired token returns undefined. */
  test("expired token returns undefined", () => {
    // Create a token with 1ms TTL
    const token = createScopedToken(CLAIMS, SIGNING_SECRET, 1);
    // The token was just created but with TTL < 1 second, so exp <= iat
    // Since exp is in epoch seconds and TTL is 1ms, Math.floor(1/1000) = 0 seconds added
    const result = verifyScopedToken(token, SIGNING_SECRET);
    expect(result).toBeUndefined();
  });

  /** Wrong signing secret returns undefined. */
  test("wrong signing secret returns undefined", () => {
    const token = createScopedToken(CLAIMS, SIGNING_SECRET);
    const result = verifyScopedToken(token, "b".repeat(64));
    expect(result).toBeUndefined();
  });

  /** Empty string token should fail. */
  test("empty string returns undefined", () => {
    expect(verifyScopedToken("", SIGNING_SECRET)).toBeUndefined();
  });

  /** Token without a dot should fail. */
  test("no dot returns undefined", () => {
    expect(verifyScopedToken("nodothere", SIGNING_SECRET)).toBeUndefined();
  });

  /** Token with multiple dots should fail. */
  test("triple dot returns undefined", () => {
    expect(verifyScopedToken("a.b.c", SIGNING_SECRET)).toBeUndefined();
  });

  /** Token with dot at start should fail. */
  test("dot at start returns undefined", () => {
    expect(verifyScopedToken(".signature", SIGNING_SECRET)).toBeUndefined();
  });

  /** Token with dot at end should fail. */
  test("dot at end returns undefined", () => {
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
    // Advance time by 25 hours (beyond the default 24h TTL) so the entry is stale
    const originalNow = Date.now;
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
