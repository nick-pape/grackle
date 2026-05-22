import {
  EXTENSION_ID,
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
  getUiCapability,
} from "@modelcontextprotocol/ext-apps/server";
import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP Apps "app-side" helpers for Grackle's low-level MCP {@link Server}.
 *
 * The ext-apps `registerAppTool`/`registerAppResource` helpers require the
 * high-level `McpServer`, which Grackle does not use, so we replicate their tiny
 * `_meta` normalization here while still importing the spec constants/helper from
 * `@modelcontextprotocol/ext-apps/server` (single source of truth — no copied
 * string literals). See SEP-1865 (MCP Apps).
 */

/** Visibility of a UI tool, per the MCP Apps spec (`McpUiToolVisibility`). */
export type UiToolVisibility = "model" | "app";

/** Re-exported so callers tag UI resources with the MCP Apps MIME type. */
export { RESOURCE_MIME_TYPE, EXTENSION_ID };

/**
 * Build a tool's `_meta` for MCP Apps, populating BOTH the modern nested key
 * (`_meta.ui.resourceUri`) and the legacy flat key (`_meta["ui/resourceUri"]`)
 * for host backwards-compatibility — mirroring ext-apps `registerAppTool`.
 *
 * @param resourceUri - The `ui://` resource the host should render for this tool.
 * @param visibility - Optional audience(s) the widget targets (`model`/`app`).
 * @returns A `_meta` object to attach to the tool's `tools/list` entry.
 */
export function uiToolMeta(
  resourceUri: string,
  visibility?: UiToolVisibility[],
): Record<string, unknown> {
  return {
    ui: { resourceUri, ...(visibility ? { visibility } : {}) },
    [RESOURCE_URI_META_KEY]: resourceUri,
  };
}

/**
 * Whether the connected host can render MCP Apps widgets — i.e. it advertised the
 * `io.modelcontextprotocol/ui` extension during `initialize` with the MCP App
 * HTML MIME in its supported `mimeTypes`. Use the SDK's
 * `Server.getClientCapabilities()` (available after the handshake) as the input.
 *
 * @param capabilities - The negotiated client capabilities, or `undefined`.
 * @returns `true` only when the host can render `text/html;profile=mcp-app`.
 */
export function hostSupportsUiApps(capabilities: ClientCapabilities | undefined): boolean {
  const ui = getUiCapability(capabilities) as { mimeTypes?: string[] } | undefined;
  return Boolean(ui?.mimeTypes?.includes(RESOURCE_MIME_TYPE));
}
