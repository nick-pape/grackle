import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";

// Mock @grackle-ai/auth
vi.mock("@grackle-ai/auth", () => ({
  setSecurityHeaders: vi.fn(),
  validateSessionCookie: vi.fn(() => false),
  verifyApiKey: vi.fn(() => false),
  generatePairingCode: vi.fn(() => "ABC123"),
  redeemPairingCode: vi.fn(() => false),
  createSession: vi.fn(() => "grackle_session=test; HttpOnly"),
  registerClient: vi.fn(),
  getClient: vi.fn(),
  createAuthorizationCode: vi.fn(),
  consumeAuthorizationCode: vi.fn(),
  createRefreshToken: vi.fn(),
  consumeRefreshToken: vi.fn(),
  createOAuthAccessToken: vi.fn(),
  OAUTH_ACCESS_TOKEN_TTL_MS: 3600000,
}));

import { createWebServer, isWildcardAddress } from "./web-server.js";
import { validateSessionCookie, redeemPairingCode, createSession } from "@grackle-ai/auth";

/** Make an HTTP request to the test server. */
function request(
  server: http.Server,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      { hostname: "127.0.0.1", port: addr.port, path, headers },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("createWebServer", () => {
  let server: http.Server;

  beforeEach(() => {
    vi.clearAllMocks();
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns an http.Server", () => {
    expect(server).toBeInstanceOf(http.Server);
  });

  it("shows pairing page at /pair when no code provided", async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const res = await request(server, "/pair");

    expect(res.status).toBe(200);
    expect(res.body).toContain("Pair Device");
    expect(res.body).toContain("ABC123");
  });

  it("redirects to /pair when unauthenticated", async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const res = await request(server, "/");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/pair");
  });

  it("serves OAuth metadata at /.well-known/oauth-authorization-server", async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const res = await request(server, "/.well-known/oauth-authorization-server");

    expect(res.status).toBe(200);
    const metadata = JSON.parse(res.body);
    expect(metadata.authorization_endpoint).toContain("/authorize");
    expect(metadata.token_endpoint).toContain("/token");
  });

  it("redeems a valid pairing code and sets session cookie", async () => {
    vi.mocked(redeemPairingCode).mockReturnValueOnce(true);
    vi.mocked(createSession).mockReturnValueOnce("grackle_session=test123; HttpOnly");

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const res = await request(server, "/pair?code=ABC123");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
    expect(res.headers["set-cookie"]).toBeDefined();
  });
});

describe("isWildcardAddress", () => {
  it("returns true for 0.0.0.0", () => {
    expect(isWildcardAddress("0.0.0.0")).toBe(true);
  });

  it("returns true for ::", () => {
    expect(isWildcardAddress("::")).toBe(true);
  });

  it("returns false for 127.0.0.1", () => {
    expect(isWildcardAddress("127.0.0.1")).toBe(false);
  });
});
