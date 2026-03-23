import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import { SESSION_COOKIE_NAME, clearSessions, clearPairing, generatePairingCode } from "@grackle-ai/auth";

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

// Mock api-key so we don't need a real file
const MOCK_API_KEY = "x".repeat(64);
vi.mock("./api-key.js", () => ({
  loadOrCreateApiKey: () => MOCK_API_KEY,
  verifyApiKey: (token: string) => token === MOCK_API_KEY,
}));

/**
 * Make an HTTP request and return response details.
 * Does NOT follow redirects — returns the redirect response itself.
 */
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

describe("pairing flow integration", () => {
  let server: http.Server;

  beforeEach(async () => {
    clearSessions();
    clearPairing();

    // Dynamically import to get the createWebHandler after mocks are applied
    // We can't import index.ts (it calls main()), so we replicate the handler setup
    const { createSession, validateSessionCookie, redeemPairingCode } = await import("@grackle-ai/auth");

    server = http.createServer((req, res) => {
      const urlParts = (req.url || "/").split("?");
      const rawPath = decodeURIComponent(urlParts[0]);
      const queryString = urlParts[1] || "";

      if (rawPath === "/pair") {
        const params = new URLSearchParams(queryString);
        const code = params.get("code");
        if (code) {
          const remoteIp = req.socket.remoteAddress || "unknown";
          if (redeemPairingCode(code, remoteIp)) {
            const setCookie = createSession(MOCK_API_KEY);
            res.writeHead(302, { Location: "/", "Set-Cookie": setCookie });
            res.end();
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("Invalid code");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("Pairing page");
        return;
      }

      const cookieHeader = req.headers.cookie || "";
      if (!validateSessionCookie(cookieHeader, MOCK_API_KEY)) {
        res.writeHead(302, { Location: "/pair" });
        res.end();
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("Dashboard");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("redirects unauthenticated requests to /pair", async () => {
    const res = await request(server, "/");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/pair");
  });

  it("shows the pairing page at /pair", async () => {
    const res = await request(server, "/pair");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Pairing page");
  });

  it("rejects an invalid pairing code", async () => {
    const res = await request(server, "/pair?code=BADCOD");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Invalid code");
  });

  it("sets a session cookie for a valid pairing code", async () => {
    const code = generatePairingCode()!;
    const res = await request(server, `/pair?code=${code}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
    expect(res.headers["set-cookie"]).toBeDefined();

    const setCookie = Array.isArray(res.headers["set-cookie"])
      ? res.headers["set-cookie"][0]
      : res.headers["set-cookie"]!;
    expect(setCookie).toContain(SESSION_COOKIE_NAME);
    expect(setCookie).toContain("HttpOnly");
  });

  it("allows access with a valid session cookie", async () => {
    const code = generatePairingCode()!;
    const pairRes = await request(server, `/pair?code=${code}`);
    const setCookie = Array.isArray(pairRes.headers["set-cookie"])
      ? pairRes.headers["set-cookie"][0]
      : pairRes.headers["set-cookie"]!;

    // Extract just the cookie value for the Cookie header
    const cookieValue = setCookie.split(";")[0];

    const dashRes = await request(server, "/", { Cookie: cookieValue });
    expect(dashRes.status).toBe(200);
    expect(dashRes.body).toBe("Dashboard");
  });

  it("burns the code after single use", async () => {
    const code = generatePairingCode()!;
    const first = await request(server, `/pair?code=${code}`);
    expect(first.status).toBe(302);

    const second = await request(server, `/pair?code=${code}`);
    expect(second.status).toBe(200);
    expect(second.body).toContain("Invalid code");
  });
});
