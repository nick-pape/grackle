/**
 * Grackle React runtime (#1268) — the single MCP Apps resource (`ui://grackle/runtime`)
 * that renders agent-authored React/JSX inline in the chat.
 *
 * Bundled self-contained (React + react-live + the curated Grackle component set +
 * the ext-apps guest bridge) by `vite.config.ts` into `mcp-app-runtime/runtime.js`
 * and served from the sandbox origin. The host (`McpAppWidget`) writes a tiny
 * bootstrap that loads this script, then delivers `{ source, props }` as MCP Apps
 * tool input. The runtime transpiles + evaluates the JSX via react-live against the
 * component scope and paints it. This is the load-bearing slice of the GenUX
 * component-registry vision (render-by-source; the registry comes in later phases).
 */
import { useState, type JSX } from "react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { LiveProvider, LivePreview, LiveError } from "react-live";
import { useApp, useHostStyleVariables } from "@modelcontextprotocol/ext-apps/react";
import { COMPONENT_SCOPE } from "./component-scope.js";
import { composeSource, type RenderDependency } from "./compose-source.js";

/** Identity reported to the host during the MCP Apps guest handshake. */
const APP_INFO: Readonly<{ name: string; version: string }> = {
  name: "GrackleReactRuntime",
  version: "0.1.0",
};

/** The agent-supplied render request delivered via MCP Apps tool input. */
interface RenderInput {
  /** JSX source; must call `render(<Component {...props}/>)` (react-live noInline). */
  source: string;
  /** Data bound into the component, available as `props` in the JSX scope. */
  props: Record<string, unknown>;
  /** Resolved registry dependencies in eval order (deepest first), for composition (#1270). */
  components: RenderDependency[];
}

/** Connects the guest bridge, receives the JSX + props, and renders via react-live. */
function Runtime(): JSX.Element {
  const [input, setInput] = useState<RenderInput | undefined>(undefined);

  const { app, error } = useApp({
    appInfo: APP_INFO,
    capabilities: {},
    onAppCreated: (createdApp): void => {
      createdApp.ontoolinput = (params): void => {
        const args = (params.arguments ?? {}) as {
          source?: unknown;
          props?: unknown;
          components?: unknown;
        };
        const components: RenderDependency[] = Array.isArray(args.components)
          ? (args.components as unknown[]).filter(
              (d): d is RenderDependency =>
                d !== null &&
                typeof d === "object" &&
                typeof (d as RenderDependency).name === "string" &&
                typeof (d as RenderDependency).body === "string",
            )
          : [];
        setInput({
          source: typeof args.source === "string" ? args.source : "",
          props:
            args.props !== null && typeof args.props === "object"
              ? (args.props as Record<string, unknown>)
              : {},
          components,
        });
      };
    },
  });

  // Mirror the host theme + style tokens onto this document (light-dark + CSS vars).
  useHostStyleVariables(app, app?.getHostContext());

  if (error) {
    return (
      <div style={{ color: "var(--color-text-danger, #c00)" }}>Runtime error: {error.message}</div>
    );
  }
  if (!input) {
    return <div style={{ opacity: 0.6, padding: "0.5rem" }}>Loading component…</div>;
  }

  // react-live transpiles the JSX (sucrase) and evaluates it with `new Function`
  // (requires `script-src 'unsafe-eval'`, set on this resource's sandbox CSP). The
  // origin-isolated sandbox + restricted connect-src keep that safe (#1268).
  const scope: Record<string, unknown> = { React, props: input.props, ...COMPONENT_SCOPE };
  return (
    <LiveProvider code={composeSource(input.source, input.components)} noInline scope={scope}>
      <LivePreview />
      <LiveError />
    </LiveProvider>
  );
}

/** Mount the runtime into the bootstrap's root element. */
function main(): void {
  const rootEl: HTMLElement | null = document.getElementById("grackle-root");
  if (rootEl) {
    createRoot(rootEl).render(<Runtime />);
  }
}

main();
