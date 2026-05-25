import { RESOURCE_MIME_TYPE } from "../ui-app.js";
import type { ResourceDefinition } from "../resource-registry.js";

/** URI of the built-in hello widget resource. Single source of truth. */
export const HELLO_WIDGET_URI: string = "ui://grackle/hello-widget";

/**
 * Path prefix under which the MCP server serves this widget's browser assets
 * (`/index.js` + `/app-with-deps.js`). Used both by the server's static router
 * and by the widget HTML's `<script src>`.
 */
export const WIDGET_ASSET_BASE_PATH: string = "/widgets/hello";

/**
 * App-side ES module for the hello widget, served at
 * `<base>${WIDGET_ASSET_BASE_PATH}/index.js`. Uses the REAL ext-apps `App`
 * (imported from the sibling `app-with-deps.js` the server also serves) for a
 * spec-conformant `ui/initialize` -> `initialized` -> tool-input/result
 * handshake. Ported from the T1 Storybook sample widget (#1236). Kept as a
 * string so it ships in `dist` without a heft asset-copy step.
 */
export const HELLO_WIDGET_CLIENT_JS: string = [
  'import { App, PostMessageTransport, applyHostStyleVariables, applyHostFonts, applyDocumentTheme } from "./app-with-deps.js";',
  'const inputEl = document.getElementById("input");',
  'const resultEl = document.getElementById("result");',
  "function renderResult(content) {",
  "  const blocks = content || [];",
  '  resultEl.textContent = blocks.map(function (b) { return b.type === "text" ? b.text : "<" + b.type + ">"; }).join(" ") || "(empty)";',
  "}",
  'const app = new App({ name: "GrackleHelloWidget", version: "1.0.0" }, {});',
  "app.ontoolinput = function (params) { inputEl.textContent = JSON.stringify((params && params.arguments) || {}); };",
  "app.ontoolresult = function (params) { renderResult(params && params.content); };",
  "function applyHostStyles() {",
  "  const ctx = app.getHostContext();",
  "  if (ctx && ctx.styles && ctx.styles.variables) { applyHostStyleVariables(ctx.styles.variables); }",
  "  if (ctx && ctx.styles && ctx.styles.css && ctx.styles.css.fonts) { applyHostFonts(ctx.styles.css.fonts); }",
  "  if (ctx && ctx.theme) { applyDocumentTheme(ctx.theme); }",
  "}",
  "app.onhostcontextchanged = function () { applyHostStyles(); };",
  "await app.connect(new PostMessageTransport(window.parent, window.parent));",
  "applyHostStyles();",
  "",
].join("\n");

/** Build the widget HTML document, pointing its script at the asset base URL. */
function helloWidgetHtml(assetBaseUrl: string): string {
  const src: string = `${assetBaseUrl}${WIDGET_ASSET_BASE_PATH}/index.js`;
  return [
    '<!doctype html><html><head><meta charset="utf-8" /><meta name="color-scheme" content="light dark" /><style>',
    "body{margin:0;font-family:var(--font-sans,sans-serif);color:var(--color-text-primary,#111);",
    "background:var(--color-background-secondary,#f5f5f5);padding:16px}",
    ".card{background:var(--color-background-primary,#fff);border:1px solid var(--color-border-primary,#ddd);",
    "border-radius:var(--border-radius-md,6px);padding:16px}",
    "code{font-family:var(--font-mono,monospace)}",
    '</style></head><body><div class="card">',
    "<h2>Grackle</h2>",
    '<div>Input: <code id="input">(none)</code></div>',
    '<div>Result: <code id="result">(pending)</code></div>',
    "</div>",
    `<script type="module" src="${src}"></script>`,
    "</body></html>",
  ].join("");
}

/**
 * Build the built-in hello widget resource. The widget's browser assets are
 * loaded from `assetBaseUrl` (the MCP server's own public origin), so the host
 * sandbox must be allowed to load cross-origin scripts from it — that host-CSP /
 * cross-origin concern is out of scope for #1237 (handled for Grackle's own host
 * in #1238).
 *
 * @param assetBaseUrl - Public origin of the MCP server, e.g. `http://127.0.0.1:7435`.
 */
export function createHelloWidgetResource(assetBaseUrl: string): ResourceDefinition {
  return {
    uri: HELLO_WIDGET_URI,
    name: "Grackle Hello Widget",
    description: "A minimal MCP Apps widget that displays the tool input and result.",
    mimeType: RESOURCE_MIME_TYPE,
    read: () => ({ text: helloWidgetHtml(assetBaseUrl) }),
  };
}
