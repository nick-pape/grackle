import { useEffect, useRef, type JSX } from "react";
import {
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { McpUiStyles } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { grackleHostStyleVariables } from "../../utils/grackleHostStyleVariables.js";

/** Notification method the outer sandbox proxy posts once it is ready. */
const SANDBOX_PROXY_READY: string = "ui/notifications/sandbox-proxy-ready";

/** Identifies this host to widgets during the MCP Apps handshake. */
const HOST_INFO: Readonly<{ name: string; version: string }> = { name: "Grackle", version: "0.0.0" };

/** A tool call the widget asked the host to run on its behalf. */
export interface McpAppWidgetCallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
}

/**
 * Props for {@link McpAppWidget}. Presentational only — all data and side
 * effects arrive as props (no `useGrackle()`).
 */
export interface McpAppWidgetProps {
  /** Widget HTML (`text/html;profile=mcp-app` contents) rendered in the sandbox. */
  widgetHtml: string;
  /** URL of the sandbox proxy, served from a DIFFERENT origin than the host. */
  sandboxProxyUrl: string;
  /** Tool input delivered to the widget via `ui/notifications/tool-input`. */
  toolInput?: Record<string, unknown>;
  /** Tool result delivered to the widget via `ui/notifications/tool-result`. */
  toolResult?: CallToolResult;
  /** Content-Security-Policy domains for the widget (from the resource `_meta.ui`). */
  csp?: McpUiResourceCsp;
  /** Permissions to grant the widget iframe (from the resource `_meta.ui`). */
  permissions?: McpUiResourcePermissions;
  /** Style variables for `hostContext.styles`; defaults to Grackle's live theme. */
  hostStyleVariables?: McpUiStyles;
  /** Color theme reported to the widget; defaults to the document's `data-theme`. */
  theme?: "light" | "dark";
  /** Handle a tool call the widget requests (no MCP client is wired in T1). */
  onCallTool?: (params: McpAppWidgetCallToolParams) => Promise<CallToolResult>;
  /** Handle a link the widget asks the host to open. */
  onOpenLink?: (url: string) => void;
  /** Handle a message the widget asks the host to surface. */
  onSendMessage?: (message: unknown) => void;
  /** Handle a model-context update pushed by the widget. */
  onUpdateModelContext?: (context: unknown) => void;
  /** Notified when the widget requests a new size. */
  onSizeChange?: (size: { width?: number; height?: number }) => void;
}

/** Resolve the active theme, preferring the prop, then the document, then light. */
function resolveTheme(theme: McpAppWidgetProps["theme"]): "light" | "dark" {
  if (theme) {
    return theme;
  }
  if (typeof document !== "undefined") {
    const attr: string | null = document.documentElement.getAttribute("data-theme");
    if (attr === "dark") {
      return "dark";
    }
  }
  return "light";
}

/**
 * Point the iframe at the sandbox proxy and resolve once the proxy reports
 * ready. Returns `false` if the iframe was already loaded (guards against an
 * accidental double-invoke).
 */
function loadSandboxProxy(
  iframe: HTMLIFrameElement,
  sandboxProxyUrl: string,
  csp: McpUiResourceCsp | undefined,
  permissions: McpUiResourcePermissions | undefined,
): Promise<boolean> {
  if (iframe.src) {
    return Promise.resolve(false);
  }
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
  const allow: string = buildAllowAttribute(permissions);
  if (allow) {
    iframe.setAttribute("allow", allow);
  }
  const ready: Promise<boolean> = new Promise<boolean>((resolve) => {
    const listener = (event: MessageEvent): void => {
      const data: { method?: string } | undefined = event.data as { method?: string } | undefined;
      if (event.source === iframe.contentWindow && data?.method === SANDBOX_PROXY_READY) {
        window.removeEventListener("message", listener);
        resolve(true);
      }
    };
    window.addEventListener("message", listener);
  });
  const url: URL = new URL(sandboxProxyUrl);
  if (csp) {
    url.searchParams.set("csp", JSON.stringify(csp));
  }
  iframe.src = url.href;
  return ready;
}

/** Swallow a settled promise's rejection (the host outlives transient widget errors). */
function ignoreRejection(promise: Promise<unknown> | void): void {
  Promise.resolve(promise).catch(() => undefined);
}

/**
 * Renders an MCP Apps widget (untrusted HTML) inside a double-iframe sandbox and
 * drives it over the `ext-apps` `AppBridge` postMessage protocol.
 *
 * The Grackle chat pane is not an MCP client, so this constructs the bridge with
 * `null` (no client) and serves tool input/result from props. Wiring the bridge
 * to a live MCP server is a later ticket (#1238).
 */
export function McpAppWidget(props: McpAppWidgetProps): JSX.Element {
  const {
    widgetHtml,
    sandboxProxyUrl,
    csp,
    permissions,
    hostStyleVariables,
    theme,
    toolInput,
    toolResult,
    onCallTool,
    onOpenLink,
    onSendMessage,
    onUpdateModelContext,
    onSizeChange,
  } = props;

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | undefined>(undefined);

  // Keep the latest callbacks/data in a ref so the setup effect can be keyed
  // only on the widget identity (re-running it would reload the iframe).
  const handlers = useRef({ toolInput, toolResult, onCallTool, onOpenLink, onSendMessage, onUpdateModelContext, onSizeChange });
  handlers.current = { toolInput, toolResult, onCallTool, onOpenLink, onSendMessage, onUpdateModelContext, onSizeChange };

  useEffect(() => {
    const iframe: HTMLIFrameElement | null = iframeRef.current;
    if (!iframe) {
      return undefined;
    }
    // Object holder so the async closure below reads a value lint can't narrow.
    const state: { cancelled: boolean } = { cancelled: false };
    // Read through a function so flow analysis can't narrow it to a literal
    // (it is reassigned in the cleanup closure below).
    const isCancelled = (): boolean => state.cancelled;
    let resizeObserver: ResizeObserver | undefined;

    const run = async (): Promise<void> => {
      const firstTime: boolean = await loadSandboxProxy(iframe, sandboxProxyUrl, csp, permissions);
      if (!firstTime || isCancelled()) {
        return;
      }

      const bridge = new AppBridge(
        null,
        HOST_INFO,
        { openLinks: {}, updateModelContext: { text: {} } },
        {
          hostContext: {
            theme: resolveTheme(theme),
            platform: "web",
            styles: { variables: hostStyleVariables ?? grackleHostStyleVariables() },
            containerDimensions: { maxHeight: 6000 },
            displayMode: "inline",
            availableDisplayModes: ["inline"],
          },
        },
      );
      bridgeRef.current = bridge;

      bridge.oncalltool = async (params): Promise<CallToolResult> => {
        const handler = handlers.current.onCallTool;
        if (handler) {
          return handler({ name: params.name, arguments: params.arguments });
        }
        return { isError: true, content: [{ type: "text", text: "No MCP client is connected to this host." }] };
      };
      bridge.onopenlink = async ({ url }): Promise<Record<string, never>> => {
        const handler = handlers.current.onOpenLink;
        if (handler) {
          handler(url);
        } else {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return {};
      };
      bridge.onmessage = async (params): Promise<Record<string, never>> => {
        handlers.current.onSendMessage?.(params);
        return {};
      };
      bridge.onupdatemodelcontext = async (params): Promise<Record<string, never>> => {
        handlers.current.onUpdateModelContext?.(params);
        return {};
      };
      bridge.onsizechange = ({ width, height }): void => {
        if (width !== undefined) {
          iframe.style.minWidth = `min(${width}px, 100%)`;
        }
        if (height !== undefined) {
          iframe.style.height = `${height}px`;
        }
        handlers.current.onSizeChange?.({ width, height });
      };
      bridge.onrequestdisplaymode = async (): Promise<{ mode: "inline" }> => ({ mode: "inline" });

      const initialized: Promise<void> = new Promise<void>((resolve) => {
        bridge.oninitialized = (): void => resolve();
      });

      await bridge.connect(new PostMessageTransport(iframe.contentWindow as Window, iframe.contentWindow as Window));
      if (isCancelled()) {
        return;
      }
      await bridge.sendSandboxResourceReady({ html: widgetHtml, csp, permissions });
      await initialized;
      if (isCancelled()) {
        return;
      }

      await bridge.sendToolInput({ arguments: handlers.current.toolInput ?? {} });
      const result = handlers.current.toolResult;
      if (result) {
        await bridge.sendToolResult(result);
      }

      resizeObserver = new ResizeObserver(([entry]) => {
        const width: number = Math.round(entry.contentRect.width);
        if (width > 0) {
          ignoreRejection(bridge.sendHostContextChange({ containerDimensions: { width, maxHeight: 6000 } }));
        }
      });
      resizeObserver.observe(iframe);
    };

    run().catch(() => undefined);

    return (): void => {
      state.cancelled = true;
      resizeObserver?.disconnect();
      const bridge: AppBridge | undefined = bridgeRef.current;
      bridgeRef.current = undefined;
      if (bridge) {
        ignoreRejection(bridge.teardownResource({}));
      }
      iframe.removeAttribute("src");
    };
    // Setup is keyed on the widget identity; theme updates flow via the effect
    // below, and other props are read at mount.
  }, [widgetHtml, sandboxProxyUrl]);

  // Propagate theme changes to a live widget.
  useEffect(() => {
    ignoreRejection(bridgeRef.current?.sendHostContextChange({ theme: resolveTheme(theme) }));
  }, [theme]);

  return (
    <iframe
      ref={iframeRef}
      data-testid="mcp-app-widget"
      title="MCP App widget"
      style={{ width: "100%", border: "none", display: "block" }}
    />
  );
}
