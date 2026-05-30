import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";

// Mock @grackle-ai/auth — stub the stateful auth functions, but keep the real
// pure `parsePublicOrigin` validator so publicUrl validation behaves correctly.
vi.mock("@grackle-ai/auth", async (importActual) => {
  const actual = await importActual<typeof import("@grackle-ai/auth")>();
  return {
    setSecurityHeaders: vi.fn(),
    validateSessionCookie: vi.fn(() => false),
    verifyApiKey: vi.fn(() => false),
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
    parsePublicOrigin: actual.parsePublicOrigin,
  };
});

import { createWebServer, isWildcardAddress } from "./web-server.js";
import {
  validateSessionCookie,
  redeemPairingCode,
  createSession,
  setSecurityHeaders,
} from "@grackle-ai/auth";

/** Make an HTTP request to the test server. */
function request(
  server: http.Server,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request({ hostname: "127.0.0.1", port: addr.port, path, headers }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** POST a raw body to the test server. */
function postBody(
  server: http.Server,
  path: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
      },
      (res) => {
        let b = "";
        res.on("data", (chunk: Buffer) => {
          b += chunk.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode!, body: b }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("createWebServer", () => {
  let server: http.Server;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns an http.Server", () => {
    expect(server).toBeInstanceOf(http.Server);
  });

  it("returns 200 with status ok at /healthz", async () => {
    const res = await request(server, "/healthz");

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ok" });
  });

  it("returns 413 for an oversized request body (not a connection reset)", async () => {
    const oversized = JSON.stringify({ client_name: "x".repeat(20_000) });
    const res = await postBody(server, "/register", oversized);
    expect(res.status).toBe(413);
  });

  it("reads a normal-size body (small POST reaches the route)", async () => {
    // A small but invalid body proves readBody resolved and the route ran
    // (redirect_uris missing -> 400 invalid_request, not a body-size failure).
    const res = await postBody(server, "/register", JSON.stringify({}));
    expect(res.status).toBe(400);
  });

  it("returns 200 with default readiness at /readyz when no check provided", async () => {
    const res = await request(server, "/readyz");

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ready).toBe(true);
    expect(body.checks).toEqual({});
  });

  it("shows pairing page at /pair when no code provided", async () => {
    const res = await request(server, "/pair");

    expect(res.status).toBe(200);
    expect(res.body).toContain("Pair Device");
    expect(res.body).toContain("ABC123");
  });

  it("redirects to /pair when unauthenticated", async () => {
    const res = await request(server, "/");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/pair");
  });

  it("serves OAuth metadata at /.well-known/oauth-authorization-server", async () => {
    const res = await request(server, "/.well-known/oauth-authorization-server");

    expect(res.status).toBe(200);
    const metadata = JSON.parse(res.body);
    expect(metadata.authorization_endpoint).toContain("/authorize");
    expect(metadata.token_endpoint).toContain("/token");
  });

  it("derives OAuth metadata URLs from request Host header", async () => {
    const addr = server.address() as { port: number };
    const res = await request(server, "/.well-known/oauth-authorization-server", {
      Host: `localhost:${addr.port}`,
    });

    expect(res.status).toBe(200);
    const metadata = JSON.parse(res.body);
    expect(metadata.issuer).toBe(`http://localhost:${addr.port}`);
    expect(metadata.authorization_endpoint).toBe(`http://localhost:${addr.port}/authorize`);
    expect(metadata.token_endpoint).toBe(`http://localhost:${addr.port}/token`);
  });

  it("redeems a valid pairing code and sets session cookie", async () => {
    vi.mocked(redeemPairingCode).mockReturnValueOnce(true);
    vi.mocked(createSession).mockReturnValueOnce("grackle_session=test123; HttpOnly");

    const res = await request(server, "/pair?code=ABC123");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("creates a non-Secure cookie on a loopback bind (no publicUrl)", async () => {
    vi.mocked(redeemPairingCode).mockReturnValueOnce(true);

    await request(server, "/pair?code=ABC123");

    expect(createSession).toHaveBeenCalledWith(expect.any(String), { secure: false });
  });

  it("does not request HSTS on a loopback bind (no publicUrl)", async () => {
    await request(server, "/healthz");

    expect(setSecurityHeaders).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      hsts: false,
    });
  });
});

describe("createWebServer behind a public https origin", () => {
  let server: http.Server;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
      publicUrl: "https://grackle.home",
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("advertises https OAuth metadata endpoints from the public origin", async () => {
    const res = await request(server, "/.well-known/oauth-authorization-server");

    expect(res.status).toBe(200);
    const metadata = JSON.parse(res.body);
    expect(metadata.issuer).toBe("https://grackle.home");
    expect(metadata.authorization_endpoint).toBe("https://grackle.home/authorize");
    expect(metadata.token_endpoint).toBe("https://grackle.home/token");
    expect(metadata.registration_endpoint).toBe("https://grackle.home/register");
  });

  it("ignores the request Host header for OAuth metadata when publicUrl is set", async () => {
    const res = await request(server, "/.well-known/oauth-authorization-server", {
      Host: "attacker.example.com",
    });

    const metadata = JSON.parse(res.body);
    expect(metadata.issuer).toBe("https://grackle.home");
  });

  it("creates a Secure cookie", async () => {
    vi.mocked(redeemPairingCode).mockReturnValueOnce(true);

    await request(server, "/pair?code=ABC123");

    expect(createSession).toHaveBeenCalledWith(expect.any(String), { secure: true });
  });

  it("requests HSTS", async () => {
    await request(server, "/healthz");

    expect(setSecurityHeaders).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      hsts: true,
    });
  });

  it("derives CSP from the configured public host, not the request Host", async () => {
    await request(server, "/healthz", { Host: "attacker.example.com" });

    expect(setSecurityHeaders).toHaveBeenCalledWith(expect.anything(), "grackle.home", {
      hsts: true,
    });
  });
});

describe("createWebServer sandbox origin in CSP", () => {
  let server: http.Server;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
      publicUrl: "https://web.grackle.test",
      sandboxOrigin: "https://sandbox.grackle.test:8445",
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("passes the sandbox origin to setSecurityHeaders so frame-src allows the widget iframe", async () => {
    await request(server, "/healthz");

    expect(setSecurityHeaders).toHaveBeenCalledWith(expect.anything(), "web.grackle.test", {
      hsts: true,
      sandboxOrigin: "https://sandbox.grackle.test:8445",
    });
  });
});

describe("createWebServer publicUrl validation", () => {
  it("throws a clear error when publicUrl is not a bare origin", () => {
    expect(() =>
      createWebServer({
        apiKey: "x".repeat(64),
        webPort: 0,
        bindHost: "127.0.0.1",
        publicUrl: "https://grackle.home/some/path",
      }),
    ).toThrow("publicUrl");
  });

  it("throws when publicUrl is not a valid URL", () => {
    expect(() =>
      createWebServer({
        apiKey: "x".repeat(64),
        webPort: 0,
        bindHost: "127.0.0.1",
        publicUrl: "not-a-url",
      }),
    ).toThrow("Invalid publicUrl");
  });
});

describe("createWebServer behind a public http origin", () => {
  let server: http.Server;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "0.0.0.0",
      publicUrl: "http://grackle.home:8080",
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("advertises http OAuth metadata endpoints from the public origin", async () => {
    const res = await request(server, "/.well-known/oauth-authorization-server");

    const metadata = JSON.parse(res.body);
    expect(metadata.issuer).toBe("http://grackle.home:8080");
  });

  it("creates a non-Secure cookie and does not request HSTS for an http public origin", async () => {
    vi.mocked(redeemPairingCode).mockReturnValueOnce(true);

    await request(server, "/pair?code=ABC123");

    expect(createSession).toHaveBeenCalledWith(expect.any(String), { secure: false });
    expect(setSecurityHeaders).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      hsts: false,
    });
  });
});

describe("createWebServer readiness check", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (!server) {
      return;
    }
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  it("returns 200 when readiness check passes", async () => {
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
      readinessCheck: () => ({
        ready: true,
        checks: { database: { ok: true } },
      }),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const res = await request(server, "/readyz");

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ready).toBe(true);
    expect(body.checks.database.ok).toBe(true);
  });

  it("returns 503 when readiness check throws and server stays up", async () => {
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
      readinessCheck: () => {
        throw new Error("readiness check exploded");
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const first = await request(server, "/readyz");
    expect(first.status).toBe(503);
    const body = JSON.parse(first.body);
    expect(body.ready).toBe(false);
    expect(body.checks.readinessCheck.ok).toBe(false);

    // Server is still alive after the throw
    const second = await request(server, "/healthz");
    expect(second.status).toBe(200);
  });

  it("returns 503 when readiness check fails", async () => {
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
      readinessCheck: () => ({
        ready: false,
        checks: { database: { ok: false, message: "connection lost" } },
      }),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const res = await request(server, "/readyz");

    expect(res.status).toBe(503);
    const body = JSON.parse(res.body);
    expect(body.ready).toBe(false);
    expect(body.checks.database.message).toBe("connection lost");
  });
});

describe("createWebServer /api/manifest", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (!server) {
      return;
    }
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  it("returns empty plugin list when no pluginNames provided", async () => {
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const res = await request(server, "/api/manifest");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(res.body)).toEqual({ plugins: [] });
  });

  it("returns plugin list with provided pluginNames", async () => {
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
      pluginNames: ["core", "orchestration"],
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const res = await request(server, "/api/manifest");

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      plugins: [{ name: "core" }, { name: "orchestration" }],
    });
  });

  it("is accessible without auth (no session cookie or bearer token)", async () => {
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
      pluginNames: ["core"],
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    // No auth headers — should still get 200
    const res = await request(server, "/api/manifest", {});

    expect(res.status).toBe(200);
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
