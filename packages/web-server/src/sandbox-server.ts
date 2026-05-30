import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildCspHeader, type SandboxCsp } from "./sandbox-csp.js";
import { buildServer, type GrackleServer, type SecureContext } from "./web-server.js";

const nodeRequire: NodeRequire = createRequire(import.meta.url);

/** Options for the MCP Apps sandbox server. */
export interface SandboxServerOptions {
  /** Bind host (e.g. "127.0.0.1" or "0.0.0.0"). */
  bindHost: string;
  /** Port the sandbox origin listens on (GRACKLE_SANDBOX_PORT). */
  sandboxPort: number;
  /**
   * Optional native-TLS material (#1373). When set, the sandbox listens via
   * `http2.createSecureServer({ allowHTTP1: true })` instead of plain http.
   *
   * If the web app is served over https (`GRACKLE_PUBLIC_URL=https://…` or
   * native TLS), the sandbox MUST also be https — browsers block mixed-content
   * iframes — so the same secure context is wired through to both servers.
   */
  secureContext?: SecureContext;
}

/** Read an asset shipped in @grackle-ai/web-components (path relative to its package root). */
function readWebComponentsAsset(subpath: string): string {
  const assetPath: string = nodeRequire.resolve(`@grackle-ai/web-components/${subpath}`);
  return readFileSync(assetPath, "utf-8");
}

/** Read a sandbox proxy asset (the static double-iframe relay) from web-components. */
function readSandboxAsset(subpath: string): string {
  return readWebComponentsAsset(`mcp-app-sandbox/${subpath}`);
}

// The React runtime bundle (#1268) is a BUILT artifact (vite), unlike the static
// sandbox proxy assets above. Read it lazily + cache so constructing the server
// never throws if web-components hasn't been built yet (e.g. isolated unit tests).
let cachedRuntimeBundle: string | undefined;
function readRuntimeBundle(): string {
  if (cachedRuntimeBundle === undefined) {
    cachedRuntimeBundle = readWebComponentsAsset("mcp-app-runtime/runtime.js");
  }
  return cachedRuntimeBundle;
}

const JS_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/javascript; charset=utf-8",
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "Access-Control-Allow-Origin": "*",
  // This origin serves executable JS + security-sensitive HTML; prevent MIME sniffing.
  "X-Content-Type-Options": "nosniff",
};

/**
 * Create the MCP Apps widget sandbox server — a SEPARATE origin (different port
 * than the web app) that serves the double-iframe proxy (`sandbox.html` +
 * `sandbox-relay.js`) with a per-`?csp=` HTTP-header CSP. This is where the
 * untrusted widget is rendered; being a distinct origin keeps `window.top`
 * unreachable per the MCP Apps spec (SEP-1865). Assets are the canonical copies
 * from `@grackle-ai/web-components` (no drift on the security-critical relay).
 */
export function createSandboxServer(options: SandboxServerOptions): GrackleServer {
  const sandboxHtml: string = readSandboxAsset("sandbox.html");
  const sandboxRelay: string = readSandboxAsset("sandbox-relay.js");

  return buildServer((req, res) => {
    // A malformed request target or Host header makes `new URL` throw; never let
    // that crash the server process — answer 400 and move on.
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${req.headers.host ?? options.bindHost}`);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad request");
      return;
    }
    const path: string = url.pathname;
    const isGet: boolean = req.method?.toUpperCase() === "GET";

    if (isGet && path === "/sandbox-relay.js") {
      res.writeHead(200, JS_HEADERS);
      res.end(sandboxRelay);
      return;
    }

    // The Grackle React runtime bundle (#1268), loaded as `script-src 'self'` by
    // the inner widget bootstrap for `grackle-react` renders.
    if (isGet && path === "/runtime.js") {
      try {
        const runtime: string = readRuntimeBundle();
        res.writeHead(200, JS_HEADERS);
        res.end(runtime);
      } catch {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Runtime bundle not built.");
      }
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
        "X-Content-Type-Options": "nosniff",
      });
      res.end(sandboxHtml);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Only sandbox.html, sandbox-relay.js and runtime.js are served on this port.");
  }, options.secureContext);
}
