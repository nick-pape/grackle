import { z } from "zod";
import type { GrackleClients, ToolDefinition, ToolResult } from "../tool-registry.js";
import type { AuthContext } from "@grackle-ai/auth";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";
import { HELLO_WIDGET_URI } from "../resources/hello-widget.js";
import { WIDGET_RENDER_META_KEY, type WidgetRenderDescriptor } from "../widget-render-meta.js";

const DEFAULT_RENDERER_KIND: string = "mcp-app-html";

/** Renderer kind for the Grackle React runtime (render-by-source JSX, #1268). */
const REACT_RENDERER_KIND: string = "grackle-react";

/** Build an INVALID_ARGUMENT tool error result. */
function invalidArgument(message: string): ToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message, code: "INVALID_ARGUMENT" }, null, 2) }],
    isError: true,
  };
}

/** Wrap a render descriptor in a tool result whose `_meta` the broker capture reads. */
function renderResult(summary: Record<string, unknown>, descriptor: WidgetRenderDescriptor): ToolResult {
  return { ...jsonResult(summary), _meta: { [WIDGET_RENDER_META_KEY]: descriptor } };
}

/** Owner provenance from the calling session's scoped token (empty for non-scoped callers). */
function owner(authContext?: AuthContext): { ownerTaskId: string; ownerSessionId: string } {
  if (authContext?.type === "scoped") {
    return { ownerTaskId: authContext.taskId, ownerSessionId: authContext.taskSessionId };
  }
  return { ownerTaskId: "", ownerSessionId: "" };
}

/**
 * MCP Apps widget tools.
 *
 * - `show_hello_widget` — the static Grackle-served demo widget (T2/T3).
 * - `widget_register` / `widget_update` / `widget_list` — the agent-authored
 *   registry (#1239): persist a reusable widget body in the workspace.
 * - `widget_render` / `widget_show` — render a widget into the chat. The broker
 *   captures the result `_meta` descriptor and emits the widget event; the
 *   frontend never contacts the MCP server.
 * - `component_show` — render a React/JSX component (render-by-source, #1268)
 *   against the Grackle component library in the sandbox React runtime.
 *
 * `show_hello_widget` carries a static `uiResourceUri` (gated to ui-capable
 * hosts in `mcp-server.ts`); the registry tools are plain tools (always listed
 * to scoped agents) and produce widgets dynamically via `_meta`.
 */
export const widgetTools: ToolDefinition[] = [
  {
    name: "show_hello_widget",
    group: "widget",
    description:
      "Display the Grackle hello widget — a minimal interactive MCP Apps UI that echoes the provided message. Renders inline in hosts that support MCP Apps.",
    inputSchema: z.object({
      message: z.string().optional().describe("Message to echo back in the widget."),
    }),
    rpcMethod: "showHelloWidget",
    mutating: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    uiResourceUri: HELLO_WIDGET_URI,
    async handler(args: Record<string, unknown>) {
      const message: string = typeof args.message === "string" ? args.message : "Hello from Grackle";
      return jsonResult({ message, renderedAt: new Date().toISOString() });
    },
  },
  {
    name: "widget_register",
    group: "widget",
    description:
      "Register a reusable UI widget in this workspace so it can be rendered repeatedly with different data via widget_render. The body is HTML (text/html;profile=mcp-app) and may include inline <script>/<style>; it renders in a sandboxed iframe. Returns the widget id.",
    inputSchema: z.object({
      name: z.string().describe("Short widget name, unique within your workspace."),
      body: z.string().describe("Widget HTML body. May include inline <script>/<style>."),
      description: z.string().optional().describe("Human-readable description of the widget."),
      propsSchema: z.string().optional().describe("Optional JSON Schema (as a string) describing the props widget_render accepts."),
      workspaceId: z.string().optional().describe("Workspace ID (auto-injected from session context when omitted)."),
    }),
    rpcMethod: "registerWidget",
    mutating: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async handler(args: Record<string, unknown>, { orchestration: client }: GrackleClients, authContext?: AuthContext) {
      const workspaceId = args.workspaceId as string | undefined;
      if (!workspaceId) {
        return invalidArgument("workspaceId is required but was not provided or auto-injected. This session may not be associated with a workspace.");
      }
      try {
        const w = await client.registerWidget({
          workspaceId,
          name: args.name as string,
          body: args.body as string,
          description: (args.description as string | undefined) ?? "",
          rendererKind: DEFAULT_RENDERER_KIND,
          propsSchema: (args.propsSchema as string | undefined) ?? "",
          ...owner(authContext),
        });
        return jsonResult({ id: w.id, name: w.name, version: w.version });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "widget_update",
    group: "widget",
    description: "Update a registered widget's body, name, description, or props schema. Only provided fields change; the version is bumped.",
    inputSchema: z.object({
      id: z.string().describe("Widget id to update."),
      body: z.string().optional().describe("New widget HTML body."),
      name: z.string().optional().describe("New widget name."),
      description: z.string().optional().describe("New description."),
      propsSchema: z.string().optional().describe("New props JSON Schema (as a string)."),
      workspaceId: z.string().optional().describe("Workspace ID (auto-injected from session context)."),
    }),
    rpcMethod: "updateWidget",
    mutating: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async handler(args: Record<string, unknown>, { orchestration: client }: GrackleClients) {
      if (!args.id) {
        return invalidArgument("id is required");
      }
      try {
        const w = await client.updateWidget({
          id: args.id as string,
          workspaceId: (args.workspaceId as string | undefined) ?? "",
          ...(args.name !== undefined ? { name: args.name as string } : {}),
          ...(args.description !== undefined ? { description: args.description as string } : {}),
          ...(args.body !== undefined ? { body: args.body as string } : {}),
          ...(args.propsSchema !== undefined ? { propsSchema: args.propsSchema as string } : {}),
        });
        return jsonResult({ id: w.id, name: w.name, version: w.version });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "widget_list",
    group: "widget",
    description: "List the reusable widgets registered in this workspace.",
    inputSchema: z.object({
      workspaceId: z.string().optional().describe("Workspace ID (auto-injected from session context when omitted)."),
    }),
    rpcMethod: "listWidgets",
    mutating: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(args: Record<string, unknown>, { orchestration: client }: GrackleClients) {
      const workspaceId = args.workspaceId as string | undefined;
      if (!workspaceId) {
        return invalidArgument("workspaceId is required but was not provided or auto-injected.");
      }
      try {
        const response = await client.listWidgets({ workspaceId });
        return jsonResult(response.widgets.map((w) => ({
          id: w.id,
          name: w.name,
          description: w.description,
          rendererKind: w.rendererKind,
          version: w.version,
          updatedAt: w.updatedAt,
        })));
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "widget_render",
    group: "widget",
    description:
      "Render a previously registered widget inline in the chat, optionally passing props (data). Resolve the widget by id (preferred) or by name within your workspace.",
    inputSchema: z.object({
      id: z.string().optional().describe("Widget id (takes precedence over name)."),
      name: z.string().optional().describe("Widget name, resolved within your workspace."),
      props: z.record(z.string(), z.unknown()).optional().describe("Data passed to the widget at render time."),
      workspaceId: z.string().optional().describe("Workspace ID (auto-injected from session context)."),
    }),
    rpcMethod: "getWidget",
    mutating: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(args: Record<string, unknown>, { orchestration: client }: GrackleClients) {
      const id = args.id as string | undefined;
      const name = args.name as string | undefined;
      if (!id && !name) {
        return invalidArgument("id or name is required");
      }
      try {
        const w = await client.getWidget({
          id: id ?? "",
          name: name ?? "",
          workspaceId: (args.workspaceId as string | undefined) ?? "",
        });
        const descriptor: WidgetRenderDescriptor = {
          rendererKind: w.rendererKind || DEFAULT_RENDERER_KIND,
          body: w.body,
          props: (args.props as Record<string, unknown> | undefined) ?? {},
          allowInlineScripts: true,
          widgetId: w.id,
          version: w.version,
          resourceUri: `ui://grackle/${w.id}`,
        };
        return renderResult({ rendered: true, id: w.id, name: w.name, version: w.version }, descriptor);
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "widget_show",
    group: "widget",
    description:
      "Render a one-off widget inline in the chat from an inline HTML body, without persisting it. Use widget_register + widget_render when you want to reuse a widget across renders.",
    inputSchema: z.object({
      body: z.string().describe("Widget HTML body. May include inline <script>/<style>."),
      props: z.record(z.string(), z.unknown()).optional().describe("Data passed to the widget at render time."),
      workspaceId: z.string().optional().describe("Workspace ID (auto-injected; unused for one-off renders)."),
    }),
    rpcMethod: "widgetShow",
    mutating: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(args: Record<string, unknown>) {
      const descriptor: WidgetRenderDescriptor = {
        rendererKind: DEFAULT_RENDERER_KIND,
        body: args.body as string,
        props: (args.props as Record<string, unknown> | undefined) ?? {},
        allowInlineScripts: true,
        resourceUri: "",
      };
      return renderResult({ rendered: true }, descriptor);
    },
  },
  {
    name: "component_show",
    group: "widget",
    description:
      "Render a React/JSX component inline in the chat against the Grackle component library (no persistence). Provide `source` as JSX that calls render(<YourComponent {...props}/>) (react-live noInline); `props` supplies the data. `React`, `props`, and Grackle components (e.g. Button, Callout, Spinner) are in scope. Renders in a sandboxed iframe.",
    inputSchema: z.object({
      source: z.string().describe("JSX source. Must call render(<Component {...props}/>). `React`, `props`, and Grackle components are in scope."),
      props: z.record(z.string(), z.unknown()).optional().describe("Data passed to the component as `props`."),
      workspaceId: z.string().optional().describe("Workspace ID (auto-injected; unused for one-off renders)."),
    }),
    rpcMethod: "componentShow",
    mutating: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(args: Record<string, unknown>) {
      const descriptor: WidgetRenderDescriptor = {
        rendererKind: REACT_RENDERER_KIND,
        body: args.source as string,
        props: (args.props as Record<string, unknown> | undefined) ?? {},
        allowUnsafeEval: true,
        resourceUri: "",
      };
      return renderResult({ rendered: true }, descriptor);
    },
  },
];
