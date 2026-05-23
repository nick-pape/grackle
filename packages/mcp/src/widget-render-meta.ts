/**
 * Internal `_meta` channel used by the dynamic widget tools (`widget_render`,
 * `widget_show`) to hand a render descriptor to the in-process broker capture in
 * `mcp-server.ts`. The handler runs in-process, so the capture reads the
 * descriptor off the result directly — it never depends on the agent SDK
 * round-tripping `_meta` (the T3 broker-capture principle).
 */

/** `_meta` key carrying a {@link WidgetRenderDescriptor}. */
export const WIDGET_RENDER_META_KEY: string = "io.grackle/widget-render";

/** Self-contained description of a widget to render into the session stream. */
export interface WidgetRenderDescriptor {
  /** Renderer to use (v1: `"mcp-app-html"`). */
  rendererKind: string;
  /** Widget body (HTML for `mcp-app-html`). */
  body: string;
  /** Render-time data passed to the widget via the AppBridge. */
  props?: Record<string, unknown>;
  /** Allow inline `<script>` in the sandbox CSP (agent-authored bodies). */
  allowInlineScripts?: boolean;
  /** Registry id when rendering a registered widget (omitted for one-off `widget_show`). */
  widgetId?: string;
  /** Registry version, when known. */
  version?: number;
  /** `ui://` resource uri, when the widget is registered. */
  resourceUri?: string;
}
