// Sample MCP App (app-side) for the McpAppWidget Storybook story.
//
// Uses the REAL @modelcontextprotocol/ext-apps `App` class — bundled with its
// dependencies inlined in app-with-deps.js (served by serve.mjs from the sandbox
// origin) — so the ui/initialize -> initialized -> tool-input/tool-result
// handshake is exactly spec-conformant. The previous hand-rolled handshake
// rendered but never received data because its messages failed AppBridge's Zod
// validation; the real App produces schema-correct messages.
//
// Loaded by the inner sandboxed iframe via `<script type="module">`. Relative
// imports resolve against this module's URL (the sandbox origin), so
// `./app-with-deps.js` is fetched from the same sidecar.

import {
  App,
  PostMessageTransport,
  applyHostStyleVariables,
  applyHostFonts,
  applyDocumentTheme,
} from "./app-with-deps.js";

const inEl = document.getElementById("in");
const outEl = document.getElementById("out");
const callBtn = document.getElementById("call");

/** Render a CallToolResult `content` array into the result element. */
function renderResult(content) {
  const blocks = content ?? [];
  outEl.textContent =
    blocks
      .map((block) => (block.type === "text" ? block.text : "<" + block.type + ">"))
      .join(" ") || "(empty)";
}

const app = new App({ name: "SampleWeather", version: "1.0.0" }, {});

// Register handlers BEFORE connect so the one-shot tool-input/result the host
// sends right after the handshake are not missed.
app.ontoolinput = (params) => {
  inEl.textContent = JSON.stringify(params.arguments ?? {});
};
app.ontoolresult = (params) => {
  renderResult(params.content);
};

/** Apply the host's theme + style variables to this document. */
function applyHostStyles() {
  const ctx = app.getHostContext();
  if (ctx?.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx?.styles?.css?.fonts) {
    applyHostFonts(ctx.styles.css.fonts);
  }
  if (ctx?.theme) {
    applyDocumentTheme(ctx.theme);
  }
}
app.onhostcontextchanged = () => applyHostStyles();

// The Refresh button asks the host to run a tool on the App's behalf
// (proxied to McpAppWidget's onCallTool prop in the story).
callBtn.addEventListener("click", () => {
  outEl.textContent = "(refreshing...)";
  app
    .callServerTool({ name: "refresh_weather", arguments: {} })
    .then((result) => renderResult(result.content))
    .catch((err) => {
      outEl.textContent = "error: " + (err && err.message ? err.message : String(err));
    });
});

await app.connect(new PostMessageTransport(window.parent, window.parent));
applyHostStyles();
