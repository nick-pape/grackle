import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import http2 from "node:http2";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:net";

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
  server: Server,
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
  server: Server,
  path: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
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
        res.on("end", () => resolve({ status: res.statusCode!, body: b, headers: res.headers }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("createWebServer", () => {
  let server: Server;

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
  let server: Server | undefined;

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
  let server: Server | undefined;

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

describe("createWebServer h1 413 (#1373 regression guard)", () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  });

  it("sets Connection: close on the h1 413 path so the half-read socket tears down", async () => {
    server = createWebServer({ apiKey: "x".repeat(64), webPort: 0, bindHost: "127.0.0.1" });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const oversized = JSON.stringify({ client_name: "x".repeat(20_000) });
    const res = await postBody(server, "/register", oversized);
    expect(res.status).toBe(413);
    expect(res.headers.connection).toBe("close");
  });
});

describe("getRequestHost (h1/h2 host extraction, #1373)", () => {
  /** Minimal fake req — only fields the helper reads. */
  function fakeReq(headers: Record<string, string | string[] | undefined>): {
    headers: Record<string, string | string[] | undefined>;
  } {
    return { headers };
  }

  it("returns Host for HTTP/1.x requests", async () => {
    const { getRequestHost } = await import("./web-server.js");
    expect(getRequestHost(fakeReq({ host: "example.com:443" }) as never)).toBe("example.com:443");
  });

  it("prefers :authority (HTTP/2) over Host when both are set", async () => {
    const { getRequestHost } = await import("./web-server.js");
    expect(
      getRequestHost(
        fakeReq({ ":authority": "grackle.example:443", host: "grackle.example:443" }) as never,
      ),
    ).toBe("grackle.example:443");
  });

  it("returns :authority when Host is absent (typical h2)", async () => {
    const { getRequestHost } = await import("./web-server.js");
    expect(getRequestHost(fakeReq({ ":authority": "grackle.example:8443" }) as never)).toBe(
      "grackle.example:8443",
    );
  });

  it("returns undefined when neither is present", async () => {
    const { getRequestHost } = await import("./web-server.js");
    expect(getRequestHost(fakeReq({}) as never)).toBeUndefined();
  });

  // P5.4 hardening — exotic header shapes shouldn't crash callers. The helper
  // is a flat string accessor; downstream URL construction is where validation
  // happens (URL constructor + form-action CSP that wraps with try/catch).
  it("returns empty string when :authority is empty (falls through to Host)", async () => {
    const { getRequestHost } = await import("./web-server.js");
    expect(getRequestHost(fakeReq({ ":authority": "", host: "fallback.example" }) as never)).toBe(
      "fallback.example",
    );
  });

  it("returns the first element when :authority is unexpectedly an array (HPACK quirk)", async () => {
    const { getRequestHost } = await import("./web-server.js");
    expect(
      getRequestHost(fakeReq({ ":authority": ["first.example:443", "ignored"] }) as never),
    ).toBe("first.example:443");
  });

  it("returns the bracketed IPv6 authority verbatim (callers handle parsing)", async () => {
    const { getRequestHost } = await import("./web-server.js");
    expect(getRequestHost(fakeReq({ ":authority": "[::1]:8443" }) as never)).toBe("[::1]:8443");
  });

  it("returns an authority containing multiple colons verbatim", async () => {
    // Malformed but non-fatal: downstream URL parsing will reject. The helper
    // intentionally doesn't validate — it's a flat accessor.
    const { getRequestHost } = await import("./web-server.js");
    expect(getRequestHost(fakeReq({ ":authority": "host:80:extra" }) as never)).toBe(
      "host:80:extra",
    );
  });
});

describe("createWebServer cert/key mismatch (#1373 — P5.3)", () => {
  const FIXTURE_DIR: string = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

  it("fails fast at construct time when cert and key are from different keypairs", () => {
    // tls-test-ca.pem is a different cert (different keypair) than
    // tls-test-key.pem — using them together should make Node's TLS context
    // builder throw ERR_OSSL_X509_KEY_VALUES_MISMATCH at createSecureServer
    // time, not silently fail at first handshake.
    let cert: Buffer;
    let key: Buffer;
    try {
      cert = readFileSync(join(FIXTURE_DIR, "tls-test-ca.pem"));
      key = readFileSync(join(FIXTURE_DIR, "tls-test-key.pem"));
    } catch {
      return; // fixture missing — skip
    }

    expect(() =>
      createWebServer({
        apiKey: "x".repeat(64),
        webPort: 0,
        bindHost: "127.0.0.1",
        secureContext: { cert, key },
      }),
    ).toThrow(/KEY_VALUES_MISMATCH|key values mismatch|PEM/);
  });
});

describe("createWebServer public scheme — secureContext + publicUrl (#1373)", () => {
  let server: Server | undefined;
  const FIXTURE_DIR: string = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
  function loadFixture(): { cert: Buffer; key: Buffer } | undefined {
    try {
      return {
        cert: readFileSync(join(FIXTURE_DIR, "tls-test-cert.pem")),
        key: readFileSync(join(FIXTURE_DIR, "tls-test-key.pem")),
      };
    } catch {
      return undefined;
    }
  }
  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  it("emits issuer from publicUrl in OAuth metadata (proxy mode)", async () => {
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
      publicUrl: "https://grackle.example:8443",
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const res = await request(server, "/.well-known/oauth-authorization-server", {
      Host: `grackle.example:8443`,
    });
    expect(res.status).toBe(200);
    const meta = JSON.parse(res.body);
    expect(meta.issuer).toBe(`https://grackle.example:8443`);
    expect(meta.authorization_endpoint).toBe(`https://grackle.example:8443/authorize`);
    expect(meta.token_endpoint).toBe(`https://grackle.example:8443/token`);
    expect(meta.registration_endpoint).toBe(`https://grackle.example:8443/register`);
  });

  it("passes secure=true to createSession when publicUrl is https", async () => {
    vi.mocked(redeemPairingCode).mockReturnValue(true);
    vi.mocked(createSession).mockClear();
    vi.mocked(createSession).mockReturnValue("grackle_session=test; HttpOnly; Secure");

    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
      publicUrl: "https://grackle.example",
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    await request(server, "/pair?code=ABC123");

    expect(createSession).toHaveBeenCalledWith(expect.any(String), { secure: true });
  });

  it("passes secure=false to createSession when neither publicUrl nor secureContext is set (default)", async () => {
    vi.mocked(redeemPairingCode).mockReturnValue(true);
    vi.mocked(createSession).mockClear();
    vi.mocked(createSession).mockReturnValue("grackle_session=test; HttpOnly");

    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "0.0.0.0",
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    await request(server, "/pair?code=ABC123");

    // 0.0.0.0 bind → allowNetwork=true → cookieSecure=true (existing #1371
    // semantic: wildcard-bind heuristic). The native-TLS path is asserted
    // by the explicit secureContext test above.
    expect(createSession).toHaveBeenCalledWith(expect.any(String), { secure: true });
  });
});

describe("createWebServer secureContext (#1373)", () => {
  let server: Server | undefined;
  const FIXTURE_DIR: string = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

  function loadFixture(): { cert: Buffer; key: Buffer } | undefined {
    try {
      return {
        cert: readFileSync(join(FIXTURE_DIR, "tls-test-cert.pem")),
        key: readFileSync(join(FIXTURE_DIR, "tls-test-key.pem")),
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Hard close — `Http2SecureServer#close` waits for open sessions to finish.
   * Fast-path the teardown so afterEach doesn't time out if a session lingered.
   */
  async function hardClose(s: Server): Promise<void> {
    const maybeH2 = s as { closeAllConnections?: () => void };
    maybeH2.closeAllConnections?.();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  afterEach(async () => {
    if (server) {
      await hardClose(server);
      server = undefined;
    }
  });

  it("returns an Http2SecureServer when secureContext is provided", async () => {
    const fx = loadFixture();
    if (!fx) {
      return;
    }
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
      secureContext: fx,
    });
    // `Http2SecureServer` isn't exposed as a runtime constructor on the `http2`
    // namespace (Node only exports factory functions like `createSecureServer`),
    // so we have to identify the class by its runtime name.
    expect(server.constructor.name).toBe("Http2SecureServer");
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  });

  it("serves /healthz over h2 TLS", async () => {
    const fx = loadFixture();
    if (!fx) {
      return;
    }
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
      secureContext: fx,
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    const session = http2.connect(`https://127.0.0.1:${addr.port}`, {
      ca: fx.cert,
      // Self-signed CN=localhost — dial by IP, skip hostname matching.
      checkServerIdentity: () => undefined,
    });
    try {
      const status: number = await new Promise((resolve, reject) => {
        const req = session.request({ ":path": "/healthz" });
        let captured: number | undefined;
        req.on("response", (headers) => {
          captured = Number(headers[":status"]);
        });
        // Must consume the response body — leaving it unread keeps the h2
        // stream half-open and stalls session.close() in the finally block.
        req.on("data", () => {});
        req.on("end", () => resolve(captured ?? 0));
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => session.close(() => resolve()));
    }
  });

  it("returns 413 on an oversized h2 POST without sending a forbidden Connection header", async () => {
    const fx = loadFixture();
    if (!fx) {
      return;
    }
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
      secureContext: fx,
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    const session = http2.connect(`https://127.0.0.1:${addr.port}`, {
      ca: fx.cert,
      checkServerIdentity: () => undefined,
    });
    try {
      const oversized = JSON.stringify({ client_name: "x".repeat(20_000) });
      const result: { status: number; hasConnectionHeader: boolean } = await new Promise(
        (resolve, reject) => {
          const req = session.request({
            ":method": "POST",
            ":path": "/register",
            "content-type": "application/json",
          });
          let responded = false;
          req.on("response", (headers) => {
            responded = true;
            resolve({
              status: Number(headers[":status"]),
              hasConnectionHeader: "connection" in headers,
            });
          });
          req.on("error", (err) => {
            if (!responded) {
              reject(err);
            }
          });
          req.end(oversized);
        },
      );
      expect(result.status).toBe(413);
      // h2 must NOT carry a Connection header — sending one would have crashed
      // the response with ERR_HTTP2_INVALID_CONNECTION_HEADERS.
      expect(result.hasConnectionHeader).toBe(false);
    } finally {
      await new Promise<void>((resolve) => session.close(() => resolve()));
    }
  });
});

/**
 * Phase 3+5 integration coverage: tests that exercise the full TLS server with
 * a real h2 client, so the behavior we care about (response headers, status,
 * session survival) is observed on the wire — not just inferred from the
 * factory's pure outputs.
 */
describe("createWebServer h2 wire-level (Phase 3 + 5)", () => {
  let server: Server | undefined;
  const FIXTURE_DIR: string = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
  function loadFx(): { cert: Buffer; key: Buffer } | undefined {
    try {
      return {
        cert: readFileSync(join(FIXTURE_DIR, "tls-test-cert.pem")),
        key: readFileSync(join(FIXTURE_DIR, "tls-test-key.pem")),
      };
    } catch {
      return undefined;
    }
  }
  async function hardClose(s: Server): Promise<void> {
    (s as { closeAllConnections?: () => void }).closeAllConnections?.();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
  afterEach(async () => {
    if (server) {
      await hardClose(server);
      server = undefined;
    }
  });

  /**
   * Drive an h2 request with explicit `:authority`, returning status + response
   * headers + body. The test client trusts the same cert it loaded so a
   * self-signed CN=localhost dev cert validates over IPv4 loopback.
   */
  async function h2Request(
    port: number,
    ca: Buffer,
    options: { path: string; method?: string; authority?: string; body?: string },
  ): Promise<{
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }> {
    const session = http2.connect(`https://127.0.0.1:${port}`, {
      ca,
      checkServerIdentity: () => undefined,
    });
    session.on("error", () => {
      /* ignore on teardown */
    });
    await new Promise<void>((resolve) => session.on("connect", resolve));
    try {
      return await new Promise((resolve, reject) => {
        const reqHeaders: Record<string, string> = {
          ":method": options.method ?? "GET",
          ":path": options.path,
        };
        if (options.authority) {
          reqHeaders[":authority"] = options.authority;
        }
        if (options.body) {
          reqHeaders["content-type"] = "application/json";
          reqHeaders["content-length"] = String(Buffer.byteLength(options.body));
        }
        const req = session.request(reqHeaders);
        let respHeaders: Record<string, string | string[] | undefined> = {};
        let body = "";
        req.on("response", (h) => {
          respHeaders = h;
        });
        req.on("data", (c) => (body += c.toString()));
        req.on("end", () =>
          resolve({ status: Number(respHeaders[":status"]), headers: respHeaders, body }),
        );
        req.on("error", reject);
        setTimeout(() => reject(new Error("h2Request timeout")), 5000);
        if (options.body) {
          req.end(options.body);
        } else {
          req.end();
        }
      });
    } finally {
      await new Promise<void>((resolve) => session.close(() => resolve()));
    }
  }

  it("P3.1 — OAuth metadata reflects :authority over h2 (not Host)", async () => {
    const fx = loadFx();
    if (!fx) {
      return;
    }
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
      secureContext: fx,
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const r = await h2Request(port, fx.cert, {
      path: "/.well-known/oauth-authorization-server",
      authority: "grackle.example:8443",
    });
    expect(r.status).toBe(200);
    const meta = JSON.parse(r.body);
    // requestHost picked from :authority, scheme from secureContext → https
    expect(meta.issuer).toBe("https://grackle.example:8443");
    expect(meta.authorization_endpoint).toBe("https://grackle.example:8443/authorize");
  });

  it("P5.1 — h2 response carries no forbidden connection-specific headers", async () => {
    const fx = loadFx();
    if (!fx) {
      return;
    }
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
      secureContext: fx,
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const r = await h2Request(port, fx.cert, { path: "/healthz" });
    expect(r.status).toBe(200);
    // RFC 9113 §8.2.2 — these are forbidden on h2 responses. Node strips them
    // on the compat layer, but any user code that calls res.setHeader("Connection",
    // ...) would re-introduce them. This is the regression guard.
    const forbidden = ["connection", "transfer-encoding", "keep-alive", "upgrade", "te"];
    for (const f of forbidden) {
      expect(r.headers[f], `forbidden h2 header "${f}" present`).toBeUndefined();
    }
  });

  it("P5.2 — h2-413 closes only the offending stream; session survives", async () => {
    const fx = loadFx();
    if (!fx) {
      return;
    }
    server = createWebServer({
      apiKey: "x".repeat(64),
      webPort: 0,
      bindHost: "127.0.0.1",
      secureContext: fx,
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const session = http2.connect(`https://127.0.0.1:${port}`, {
      ca: fx.cert,
      checkServerIdentity: () => undefined,
    });
    session.on("error", () => {});
    await new Promise<void>((resolve) => session.on("connect", resolve));
    try {
      // Stream 1: oversized POST → 413
      const overstatus = await new Promise<number>((resolve, reject) => {
        const r = session.request({
          ":method": "POST",
          ":path": "/register",
          "content-type": "application/json",
          "content-length": "20000",
        });
        let captured = 0;
        r.on("response", (h) => {
          captured = Number(h[":status"]);
        });
        r.on("data", () => {});
        r.on("end", () => resolve(captured));
        r.on("error", reject);
        setTimeout(() => reject(new Error("stream1 timeout")), 5000);
        r.end("x".repeat(20000));
      });
      expect(overstatus).toBe(413);

      // Stream 3 (h2 client streams are odd-numbered): another request on the
      // SAME session must still succeed — 413 must not have torn down the conn.
      const okstatus = await new Promise<number>((resolve, reject) => {
        const r = session.request({ ":path": "/healthz" });
        let captured = 0;
        r.on("response", (h) => {
          captured = Number(h[":status"]);
        });
        r.on("data", () => {});
        r.on("end", () => resolve(captured));
        r.on("error", reject);
        setTimeout(() => reject(new Error("stream2 timeout")), 5000);
        r.end();
      });
      expect(okstatus).toBe(200);
    } finally {
      await new Promise<void>((resolve) => session.close(() => resolve()));
    }
  });
});
