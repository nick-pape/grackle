import { describe, test, expect, beforeEach } from "vitest";
import type http from "node:http";
import { authenticateMcpRequest } from "./auth-middleware.js";
import { createScopedToken, revokeTask, clearRevocations } from "./scoped-token.js";
import { createOAuthAccessToken } from "./oauth-token.js";

const API_KEY = "a".repeat(64);

const CLAIMS = {
  sub: "task-1",
  pid: "project-1",
  per: "persona-1",
  sid: "session-1",
};

const OAUTH_CLIENT_ID = "test-oauth-client";
const OAUTH_RESOURCE = "http://127.0.0.1:7435";

/** Helper to create a mock HTTP request with the given Authorization header value. */
function mockRequest(authorization?: string): http.IncomingMessage {
  return {
    headers: authorization !== undefined ? { authorization } : {},
  } as http.IncomingMessage;
}

describe("authenticateMcpRequest", () => {
  beforeEach(() => {
    clearRevocations();
  });

  /** Valid API key returns api-key auth context. */
  test("valid API key returns api-key context", () => {
    const req = mockRequest(`Bearer ${API_KEY}`);
    const result = authenticateMcpRequest(req, API_KEY);
    expect(result).toEqual({ type: "api-key" });
  });

  /** Valid scoped token returns scoped auth context with claims. */
  test("valid scoped token returns scoped context", () => {
    const token = createScopedToken(CLAIMS, API_KEY);
    const req = mockRequest(`Bearer ${token}`);
    const result = authenticateMcpRequest(req, API_KEY);
    expect(result).toEqual({
      type: "scoped",
      taskId: "task-1",
      projectId: "project-1",
      personaId: "persona-1",
      taskSessionId: "session-1",
    });
  });

  /** Missing Authorization header returns undefined. */
  test("missing authorization header returns undefined", () => {
    const req = mockRequest(undefined);
    const result = authenticateMcpRequest(req, API_KEY);
    expect(result).toBeUndefined();
  });

  /** Empty bearer token returns undefined. */
  test("empty bearer returns undefined", () => {
    const req = mockRequest("Bearer ");
    const result = authenticateMcpRequest(req, API_KEY);
    expect(result).toBeUndefined();
  });

  /** Wrong API key returns undefined. */
  test("wrong API key returns undefined", () => {
    const wrongKey = "b".repeat(64);
    const req = mockRequest(`Bearer ${wrongKey}`);
    const result = authenticateMcpRequest(req, API_KEY);
    expect(result).toBeUndefined();
  });

  /** Expired scoped token returns undefined. */
  test("expired scoped token returns undefined", () => {
    // Create token with minimal TTL so it expires immediately
    const token = createScopedToken(CLAIMS, API_KEY, 1);
    const req = mockRequest(`Bearer ${token}`);
    const result = authenticateMcpRequest(req, API_KEY);
    expect(result).toBeUndefined();
  });

  /** Revoked task returns undefined. */
  test("revoked task returns undefined", () => {
    const token = createScopedToken(CLAIMS, API_KEY);
    revokeTask("task-1");
    const req = mockRequest(`Bearer ${token}`);
    const result = authenticateMcpRequest(req, API_KEY);
    expect(result).toBeUndefined();
  });

  /** API key auth does not interfere with scoped token auth. */
  test("api key and scoped token work independently", () => {
    const apiKeyReq = mockRequest(`Bearer ${API_KEY}`);
    const token = createScopedToken(CLAIMS, API_KEY);
    const scopedReq = mockRequest(`Bearer ${token}`);

    const apiKeyResult = authenticateMcpRequest(apiKeyReq, API_KEY);
    const scopedResult = authenticateMcpRequest(scopedReq, API_KEY);

    expect(apiKeyResult).toEqual({ type: "api-key" });
    expect(scopedResult).toEqual({
      type: "scoped",
      taskId: "task-1",
      projectId: "project-1",
      personaId: "persona-1",
      taskSessionId: "session-1",
    });
  });

  /** Valid OAuth access token returns oauth context. */
  test("valid OAuth token returns oauth context", () => {
    const token = createOAuthAccessToken(OAUTH_CLIENT_ID, OAUTH_RESOURCE, API_KEY);
    const req = mockRequest(`Bearer ${token}`);
    const result = authenticateMcpRequest(req, API_KEY);
    expect(result).toEqual({ type: "oauth", clientId: OAUTH_CLIENT_ID });
  });

  /** Expired OAuth access token returns undefined. */
  test("expired OAuth token returns undefined", () => {
    const token = createOAuthAccessToken(OAUTH_CLIENT_ID, OAUTH_RESOURCE, API_KEY, 1);
    const req = mockRequest(`Bearer ${token}`);
    const result = authenticateMcpRequest(req, API_KEY);
    expect(result).toBeUndefined();
  });

  /** All three auth types work independently. */
  test("api key, scoped, and oauth tokens work independently", () => {
    const apiKeyReq = mockRequest(`Bearer ${API_KEY}`);
    const scopedToken = createScopedToken(CLAIMS, API_KEY);
    const scopedReq = mockRequest(`Bearer ${scopedToken}`);
    const oauthToken = createOAuthAccessToken(OAUTH_CLIENT_ID, OAUTH_RESOURCE, API_KEY);
    const oauthReq = mockRequest(`Bearer ${oauthToken}`);

    expect(authenticateMcpRequest(apiKeyReq, API_KEY)).toEqual({ type: "api-key" });
    expect(authenticateMcpRequest(scopedReq, API_KEY)).toEqual({
      type: "scoped",
      taskId: "task-1",
      projectId: "project-1",
      personaId: "persona-1",
      taskSessionId: "session-1",
    });
    expect(authenticateMcpRequest(oauthReq, API_KEY)).toEqual({
      type: "oauth",
      clientId: OAUTH_CLIENT_ID,
    });
  });
});
