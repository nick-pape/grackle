import { useEffect, useRef, useState, type JSX } from "react";
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

/** Default host identity reported to widgets during the MCP Apps handshake. */
const DEFAULT_HOST_INFO: Readonly<{ name: string; version: string }> = {
  name: "Grackle",
  version: "0.0.0",
};

/** URL schemes the default link handler is permitted to open. */
const SAFE_LINK_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/** True if `url` parses as an `http(s)` URL safe to open in a new browsing context. */
function isSafeHttpUrl(url: string): boolean {
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

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
  /** Host identity reported to the widget; defaults to {@link DEFAULT_HOST_INFO}. */
  hostInfo?: { name: string; version: string };
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
 * accidental double-invoke) or if `signal` aborts before the proxy responds.
 *
 * The ready listener is bound to `signal` so it is removed on effect cleanup,
 * and only messages from the proxy window AND its expected origin are accepted.
 */
function loadSandboxProxy(
  iframe: HTMLIFrameElement,
  sandboxProxyUrl: string,
  proxyOrigin: string,
  csp: McpUiResourceCsp | undefined,
  permissions: McpUiResourcePermissions | undefined,
  signal: AbortSignal,
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
      if (
        event.source === iframe.contentWindow &&
        event.origin === proxyOrigin &&
        data?.method === SANDBOX_PROXY_READY
      ) {
        resolve(true);
      }
    };
    // `{ signal }` removes the listener automatically on effect cleanup, so it
    // never outlives the component even if the proxy never responds.
    window.addEventListener("message", listener, { signal });
    signal.addEventListener("abort", () => resolve(false), { once: true });
  });
  const url: URL = new URL(sandboxProxyUrl, window.location.href);
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
    hostInfo,
    toolInput,
    toolResult,
    onCallTool,
    onOpenLink,
    onSendMessage,
    onUpdateModelContext,
    onSizeChange,
  } = props;

  // Fail fast on the isolation-breaking misconfiguration: the sandbox proxy MUST
  // be a different origin than the host, otherwise `window.top` is reachable and
  // the double-iframe guarantee is void.
  if (
    typeof window !== "undefined" &&
    new URL(sandboxProxyUrl, window.location.href).origin === window.location.origin
  ) {
    throw new Error(
      "McpAppWidget: sandboxProxyUrl must be served from a DIFFERENT origin than the host.",
    );
  }

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | undefined>(undefined);
  // Flips true once the ui/initialize handshake completes; the tool-input/result
  // effects below key on it so late-arriving props still reach the widget.
  const [initialized, setInitialized] = useState<boolean>(false);

  // Keep the latest callbacks in a ref so the setup effect can be keyed only on
  // the widget identity (re-running it would reload the iframe).
  const handlers = useRef({
    onCallTool,
    onOpenLink,
    onSendMessage,
    onUpdateModelContext,
    onSizeChange,
  });
  handlers.current = { onCallTool, onOpenLink, onSendMessage, onUpdateModelContext, onSizeChange };

  // csp/permissions are part of the widget identity (they affect the proxy URL
  // and sendSandboxResourceReady), so the iframe must reload when they change.
  const cspKey: string = JSON.stringify(csp ?? null);
  const permissionsKey: string = JSON.stringify(permissions ?? null);

  useEffect(() => {
    const iframe: HTMLIFrameElement | null = iframeRef.current;
    if (!iframe) {
      return undefined;
    }

    // Origin of the proxy, used to validate inbound proxy messages. The
    // different-origin invariant is enforced at render time (see above).
    const proxyOrigin: string = new URL(sandboxProxyUrl, window.location.href).origin;
    const abortController: AbortController = new AbortController();
    const { signal } = abortController;
    // Read abort state through a function so TS flow-analysis can't narrow it to
    // a constant across the awaits below (cleanup flips it asynchronously).
    const isAborted = (): boolean => signal.aborted;
    let resizeObserver: ResizeObserver | undefined;

    const run = async (): Promise<void> => {
      const firstTime: boolean = await loadSandboxProxy(
        iframe,
        sandboxProxyUrl,
        proxyOrigin,
        csp,
        permissions,
        signal,
      );
      if (!firstTime || isAborted()) {
        return;
      }

      const bridge = new AppBridge(
        null,
        hostInfo ?? DEFAULT_HOST_INFO,
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
        return {
          isError: true,
          content: [{ type: "text", text: "No MCP client is connected to this host." }],
        };
      };
      bridge.onopenlink = async ({ url }): Promise<Record<string, never>> => {
        const handler = handlers.current.onOpenLink;
        if (handler) {
          handler(url);
        } else if (isSafeHttpUrl(url)) {
          // Only http(s) — never javascript:/data: from an untrusted widget.
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

      const handshakeComplete: Promise<void> = new Promise<void>((resolve) => {
        bridge.oninitialized = (): void => resolve();
      });

      await bridge.connect(
        new PostMessageTransport(iframe.contentWindow as Window, iframe.contentWindow as Window),
      );
      if (isAborted()) {
        return;
      }
      await bridge.sendSandboxResourceReady({ html: widgetHtml, csp, permissions });
      await handshakeComplete;
      if (isAborted()) {
        return;
      }
      // Tool input/result are delivered (and kept in sync) by the effects below
      // now that the handshake is complete.
      setInitialized(true);

      resizeObserver = new ResizeObserver(([entry]) => {
        const width: number = Math.round(entry.contentRect.width);
        if (width > 0) {
          ignoreRejection(
            bridge.sendHostContextChange({ containerDimensions: { width, maxHeight: 6000 } }),
          );
        }
      });
      resizeObserver.observe(iframe);
    };

    run().catch(() => undefined);

    return (): void => {
      abortController.abort();
      setInitialized(false);
      resizeObserver?.disconnect();
      const bridge: AppBridge | undefined = bridgeRef.current;
      bridgeRef.current = undefined;
      if (bridge) {
        ignoreRejection(bridge.teardownResource({}));
      }
      iframe.removeAttribute("src");
    };
    // Setup is keyed on the widget identity (html + proxy URL + csp/permissions).
    // Tool input/result and theme updates flow via the dedicated effects below.
  }, [widgetHtml, sandboxProxyUrl, cspKey, permissionsKey]);

  // Deliver tool input after the handshake, and whenever it changes afterwards.
  useEffect(() => {
    if (!initialized) {
      return;
    }
    ignoreRejection(bridgeRef.current?.sendToolInput({ arguments: toolInput ?? {} }));
  }, [initialized, toolInput]);

  // Deliver the tool result once it is available, and whenever it changes. The
  // host commonly renders the widget before the result exists.
  useEffect(() => {
    if (!initialized || !toolResult) {
      return;
    }
    ignoreRejection(bridgeRef.current?.sendToolResult(toolResult));
  }, [initialized, toolResult]);

  // Propagate theme + style-variable changes to a live widget. When
  // hostStyleVariables is omitted, the Grackle token values themselves change
  // with the theme, so the resolved variables are re-sent too.
  useEffect(() => {
    ignoreRejection(
      bridgeRef.current?.sendHostContextChange({
        theme: resolveTheme(theme),
        styles: { variables: hostStyleVariables ?? grackleHostStyleVariables() },
      }),
    );
  }, [theme, hostStyleVariables]);

  return (
    <iframe
      ref={iframeRef}
      data-testid="mcp-app-widget"
      title="MCP App widget"
      style={{ width: "100%", border: "none", display: "block" }}
    />
  );
}
