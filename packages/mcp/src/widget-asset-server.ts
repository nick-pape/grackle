import type http from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { WIDGET_ASSET_BASE_PATH, HELLO_WIDGET_CLIENT_JS } from "./resources/hello-widget.js";

const nodeRequire: NodeRequire = createRequire(import.meta.url);

/** Lazily-resolved, cached ext-apps app-side bundle (the real `App`, deps inlined). */
let appWithDepsBundle: string | undefined;

/** Resolve + read the ext-apps `app-with-deps` browser bundle from node_modules, once. */
function readAppWithDeps(): string {
  if (appWithDepsBundle === undefined) {
    const bundlePath: string = nodeRequire.resolve("@modelcontextprotocol/ext-apps/app-with-deps");
    appWithDepsBundle = readFileSync(bundlePath, "utf8");
  }
  return appWithDepsBundle;
}

/** Headers for the served JS modules. CORS-open: hosts fetch these into their sandbox. */
const JS_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/javascript; charset=utf-8",
  "Cache-Control": "no-cache",
  "Access-Control-Allow-Origin": "*",
};

/**
 * Serve the built-in widget's browser assets (the app-side module + the ext-apps
 * `App` bundle it imports). These are static, non-sensitive JS that an MCP Apps
 * host fetches into its sandbox iframe, so they are served WITHOUT auth.
 *
 * @returns `true` if the path matched a widget asset and a response was written.
 */
export function tryServeWidgetAsset(pathname: string, res: http.ServerResponse): boolean {
  if (pathname === `${WIDGET_ASSET_BASE_PATH}/index.js`) {
    res.writeHead(200, JS_HEADERS);
    res.end(HELLO_WIDGET_CLIENT_JS);
    return true;
  }
  if (pathname === `${WIDGET_ASSET_BASE_PATH}/app-with-deps.js`) {
    res.writeHead(200, JS_HEADERS);
    res.end(readAppWithDeps());
    return true;
  }
  return false;
}
