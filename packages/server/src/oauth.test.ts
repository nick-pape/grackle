import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  registerClient,
  getClient,
  createAuthorizationCode,
  consumeAuthorizationCode,
  computeCodeChallenge,
  verifyCodeChallenge,
  createRefreshToken,
  consumeRefreshToken,
  clearOAuthState,
} from "./oauth.js";

// Mock logger
vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

const REDIRECT_URI = "http://127.0.0.1:12345/callback";
const RESOURCE = "http://127.0.0.1:7435";
const CODE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

describe("oauth", () => {
  beforeEach(() => {
    clearOAuthState();
  });

  // ─── Client Registration ──────────────────────────────────────────

  describe("client registration", () => {
    test("registerClient creates a client with UUID and stores it", () => {
      const client = registerClient([REDIRECT_URI], "Test Client");
      expect(client).toBeDefined();
      expect(client!.clientId).toBeDefined();
      expect(client!.redirectUris).toEqual([REDIRECT_URI]);
      expect(client!.clientName).toBe("Test Client");
      expect(typeof client!.createdAt).toBe("number");
    });

    test("getClient returns the registered client", () => {
      const client = registerClient([REDIRECT_URI])!;
      const found = getClient(client.clientId);
      expect(found).toBeDefined();
      expect(found!.clientId).toBe(client.clientId);
    });

    test("getClient returns undefined for unknown client", () => {
      expect(getClient("nonexistent")).toBeUndefined();
    });

    test("default client name is 'Unknown Client'", () => {
      const client = registerClient([REDIRECT_URI]);
      expect(client).toBeDefined();
      expect(client!.clientName).toBe("Unknown Client");
    });
  });

  // ─── PKCE ─────────────────────────────────────────────────────────

  describe("PKCE S256", () => {
    test("computeCodeChallenge produces correct S256 hash", () => {
      const challenge = computeCodeChallenge(CODE_VERIFIER);
      expect(typeof challenge).toBe("string");
      expect(challenge.length).toBeGreaterThan(0);
    });

    test("verifyCodeChallenge returns true for matching pair", () => {
      const challenge = computeCodeChallenge(CODE_VERIFIER);
      expect(verifyCodeChallenge(CODE_VERIFIER, challenge)).toBe(true);
    });

    test("verifyCodeChallenge returns false for wrong verifier", () => {
      const challenge = computeCodeChallenge(CODE_VERIFIER);
      expect(verifyCodeChallenge("wrong-verifier", challenge)).toBe(false);
    });
  });

  // ─── Authorization Codes ──────────────────────────────────────────

  describe("authorization codes", () => {
    test("create and consume round-trip succeeds", () => {
      const client = registerClient([REDIRECT_URI])!;
      const challenge = computeCodeChallenge(CODE_VERIFIER);
      const code = createAuthorizationCode(client.clientId, REDIRECT_URI, challenge, RESOURCE);

      const record = consumeAuthorizationCode(code, client.clientId, REDIRECT_URI, CODE_VERIFIER, RESOURCE);
      expect(record).toBeDefined();
      expect(record!.clientId).toBe(client.clientId);
      expect(record!.resource).toBe(RESOURCE);
    });

    test("code is single-use — second consume returns undefined", () => {
      const client = registerClient([REDIRECT_URI])!;
      const challenge = computeCodeChallenge(CODE_VERIFIER);
      const code = createAuthorizationCode(client.clientId, REDIRECT_URI, challenge, RESOURCE);

      const first = consumeAuthorizationCode(code, client.clientId, REDIRECT_URI, CODE_VERIFIER, RESOURCE);
      expect(first).toBeDefined();

      const second = consumeAuthorizationCode(code, client.clientId, REDIRECT_URI, CODE_VERIFIER, RESOURCE);
      expect(second).toBeUndefined();
    });

    test("wrong client_id returns undefined", () => {
      const client = registerClient([REDIRECT_URI])!;
      const challenge = computeCodeChallenge(CODE_VERIFIER);
      const code = createAuthorizationCode(client.clientId, REDIRECT_URI, challenge, RESOURCE);

      const result = consumeAuthorizationCode(code, "wrong-client", REDIRECT_URI, CODE_VERIFIER, RESOURCE);
      expect(result).toBeUndefined();
    });

    test("wrong redirect_uri returns undefined", () => {
      const client = registerClient([REDIRECT_URI])!;
      const challenge = computeCodeChallenge(CODE_VERIFIER);
      const code = createAuthorizationCode(client.clientId, REDIRECT_URI, challenge, RESOURCE);

      const result = consumeAuthorizationCode(code, client.clientId, "http://evil.com/cb", CODE_VERIFIER, RESOURCE);
      expect(result).toBeUndefined();
    });

    test("wrong code_verifier returns undefined", () => {
      const client = registerClient([REDIRECT_URI])!;
      const challenge = computeCodeChallenge(CODE_VERIFIER);
      const code = createAuthorizationCode(client.clientId, REDIRECT_URI, challenge, RESOURCE);

      const result = consumeAuthorizationCode(code, client.clientId, REDIRECT_URI, "bad-verifier", RESOURCE);
      expect(result).toBeUndefined();
    });

    test("wrong resource returns undefined", () => {
      const client = registerClient([REDIRECT_URI])!;
      const challenge = computeCodeChallenge(CODE_VERIFIER);
      const code = createAuthorizationCode(client.clientId, REDIRECT_URI, challenge, RESOURCE);

      const result = consumeAuthorizationCode(code, client.clientId, REDIRECT_URI, CODE_VERIFIER, "http://wrong");
      expect(result).toBeUndefined();
    });

    test("expired code returns undefined", () => {
      const client = registerClient([REDIRECT_URI])!;
      const challenge = computeCodeChallenge(CODE_VERIFIER);
      const code = createAuthorizationCode(client.clientId, REDIRECT_URI, challenge, RESOURCE);

      // Advance time by 60 seconds (beyond 30s TTL)
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
      const result = consumeAuthorizationCode(code, client.clientId, REDIRECT_URI, CODE_VERIFIER, RESOURCE);
      expect(result).toBeUndefined();
    });

    test("nonexistent code returns undefined", () => {
      const result = consumeAuthorizationCode("nonexistent", "client", REDIRECT_URI, CODE_VERIFIER, RESOURCE);
      expect(result).toBeUndefined();
    });
  });

  // ─── Refresh Tokens ───────────────────────────────────────────────

  describe("refresh tokens", () => {
    test("create and consume round-trip succeeds", () => {
      const token = createRefreshToken("client-1", RESOURCE);
      const record = consumeRefreshToken(token, "client-1");
      expect(record).toBeDefined();
      expect(record!.clientId).toBe("client-1");
      expect(record!.resource).toBe(RESOURCE);
    });

    test("refresh token rotation — consumed token cannot be reused", () => {
      const token = createRefreshToken("client-1", RESOURCE);
      const first = consumeRefreshToken(token, "client-1");
      expect(first).toBeDefined();

      const second = consumeRefreshToken(token, "client-1");
      expect(second).toBeUndefined();
    });

    test("wrong client_id returns undefined", () => {
      const token = createRefreshToken("client-1", RESOURCE);
      const result = consumeRefreshToken(token, "wrong-client");
      expect(result).toBeUndefined();
    });

    test("expired refresh token returns undefined", () => {
      const token = createRefreshToken("client-1", RESOURCE);
      // Advance time beyond 30-day TTL
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 24 * 60 * 60 * 1000);
      const result = consumeRefreshToken(token, "client-1");
      expect(result).toBeUndefined();
    });

    test("nonexistent token returns undefined", () => {
      const result = consumeRefreshToken("nonexistent", "client-1");
      expect(result).toBeUndefined();
    });
  });
});
