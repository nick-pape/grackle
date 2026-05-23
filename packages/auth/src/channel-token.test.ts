import { describe, test, expect } from "vitest";
import { createHmac } from "node:crypto";
import { createChannelToken, verifyChannelToken } from "./channel-token.js";

const SIGNING_SECRET = "a".repeat(64);
const FLIP_LOWEST_BIT_MASK = 0x01;

const GRANT = {
  chan: "grackle:/sessions/session-1",
  verbs: ["send_input"],
  jti: "grant-1",
};

describe("channel-token", () => {
  /** Round-trip: create -> verify returns matching claims. */
  test("round-trip create and verify returns matching claims", () => {
    const token = createChannelToken(GRANT, SIGNING_SECRET);
    const result = verifyChannelToken(token, SIGNING_SECRET);
    expect(result).not.toBeUndefined();
    expect(result!.chan).toBe(GRANT.chan);
    expect(result!.verbs).toEqual(GRANT.verbs);
    expect(result!.jti).toBe(GRANT.jti);
    expect(typeof result!.iat).toBe("number");
    expect(typeof result!.exp).toBe("number");
    expect(result!.exp).toBeGreaterThan(result!.iat);
  });

  /** A token signed with a different secret must not verify. */
  test("wrong secret fails verification", () => {
    const token = createChannelToken(GRANT, SIGNING_SECRET);
    expect(verifyChannelToken(token, "b".repeat(64))).toBeUndefined();
  });

  /** A tampered signature must not verify. */
  test("tampered signature fails verification", () => {
    const token = createChannelToken(GRANT, SIGNING_SECRET);
    const [payload, sig] = token.split(".");
    const sigBuf = Buffer.from(sig!, "base64url");
    sigBuf[0] ^= FLIP_LOWEST_BIT_MASK;
    const tampered = `${payload}.${sigBuf.toString("base64url")}`;
    expect(verifyChannelToken(tampered, SIGNING_SECRET)).toBeUndefined();
  });

  /** An expired token must not verify. */
  test("expired token fails verification", () => {
    const token = createChannelToken(GRANT, SIGNING_SECRET, -1000);
    expect(verifyChannelToken(token, SIGNING_SECRET)).toBeUndefined();
  });

  /** Malformed tokens (no dot / multiple dots) are rejected. */
  test("malformed tokens are rejected", () => {
    expect(verifyChannelToken("no-dot", SIGNING_SECRET)).toBeUndefined();
    expect(verifyChannelToken("a.b.c", SIGNING_SECRET)).toBeUndefined();
    expect(verifyChannelToken(".", SIGNING_SECRET)).toBeUndefined();
  });

  /** A correctly-signed payload whose `verbs` is not a string[] is rejected. */
  test("payload with non-array verbs is rejected", () => {
    const bad = { chan: GRANT.chan, verbs: "send_input", jti: GRANT.jti, iat: 1, exp: 9_999_999_999 };
    const payloadEncoded = Buffer.from(JSON.stringify(bad), "utf8").toString("base64url");
    const sig = createHmac("sha256", SIGNING_SECRET).update(payloadEncoded).digest().toString("base64url");
    expect(verifyChannelToken(`${payloadEncoded}.${sig}`, SIGNING_SECRET)).toBeUndefined();
  });
});
