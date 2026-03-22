/**
 * Tests for security headers (GHSA-3mjm-x6gw-2x42).
 *
 * Verifies that setSecurityHeaders sets Content-Security-Policy,
 * X-Frame-Options, and X-Content-Type-Options on every response.
 */
import { describe, it, expect } from "vitest";
import http from "node:http";
import { setSecurityHeaders, WEB_CONTENT_SECURITY_POLICY } from "./security-headers.js";

/**
 * Make an HTTP request and return response details.
 * Does NOT follow redirects — returns the redirect response itself.
 */
function request(
  server: http.Server,
  path: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      { hostname: "127.0.0.1", port: addr.port, path },
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

describe("security headers", () => {
  describe("setSecurityHeaders", () => {
    it("sets all three headers on a 200 HTML response", async () => {
      const server = http.createServer((req, res) => {
        setSecurityHeaders(res);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html></html>");
      });

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });

      try {
        const resp = await request(server, "/");
        expect(resp.headers["content-security-policy"]).toBe(WEB_CONTENT_SECURITY_POLICY);
        expect(resp.headers["x-frame-options"]).toBe("DENY");
        expect(resp.headers["x-content-type-options"]).toBe("nosniff");
      } finally {
        await new Promise<void>((resolve) => { server.close(() => resolve()); });
      }
    });

    it("sets headers on a JSON response", async () => {
      const server = http.createServer((req, res) => {
        setSecurityHeaders(res);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });

      try {
        const resp = await request(server, "/.well-known/oauth-authorization-server");
        expect(resp.headers["content-security-policy"]).toBe(WEB_CONTENT_SECURITY_POLICY);
        expect(resp.headers["x-frame-options"]).toBe("DENY");
        expect(resp.headers["x-content-type-options"]).toBe("nosniff");
      } finally {
        await new Promise<void>((resolve) => { server.close(() => resolve()); });
      }
    });

    it("sets headers on a 302 redirect", async () => {
      const server = http.createServer((req, res) => {
        setSecurityHeaders(res);
        res.writeHead(302, { Location: "/" });
        res.end();
      });

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });

      try {
        const resp = await request(server, "/pair?code=ABC123");
        expect(resp.status).toBe(302);
        expect(resp.headers["content-security-policy"]).toBe(WEB_CONTENT_SECURITY_POLICY);
        expect(resp.headers["x-frame-options"]).toBe("DENY");
        expect(resp.headers["x-content-type-options"]).toBe("nosniff");
      } finally {
        await new Promise<void>((resolve) => { server.close(() => resolve()); });
      }
    });

    it("sets headers on a static file response", async () => {
      const server = http.createServer((req, res) => {
        setSecurityHeaders(res);
        res.writeHead(200, { "Content-Type": "image/x-icon" });
        res.end(Buffer.from([0x00]));
      });

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });

      try {
        const resp = await request(server, "/favicon.ico");
        expect(resp.headers["x-content-type-options"]).toBe("nosniff");
        expect(resp.headers["x-frame-options"]).toBe("DENY");
        expect(resp.headers["content-security-policy"]).toBe(WEB_CONTENT_SECURITY_POLICY);
      } finally {
        await new Promise<void>((resolve) => { server.close(() => resolve()); });
      }
    });
  });

  describe("WEB_CONTENT_SECURITY_POLICY", () => {
    it("includes all required directives", () => {
      expect(WEB_CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
      expect(WEB_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
      expect(WEB_CONTENT_SECURITY_POLICY).toContain("style-src 'self' 'unsafe-inline'");
      expect(WEB_CONTENT_SECURITY_POLICY).toContain("img-src 'self' data:");
      expect(WEB_CONTENT_SECURITY_POLICY).toContain("font-src 'self'");
      expect(WEB_CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
      expect(WEB_CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
      expect(WEB_CONTENT_SECURITY_POLICY).toContain("form-action 'self'");
      expect(WEB_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
      expect(WEB_CONTENT_SECURITY_POLICY).toContain("base-uri 'self'");
    });

    it("does not allow unsafe-inline for scripts", () => {
      // script-src should NOT include unsafe-inline
      const scriptDirective = WEB_CONTENT_SECURITY_POLICY
        .split(";")
        .map((d) => d.trim())
        .find((d) => d.startsWith("script-src"));
      expect(scriptDirective).toBe("script-src 'self'");
    });
  });
});
