import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import http2 from "node:http2";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo, Server } from "node:net";
import { createSandboxServer } from "./sandbox-server.js";

/** Make a GET request (with optional Host override) and return response details. */
function request(
  server: Server,
  path: string,
  hostHeader?: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const headers: Record<string, string> = {};
    if (hostHeader !== undefined) {
      headers.Host = hostHeader;
    }
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("createSandboxServer", () => {
  let server: Server;

  beforeEach(async () => {
    server = createSandboxServer({ bindHost: "127.0.0.1", sandboxPort: 0 });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("serves sandbox.html with a locked-down CSP header by default", async () => {
    const resp = await request(server, "/sandbox.html");
    expect(resp.status).toBe(200);
    expect(resp.headers["content-type"]).toContain("text/html");
    const csp = resp.headers["content-security-policy"] as string;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' blob:");
    expect(csp).not.toContain("unsafe-eval");
    expect(resp.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("serves the same content at the root path", async () => {
    const resp = await request(server, "/");
    expect(resp.status).toBe(200);
    expect(resp.headers["content-type"]).toContain("text/html");
    expect(resp.headers["content-security-policy"]).toBeDefined();
  });

  it("widens the CSP from a ?csp= param of http(s) origins", async () => {
    const csp = encodeURIComponent(
      JSON.stringify({
        resourceDomains: ["http://127.0.0.1:7435"],
        connectDomains: ["http://127.0.0.1:7435"],
      }),
    );
    const resp = await request(server, `/sandbox.html?csp=${csp}`);
    expect(resp.status).toBe(200);
    const header = resp.headers["content-security-policy"] as string;
    expect(header).toContain("script-src 'self' blob: http://127.0.0.1:7435");
    expect(header).toContain("connect-src 'self' http://127.0.0.1:7435");
  });

  it("ignores an unparseable ?csp= param and falls back to the locked-down default", async () => {
    const resp = await request(server, "/sandbox.html?csp=not-json");
    expect(resp.status).toBe(200);
    expect(resp.headers["content-security-policy"]).toContain("script-src 'self' blob:");
  });

  it("serves sandbox-relay.js as javascript", async () => {
    const resp = await request(server, "/sandbox-relay.js");
    expect(resp.status).toBe(200);
    expect(resp.headers["content-type"]).toContain("javascript");
    expect(resp.headers["x-content-type-options"]).toBe("nosniff");
    expect(resp.body.length).toBeGreaterThan(0);
  });

  it("returns 404 for unknown paths", async () => {
    const resp = await request(server, "/secrets");
    expect(resp.status).toBe(404);
  });

  it("returns 400 (not a crash) for a malformed Host header", async () => {
    // A malformed Host makes `new URL` throw; the server must answer 400, not die.
    const resp = await request(server, "/sandbox.html", "]");
    expect(resp.status).toBe(400);
    // Server is still alive for the next request.
    const ok = await request(server, "/sandbox.html");
    expect(ok.status).toBe(200);
  });
});

describe("createSandboxServer secureContext (#1373)", () => {
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

  it("returns an Http2SecureServer when secureContext is provided", () => {
    const fx = loadFixture();
    if (!fx) {
      return;
    }
    server = createSandboxServer({
      bindHost: "127.0.0.1",
      sandboxPort: 0,
      secureContext: fx,
    });
    expect(server.constructor.name).toBe("Http2SecureServer");
  });

  it("serves sandbox.html over h2 TLS", async () => {
    const fx = loadFixture();
    if (!fx) {
      return;
    }
    server = createSandboxServer({
      bindHost: "127.0.0.1",
      sandboxPort: 0,
      secureContext: fx,
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    const session = http2.connect(`https://127.0.0.1:${port}`, {
      ca: fx.cert,
      checkServerIdentity: () => undefined,
    });
    try {
      const status: number = await new Promise((resolve, reject) => {
        const req = session.request({ ":path": "/sandbox.html" });
        let captured: number | undefined;
        req.on("response", (headers) => {
          captured = Number(headers[":status"]);
        });
        // Consume the body so the h2 stream half-closes cleanly; otherwise
        // session.close() in the finally block stalls waiting for it.
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
});
