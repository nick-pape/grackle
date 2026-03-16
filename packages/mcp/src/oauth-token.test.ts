import { createHmac } from "node:crypto";
import { describe, test, expect, beforeEach, vi } from "vitest";
import { createOAuthAccessToken, verifyOAuthAccessToken } from "./oauth-token.js";

const SIGNING_SECRET = "a".repeat(64);
const CLIENT_ID = "test-client-id";
const RESOURCE = "http://127.0.0.1:7435";
const FLIP_LOWEST_BIT_MASK = 0x01;

describe("oauth-token", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /** Round-trip: create → verify returns matching claims. */
  test("round-trip create and verify returns matching claims", () => {
    const token = createOAuthAccessToken(CLIENT_ID, RESOURCE, SIGNING_SECRET);
    const result = verifyOAuthAccessToken(token, SIGNING_SECRET);
    expect(result).not.toBeUndefined();
    expect(result!.typ).toBe("oauth");
    expect(result!.sub).toBe(CLIENT_ID);
    expect(result!.aud).toBe(RESOURCE);
    expect(typeof result!.iat).toBe("number");
    expect(typeof result!.exp).toBe("number");
    expect(result!.exp).toBeGreaterThan(result!.iat);
  });

  /** Tampered payload returns undefined. */
  test("tampered payload returns undefined", () => {
    const token = createOAuthAccessToken(CLIENT_ID, RESOURCE, SIGNING_SECRET);
    const [payload, signature] = token.split(".");
    const tampered = payload.slice(0, -1) + (payload.endsWith("A") ? "B" : "A");
    const result = verifyOAuthAccessToken(`${tampered}.${signature}`, SIGNING_SECRET);
    expect(result).toBeUndefined();
  });

  /** Tampered signature returns undefined. */
  test("tampered signature returns undefined", () => {
    const token = createOAuthAccessToken(CLIENT_ID, RESOURCE, SIGNING_SECRET);
    const [payload, signature] = token.split(".");
    const signatureBytes = Buffer.from(signature, "base64url");
    signatureBytes[0] ^= FLIP_LOWEST_BIT_MASK;
    const tampered = signatureBytes.toString("base64url");
    const result = verifyOAuthAccessToken(`${payload}.${tampered}`, SIGNING_SECRET);
    expect(result).toBeUndefined();
  });

  /** Expired token returns undefined. */
  test("expired token returns undefined", () => {
    // Create a token with 1ms TTL — Math.floor(1/1000) = 0, so exp <= iat
    const token = createOAuthAccessToken(CLIENT_ID, RESOURCE, SIGNING_SECRET, 1);
    const result = verifyOAuthAccessToken(token, SIGNING_SECRET);
    expect(result).toBeUndefined();
  });

  /** Wrong signing secret returns undefined. */
  test("wrong signing secret returns undefined", () => {
    const token = createOAuthAccessToken(CLIENT_ID, RESOURCE, SIGNING_SECRET);
    const result = verifyOAuthAccessToken(token, "b".repeat(64));
    expect(result).toBeUndefined();
  });

  /** Empty string token should fail. */
  test("empty string returns undefined", () => {
    expect(verifyOAuthAccessToken("", SIGNING_SECRET)).toBeUndefined();
  });

  /** Token without a dot should fail. */
  test("no dot returns undefined", () => {
    expect(verifyOAuthAccessToken("nodothere", SIGNING_SECRET)).toBeUndefined();
  });

  /** Token with multiple dots should fail. */
  test("triple dot returns undefined", () => {
    expect(verifyOAuthAccessToken("a.b.c", SIGNING_SECRET)).toBeUndefined();
  });

  /** Token with dot at start should fail. */
  test("dot at start returns undefined", () => {
    expect(verifyOAuthAccessToken(".signature", SIGNING_SECRET)).toBeUndefined();
  });

  /** Token with dot at end should fail. */
  test("dot at end returns undefined", () => {
    expect(verifyOAuthAccessToken("payload.", SIGNING_SECRET)).toBeUndefined();
  });

  /** A scoped token (without typ === "oauth") should not verify as OAuth. */
  test("scoped token is not accepted as oauth token", () => {
    // Manually create a token-like payload without typ field
    const payload = Buffer.from(JSON.stringify({
      sub: "task-1", pid: "project-1", per: "persona-1", sid: "session-1",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url");
    // Sign it (replicating the HMAC pattern)
    const sig = createHmac("sha256", SIGNING_SECRET).update(payload).digest().toString("base64url");
    const token = `${payload}.${sig}`;
    const result = verifyOAuthAccessToken(token, SIGNING_SECRET);
    expect(result).toBeUndefined();
  });
});
