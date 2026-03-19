import { createHmac } from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { signJwt, validateJwt, encrypt, decrypt } from "./crypto.js";

// Mock the logger and paths to avoid file-system side effects
vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("./paths.js", () => ({
  grackleHome: "/tmp/grackle-test",
}));

// Provide a deterministic master key so encrypt/decrypt tests are hermetic
const TEST_MASTER_KEY = "a".repeat(64);
process.env.GRACKLE_MASTER_KEY = TEST_MASTER_KEY;

const SECRET = "super-secret-key-for-testing";

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

describe("signJwt", () => {
  it("returns a compact three-part JWT string", () => {
    const token = signJwt({ sub: "user-1" }, SECRET);
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
  });

  it("encodes the HS256 header", () => {
    const token = signJwt({}, SECRET);
    const [encodedHeader] = token.split(".");
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
  });

  it("includes an iat claim when not supplied", () => {
    const before = Math.floor(Date.now() / 1000);
    const token = signJwt({}, SECRET);
    const after = Math.floor(Date.now() / 1000);

    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.iat).toBeLessThanOrEqual(after);
  });

  it("preserves a caller-supplied iat", () => {
    const customIat = 1_000_000;
    const token = signJwt({ iat: customIat }, SECRET);
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    expect(payload.iat).toBe(customIat);
  });

  it("encodes arbitrary additional claims", () => {
    const token = signJwt({ sub: "alice", role: "admin" }, SECRET);
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    expect(payload.sub).toBe("alice");
    expect(payload.role).toBe("admin");
  });
});

// ---------------------------------------------------------------------------
// validateJwt — valid token
// ---------------------------------------------------------------------------

describe("validateJwt", () => {
  describe("valid token", () => {
    it("returns the decoded payload for a freshly signed token", () => {
      const token = signJwt({ sub: "user-42" }, SECRET);
      const payload = validateJwt(token, SECRET);
      expect(payload.sub).toBe("user-42");
    });

    it("accepts a token with a future expiration", () => {
      const exp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const token = signJwt({ exp }, SECRET);
      const payload = validateJwt(token, SECRET);
      expect(payload.exp).toBe(exp);
    });

    it("accepts a token with no exp claim", () => {
      const token = signJwt({ sub: "no-exp" }, SECRET);
      const payload = validateJwt(token, SECRET);
      expect(payload.sub).toBe("no-exp");
      expect(payload.exp).toBeUndefined();
    });

    it("round-trips all standard claims", () => {
      const exp = Math.floor(Date.now() / 1000) + 60;
      const iat = Math.floor(Date.now() / 1000);
      const token = signJwt({ sub: "bob", exp, iat }, SECRET);
      const payload = validateJwt(token, SECRET);
      expect(payload.sub).toBe("bob");
      expect(payload.exp).toBe(exp);
      expect(payload.iat).toBe(iat);
    });
  });

  // ---------------------------------------------------------------------------
  // validateJwt — expired token
  // ---------------------------------------------------------------------------

  describe("expired token", () => {
    it("throws when exp is exactly now (not strictly in the future)", () => {
      const now = Math.floor(Date.now() / 1000);
      const token = signJwt({ exp: now }, SECRET);
      expect(() => validateJwt(token, SECRET)).toThrow("JWT expired");
    });

    it("throws when exp is in the past", () => {
      const pastExp = Math.floor(Date.now() / 1000) - 1;
      const token = signJwt({ exp: pastExp }, SECRET);
      expect(() => validateJwt(token, SECRET)).toThrow("JWT expired");
    });

    it("throws when exp is well in the past", () => {
      const token = signJwt({ exp: 1 }, SECRET); // epoch + 1 s
      expect(() => validateJwt(token, SECRET)).toThrow("JWT expired");
    });
  });

  // ---------------------------------------------------------------------------
  // validateJwt — invalid signature
  // ---------------------------------------------------------------------------

  describe("invalid signature", () => {
    it("throws when the signature is tampered", () => {
      const token = signJwt({ sub: "user" }, SECRET);
      const [h, p] = token.split(".");
      const tampered = `${h}.${p}.invalidsignature`;
      expect(() => validateJwt(tampered, SECRET)).toThrow("signature verification failed");
    });

    it("throws when signed with a different secret", () => {
      const token = signJwt({ sub: "user" }, SECRET);
      expect(() => validateJwt(token, "wrong-secret")).toThrow("signature verification failed");
    });

    it("throws when the signature segment is empty", () => {
      const token = signJwt({}, SECRET);
      const [h, p] = token.split(".");
      expect(() => validateJwt(`${h}.${p}.`, SECRET)).toThrow("signature verification failed");
    });
  });

  // ---------------------------------------------------------------------------
  // validateJwt — malformed token
  // ---------------------------------------------------------------------------

  describe("malformed token", () => {
    it("throws for a completely empty string", () => {
      expect(() => validateJwt("", SECRET)).toThrow("JWT malformed");
    });

    it("throws when fewer than three parts", () => {
      expect(() => validateJwt("onlyone", SECRET)).toThrow("JWT malformed");
      expect(() => validateJwt("two.parts", SECRET)).toThrow("JWT malformed");
    });

    it("throws when more than three parts", () => {
      expect(() => validateJwt("a.b.c.d", SECRET)).toThrow("JWT malformed");
    });

    it("throws when the header is not valid base64url JSON", () => {
      // 'not-json' base64url-encoded
      const badHeader = Buffer.from("not-json").toString("base64url");
      const token = signJwt({}, SECRET);
      const [, p, s] = token.split(".");
      expect(() => validateJwt(`${badHeader}.${p}.${s}`, SECRET)).toThrow("JWT malformed");
    });

    it("throws for an unsupported algorithm in the header", () => {
      // Craft a token that claims RS256 but is signed with HMAC
      const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({ sub: "x" })).toString("base64url");
      expect(() => validateJwt(`${header}.${payload}.fakesig`, SECRET)).toThrow(
        "JWT unsupported algorithm",
      );
    });

    it("throws when the payload is not valid base64url JSON", () => {
      const token = signJwt({}, SECRET);
      const [h] = token.split(".");
      const badPayload = Buffer.from("!!!not-json!!!").toString("base64url");
      // Re-sign so signature matches the bad payload (so we get past signature check)
      const sig = createHmac("sha256", SECRET)
        .update(`${h}.${badPayload}`)
        .digest("base64url");
      expect(() => validateJwt(`${h}.${badPayload}.${sig}`, SECRET)).toThrow("JWT malformed");
    });
  });
});

// ---------------------------------------------------------------------------
// encrypt / decrypt (existing helpers — smoke tests)
// ---------------------------------------------------------------------------

describe("encrypt / decrypt", () => {
  it("round-trips a plaintext string", () => {
    const plaintext = "hello, grackle!";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it("produces different ciphertexts for the same input (random IV/salt)", () => {
    const plaintext = "same input";
    expect(encrypt(plaintext)).not.toBe(encrypt(plaintext));
  });

  it("throws for ciphertext with wrong number of parts", () => {
    expect(() => decrypt("bad:format")).toThrow("Invalid encrypted format");
  });
});
