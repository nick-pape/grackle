import { describe, it, expect, beforeEach } from "vitest";
import {
  createSession,
  validateSessionCookie,
  parseCookies,
  clearSessions,
  SESSION_COOKIE_NAME,
} from "./session.js";

const TEST_API_KEY = "a".repeat(64);

describe("session", () => {
  beforeEach(() => {
    clearSessions();
  });

  describe("parseCookies", () => {
    it("parses a standard cookie header", () => {
      expect(parseCookies("foo=bar; baz=qux")).toEqual({ foo: "bar", baz: "qux" });
    });

    it("returns empty object for empty string", () => {
      expect(parseCookies("")).toEqual({});
    });

    it("handles values with equals signs", () => {
      expect(parseCookies("tok=abc=def")).toEqual({ tok: "abc=def" });
    });

    it("trims whitespace around names and values", () => {
      expect(parseCookies("  name  =  value  ")).toEqual({ name: "value" });
    });
  });

  describe("createSession", () => {
    it("returns a Set-Cookie header string", () => {
      const cookie = createSession(TEST_API_KEY);
      expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("Max-Age=");
    });

    it("produces a cookie with sessionId.signature format", () => {
      const cookie = createSession(TEST_API_KEY);
      const valueMatch = cookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
      expect(valueMatch).not.toBeNull();
      const value = valueMatch![1];
      expect(value).toContain(".");
      const [sessionId, signature] = value.split(".");
      expect(sessionId.length).toBe(64); // 32 bytes hex
      expect(signature.length).toBe(64); // sha256 hex
    });

    it("does not include Secure flag by default", () => {
      const cookie = createSession(TEST_API_KEY);
      expect(cookie).not.toContain("; Secure");
    });

    it("includes Secure flag when options.secure is true", () => {
      const cookie = createSession(TEST_API_KEY, { secure: true });
      expect(cookie).toContain("; Secure");
    });
  });

  describe("validateSessionCookie", () => {
    it("accepts a valid session cookie", () => {
      const setCookie = createSession(TEST_API_KEY);
      const valueMatch = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
      const cookieHeader = `${SESSION_COOKIE_NAME}=${valueMatch![1]}`;
      expect(validateSessionCookie(cookieHeader, TEST_API_KEY)).toBe(true);
    });

    it("rejects a tampered signature", () => {
      const setCookie = createSession(TEST_API_KEY);
      const valueMatch = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
      const [sessionId] = valueMatch![1].split(".");
      const fakeCookie = `${SESSION_COOKIE_NAME}=${sessionId}.${"f".repeat(64)}`;
      expect(validateSessionCookie(fakeCookie, TEST_API_KEY)).toBe(false);
    });

    it("rejects a cookie signed with a different key", () => {
      const setCookie = createSession(TEST_API_KEY);
      const valueMatch = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
      const cookieHeader = `${SESSION_COOKIE_NAME}=${valueMatch![1]}`;
      const differentKey = "b".repeat(64);
      expect(validateSessionCookie(cookieHeader, differentKey)).toBe(false);
    });

    it("rejects an empty cookie header", () => {
      expect(validateSessionCookie("", TEST_API_KEY)).toBe(false);
    });

    it("rejects a malformed cookie value (no dot)", () => {
      const cookieHeader = `${SESSION_COOKIE_NAME}=nodot`;
      expect(validateSessionCookie(cookieHeader, TEST_API_KEY)).toBe(false);
    });

    it("rejects a cookie for a non-existent session", () => {
      // Create a validly-signed cookie but for a session that doesn't exist
      const cookieHeader = `${SESSION_COOKIE_NAME}=${"c".repeat(64)}.${"d".repeat(64)}`;
      expect(validateSessionCookie(cookieHeader, TEST_API_KEY)).toBe(false);
    });
  });
});
