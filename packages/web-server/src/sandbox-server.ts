import http from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildCspHeader, type SandboxCsp } from "./sandbox-csp.js";

const nodeRequire: NodeRequire = createRequire(import.meta.url);

/** Options for the MCP Apps sandbox server. */
export interface SandboxServerOptions {
  /** Bind host (e.g. "127.0.0.1" or "0.0.0.0"). */
  bindHost: string;
  /** Port the sandbox origin listens on (GRACKLE_SANDBOX_PORT). */
  sandboxPort: number;
}

/** Read a sandbox asset from the canonical copy in @grackle-ai/web-components. */
function readSandboxAsset(subpath: string): string {
  const assetPath: string = nodeRequire.resolve(`@grackle-ai/web-components/mcp-app-sandbox/${subpath}`);
  return readFileSync(assetPath, "utf-8");
}

const JS_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/javascript; charset=utf-8",
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "Access-Control-Allow-Origin": "*",
};

/**
 * Create the MCP Apps widget sandbox server — a SEPARATE origin (different port
 * than the web app) that serves the double-iframe proxy (`sandbox.html` +
 * `sandbox-relay.js`) with a per-`?csp=` HTTP-header CSP. This is where the
 * untrusted widget is rendered; being a distinct origin keeps `window.top`
 * unreachable per the MCP Apps spec (SEP-1865). Assets are the canonical copies
 * from `@grackle-ai/web-components` (no drift on the security-critical relay).
 */
export function createSandboxServer(options: SandboxServerOptions): http.Server {
  const sandboxHtml: string = readSandboxAsset("sandbox.html");
  const sandboxRelay: string = readSandboxAsset("sandbox-relay.js");

  return http.createServer((req, res) => {
    const url: URL = new URL(req.url ?? "/", `http://${req.headers.host ?? options.bindHost}`);
    const path: string = url.pathname;
    const isGet: boolean = req.method?.toUpperCase() === "GET";

    if (isGet && path === "/sandbox-relay.js") {
      res.writeHead(200, JS_HEADERS);
      res.end(sandboxRelay);
      return;
    }

    if (isGet && (path === "/" || path === "/sandbox.html")) {
      let csp: SandboxCsp | undefined;
      const cspParam: string | null = url.searchParams.get("csp");
      if (cspParam) {
        try {
          csp = JSON.parse(cspParam) as SandboxCsp;
        } catch {
          // Ignore an unparseable csp param and fall back to the locked-down default.
        }
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": buildCspHeader(csp),
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(sandboxHtml);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Only sandbox.html and sandbox-relay.js are served on this port.");
  });
}
