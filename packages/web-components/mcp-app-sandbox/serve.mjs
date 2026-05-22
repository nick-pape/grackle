// Sidecar static server for the MCP Apps sandbox proxy.
//
// Serves sandbox.html from a DIFFERENT ORIGIN than the host (Storybook), with a
// per-request Content-Security-Policy set via HTTP header (built from the ?csp=
// query param) — tamper-proof, unlike a <meta> tag. The CSP governs the inner
// widget written into sandbox.html's inner iframe.
//
// Used in T1 (#1236) for Storybook; the production equivalent is the
// GRACKLE_SANDBOX_PORT server in #1238. CSP-building logic mirrors
// modelcontextprotocol/ext-apps examples/basic-host/serve.ts (commit 9a37ad7).

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const PORT = parseInt(process.env.MCP_SANDBOX_PORT ?? "6007", 10);
const HOST = process.env.MCP_SANDBOX_HOST ?? "127.0.0.1";
const HERE = dirname(fileURLToPath(import.meta.url));
const SANDBOX_FILE = join(HERE, "sandbox.html");
// The thin app-side widget module loaded by the inner iframe.
const SAMPLE_WIDGET_FILE = join(HERE, "sample-widget.js");
// The REAL @modelcontextprotocol/ext-apps App, pre-bundled with deps inlined,
// resolved from node_modules so it stays in sync with the installed version.
let APP_WITH_DEPS_FILE;
try {
  APP_WITH_DEPS_FILE = require.resolve("@modelcontextprotocol/ext-apps/app-with-deps");
} catch {
  APP_WITH_DEPS_FILE = undefined;
}

// The externalized proxy relay (loaded by sandbox.html as `script-src 'self'`).
const SANDBOX_RELAY_FILE = join(HERE, "sandbox-relay.js");

// Static JS files served (as ES modules). The relay runs in the proxy page; the
// widget modules run in the inner sandboxed iframe (both as same-origin 'self').
const JS_ROUTES = {
  "/sandbox-relay.js": () => SANDBOX_RELAY_FILE,
  "/sample-widget.js": () => SAMPLE_WIDGET_FILE,
  "/app-with-deps.js": () => APP_WITH_DEPS_FILE,
};

/** Reject CSP domain entries with characters that could break out of a directive. */
function sanitizeCspDomains(domains) {
  if (!Array.isArray(domains)) return [];
  return domains.filter((d) => typeof d === "string" && !/[;\r\n'" ]/.test(d));
}

/** Build the Content-Security-Policy header value from an optional McpUiResourceCsp. */
function buildCspHeader(csp) {
  const resourceDomains = sanitizeCspDomains(csp?.resourceDomains).join(" ");
  const connectDomains = sanitizeCspDomains(csp?.connectDomains).join(" ");
  const frameDomains = sanitizeCspDomains(csp?.frameDomains).join(" ");
  const baseUriDomains = sanitizeCspDomains(csp?.baseUriDomains).join(" ");
  return [
    "default-src 'self'",
    // Scripts: only same-origin (the relay + widget modules are served from this
    // origin) plus blob: for widgets that spawn workers. No 'unsafe-inline' (the
    // relay is an external module), no 'unsafe-eval' (the ext-apps App runs zod in
    // jitless mode), no data: scripts.
    `script-src 'self' blob: ${resourceDomains}`.trim(),
    // Styles still allow 'unsafe-inline' — widgets routinely use <style> blocks
    // and inline style attributes, which is far lower-risk than inline scripts.
    `style-src 'self' 'unsafe-inline' blob: data: ${resourceDomains}`.trim(),
    `img-src 'self' data: blob: ${resourceDomains}`.trim(),
    `font-src 'self' data: blob: ${resourceDomains}`.trim(),
    `media-src 'self' data: blob: ${resourceDomains}`.trim(),
    `connect-src 'self' ${connectDomains}`.trim(),
    `worker-src 'self' blob: ${resourceDomains}`.trim(),
    frameDomains ? `frame-src ${frameDomains}` : "frame-src 'none'",
    "object-src 'none'",
    baseUriDomains ? `base-uri ${baseUriDomains}` : "base-uri 'none'",
  ].join("; ");
}

const server = createServer((req, res) => {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? HOST}`);
  const path = requestUrl.pathname;

  // Serve the app-side JS modules (the bundled App + the sample widget) that the
  // inner widget loads. `script-src 'self'` permits these because the inner
  // iframe shares the sandbox origin (allow-same-origin).
  const jsResolver = JS_ROUTES[path];
  if (jsResolver) {
    const file = jsResolver();
    let js;
    try {
      js = file ? readFileSync(file, "utf-8") : undefined;
    } catch {
      js = undefined;
    }
    if (!js) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end(`Not found: ${path}`);
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(js);
    return;
  }

  if (path !== "/" && path !== "/sandbox.html") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Only sandbox.html and the widget JS modules are served on this port.");
    return;
  }

  let csp;
  const cspParam = requestUrl.searchParams.get("csp");
  if (cspParam) {
    try {
      csp = JSON.parse(cspParam);
    } catch {
      // Ignore an unparseable csp param and fall back to the locked-down default.
    }
  }

  let html;
  try {
    html = readFileSync(SANDBOX_FILE, "utf-8");
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("sandbox.html not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": buildCspHeader(csp),
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(html);
});

server.listen(PORT, HOST, () => {
  console.log(`[mcp-sandbox] serving sandbox.html at http://${HOST}:${PORT}/sandbox.html`);
});
