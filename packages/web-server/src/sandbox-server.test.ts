import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createSandboxServer } from "./sandbox-server.js";

/** Make a GET request (with optional Host override) and return response details. */
function request(
  server: http.Server,
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
        res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("createSandboxServer", () => {
  let server: http.Server;

  beforeEach(async () => {
    server = createSandboxServer({ bindHost: "127.0.0.1", sandboxPort: 0 });
    await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
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
    const csp = encodeURIComponent(JSON.stringify({
      resourceDomains: ["http://127.0.0.1:7435"],
      connectDomains: ["http://127.0.0.1:7435"],
    }));
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
