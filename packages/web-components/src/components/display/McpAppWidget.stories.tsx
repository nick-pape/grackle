import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn } from "@storybook/test";
import { McpAppWidget } from "./McpAppWidget.js";

// The sandbox proxy MUST be served from a different origin than Storybook.
// Run `npm run storybook:mcp` (Storybook + the sidecar CSP server) so this is up.
const SANDBOX_ORIGIN: string = "http://localhost:6007";
const SANDBOX_URL: string = SANDBOX_ORIGIN + "/sandbox.html";

// A sample widget that loads the REAL @modelcontextprotocol/ext-apps `App` (the
// dependency-inlined bundle served by serve.mjs) so the MCP Apps handshake is
// fully spec-conformant. The widget logic lives in sample-widget.js; this is just
// the DOM skeleton plus the module script tag. ASCII-only (the Storybook acorn
// indexer breaks on non-ASCII in .stories.tsx).
const SAMPLE_WIDGET_HTML: string = [
  '<!doctype html><html><head><meta charset="utf-8"><style>',
  "body{margin:0;font-family:var(--font-sans,sans-serif);color:var(--color-text-primary,#111);",
  "background:var(--color-background-secondary,#f5f5f5);padding:16px}",
  ".card{background:var(--color-background-primary,#fff);border:1px solid var(--color-border-primary,#ddd);",
  "border-radius:var(--border-radius-md,6px);padding:16px}",
  "code{font-family:var(--font-mono,monospace)} button{margin-top:12px}",
  '</style></head><body><div class="card">',
  '<h2 id="title">Weather</h2>',
  '<div>Input: <code id="in">(none)</code></div>',
  '<div>Result: <code id="out">(pending)</code></div>',
  '<button id="call">Refresh</button></div>',
  '<script type="module" src="' + SANDBOX_ORIGIN + '/sample-widget.js"></script>',
  "</body></html>",
].join("");

const meta: Meta<typeof McpAppWidget> = {
  title: "Grackle/Display/McpAppWidget",
  component: McpAppWidget,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    widgetHtml: SAMPLE_WIDGET_HTML,
    sandboxProxyUrl: SANDBOX_URL,
    toolInput: { location: "Seattle" },
    toolResult: { content: [{ type: "text", text: "72F and clear" }] },
    onCallTool: fn(async () => ({ content: [{ type: "text", text: "refreshed: 70F" }] })),
    onOpenLink: fn(),
    onSendMessage: fn(),
    onSizeChange: fn(),
  },
  // Sidecar-independent smoke check: the host iframe mounts. The full handshake
  // (proxy ready -> initialize -> tool-input/result -> size-changed) is exercised
  // visually via `npm run storybook:mcp` and the PR screenshot, since it requires
  // the cross-origin sidecar which is not part of the headless test phase.
  play: async ({ canvas }) => {
    const iframe = await canvas.findByTestId("mcp-app-widget");
    await expect(iframe).toBeInTheDocument();
    await expect(iframe.tagName.toLowerCase()).toBe("iframe");
  },
};
