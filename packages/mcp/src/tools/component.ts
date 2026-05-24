import { z } from "zod";
import { Ajv } from "ajv";
import type { GrackleClients, ToolDefinition, ToolResult } from "../tool-registry.js";
import type { AuthContext } from "@grackle-ai/auth";
import { jsonResult } from "../result-helpers.js";
import { grpcErrorToToolResult } from "../error-handler.js";
import { HELLO_WIDGET_URI } from "../resources/hello-widget.js";
import { WIDGET_RENDER_META_KEY, type WidgetRenderDescriptor } from "../widget-render-meta.js";

/** Renderer kind for raw-HTML bodies (sandboxed inline scripts). */
const HTML_RENDERER_KIND: string = "mcp-app-html";
/** Renderer kind for the Grackle React runtime (JSX via react-live, #1268). */
const REACT_RENDERER_KIND: string = "grackle-react";

/**
 * Shared JSON-Schema validator for component `propsSchema`s. `strict: false`
 * accepts any well-formed JSON Schema (we don't constrain agents to a dialect).
 */
const ajv: Ajv = new Ajv({ strict: false, allErrors: true });

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
 * Validate that a `propsSchema` argument is a well-formed JSON Schema object.
 * Returns an error message when malformed, or `undefined` when valid/absent.
 */
function propsSchemaError(propsSchema: string | undefined): string | undefined {
  if (!propsSchema) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(propsSchema);
  } catch {
    return "propsSchema must be valid JSON (a JSON Schema object)";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "propsSchema must be a JSON Schema object (e.g. {\"type\":\"object\",\"properties\":{...}})";
  }
  try {
    ajv.compile(parsed);
  } catch (err) {
    return `propsSchema is not a valid JSON Schema: ${err instanceof Error ? err.message : String(err)}`;
  }
  return undefined;
}

/**
 * Validate render-time `props` against a component's stored JSON-Schema
 * `propsSchema` by converting it to a zod schema and parsing. Returns an error
 * message on mismatch, or `undefined` when valid (or when there is no schema).
 */
function propsValidationError(propsSchema: string, props: Record<string, unknown>): string | undefined {
  if (!propsSchema) {
    return undefined;
  }
  let schema: unknown;
  try {
    schema = JSON.parse(propsSchema);
  } catch {
    // A malformed stored schema is validated at register time; don't block renders on it.
    return undefined;
  }
  let validate: ReturnType<typeof ajv.compile>;
  try {
    validate = ajv.compile(schema as object);
  } catch {
    return undefined; // unusable stored schema → don't block the render
  }
  if (validate(props)) {
    return undefined;
  }
  return ajv.errorsText(validate.errors, { dataVar: "props" });
}

/**
 * MCP Apps component registry + render tools.
 *
 * - `component_register` / `component_update` / `component_list` — the
 *   agent-authored registry (#1239 widgets → #1269 components): persist a reusable
 *   component (`grackle-react` JSX by default, or `mcp-app-html`) in the workspace.
 * - `component_render` — render a registered component by id/name with props; the
 *   broker captures the result `_meta` descriptor and emits the widget event.
 * - `component_show` — render a one-off React/JSX component (render-by-source, #1268).
 * - `widget_show` — render a one-off raw-HTML body. `show_hello_widget` — demo.
 *
 * `show_hello_widget` carries a static `uiResourceUri` (gated to ui-capable hosts
 * in `mcp-server.ts`); the registry tools are plain tools (always listed to scoped
 * agents) and produce widgets dynamically via `_meta`.
 */
export const componentTools: ToolDefinition[] = [
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
    name: "component_register",
    group: "component",
    description:
      "Register a reusable component in this workspace so it can be rendered repeatedly with different data via component_render. `source` is the component body: JSX for the default `grackle-react` renderer (call render(<C {...props}/>); React + Grackle components are in scope), or HTML for `mcp-app-html`. Optionally provide a `propsSchema` (JSON Schema) describing the props it accepts. Returns the component id.",
    inputSchema: z.object({
      name: z.string().describe("Short component name, unique within your workspace."),
      source: z.string().describe("Component body — JSX (grackle-react) or HTML (mcp-app-html)."),
      rendererKind: z.enum([REACT_RENDERER_KIND, HTML_RENDERER_KIND]).optional().describe("Renderer (default grackle-react)."),
      description: z.string().optional().describe("Human-readable description of the component."),
      propsSchema: z.string().optional().describe("JSON Schema (as a string) describing the props component_render accepts."),
      workspaceId: z.string().optional().describe("Workspace ID (auto-injected from session context when omitted)."),
    }),
    rpcMethod: "registerComponent",
    mutating: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async handler(args: Record<string, unknown>, { orchestration: client }: GrackleClients, authContext?: AuthContext) {
      const workspaceId = args.workspaceId as string | undefined;
      if (!workspaceId) {
        return invalidArgument("workspaceId is required but was not provided or auto-injected. This session may not be associated with a workspace.");
      }
      const schemaErr = propsSchemaError(args.propsSchema as string | undefined);
      if (schemaErr) {
        return invalidArgument(schemaErr);
      }
      try {
        const c = await client.registerComponent({
          workspaceId,
          name: args.name as string,
          body: args.source as string,
          description: (args.description as string | undefined) ?? "",
          rendererKind: (args.rendererKind as string | undefined) ?? REACT_RENDERER_KIND,
          propsSchema: (args.propsSchema as string | undefined) ?? "",
          ...owner(authContext),
        });
        return jsonResult({ id: c.id, name: c.name, version: c.version });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "component_update",
    group: "component",
    description: "Update a registered component's source (body), name, description, or props schema. Only provided fields change; the version is bumped.",
    inputSchema: z.object({
      id: z.string().describe("Component id to update."),
      source: z.string().optional().describe("New component body (JSX or HTML)."),
      name: z.string().optional().describe("New component name."),
      description: z.string().optional().describe("New description."),
      propsSchema: z.string().optional().describe("New props JSON Schema (as a string)."),
      workspaceId: z.string().optional().describe("Workspace ID (auto-injected from session context)."),
    }),
    rpcMethod: "updateComponent",
    mutating: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async handler(args: Record<string, unknown>, { orchestration: client }: GrackleClients) {
      if (!args.id) {
        return invalidArgument("id is required");
      }
      const schemaErr = propsSchemaError(args.propsSchema as string | undefined);
      if (schemaErr) {
        return invalidArgument(schemaErr);
      }
      try {
        const c = await client.updateComponent({
          id: args.id as string,
          workspaceId: (args.workspaceId as string | undefined) ?? "",
          ...(args.name !== undefined ? { name: args.name as string } : {}),
          ...(args.description !== undefined ? { description: args.description as string } : {}),
          ...(args.source !== undefined ? { body: args.source as string } : {}),
          ...(args.propsSchema !== undefined ? { propsSchema: args.propsSchema as string } : {}),
        });
        return jsonResult({ id: c.id, name: c.name, version: c.version });
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "component_list",
    group: "component",
    description: "List the reusable components registered in this workspace.",
    inputSchema: z.object({
      workspaceId: z.string().optional().describe("Workspace ID (auto-injected from session context when omitted)."),
    }),
    rpcMethod: "listComponents",
    mutating: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(args: Record<string, unknown>, { orchestration: client }: GrackleClients) {
      const workspaceId = args.workspaceId as string | undefined;
      if (!workspaceId) {
        return invalidArgument("workspaceId is required but was not provided or auto-injected.");
      }
      try {
        const response = await client.listComponents({ workspaceId });
        return jsonResult(response.components.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          rendererKind: c.rendererKind,
          propsSchema: c.propsSchema,
          version: c.version,
          updatedAt: c.updatedAt,
        })));
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "component_render",
    group: "component",
    description:
      "Render a previously registered component inline in the chat, optionally passing props (data). Resolve by id (preferred) or by name within your workspace. Props are validated against the component's propsSchema when present.",
    inputSchema: z.object({
      id: z.string().optional().describe("Component id (takes precedence over name)."),
      name: z.string().optional().describe("Component name, resolved within your workspace."),
      props: z.record(z.string(), z.unknown()).optional().describe("Data passed to the component at render time."),
      workspaceId: z.string().optional().describe("Workspace ID (auto-injected from session context)."),
    }),
    rpcMethod: "getComponent",
    mutating: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(args: Record<string, unknown>, { orchestration: client }: GrackleClients) {
      const id = args.id as string | undefined;
      const name = args.name as string | undefined;
      if (!id && !name) {
        return invalidArgument("id or name is required");
      }
      try {
        const c = await client.getComponent({
          id: id ?? "",
          name: name ?? "",
          workspaceId: (args.workspaceId as string | undefined) ?? "",
        });
        const props: Record<string, unknown> = (args.props as Record<string, unknown> | undefined) ?? {};
        const validationErr = propsValidationError(c.propsSchema, props);
        if (validationErr) {
          return invalidArgument(`props do not match the component's propsSchema: ${validationErr}`);
        }
        const kind: string = c.rendererKind || REACT_RENDERER_KIND;
        const descriptor: WidgetRenderDescriptor = {
          rendererKind: kind,
          body: c.body,
          props,
          allowInlineScripts: kind === HTML_RENDERER_KIND,
          allowUnsafeEval: kind === REACT_RENDERER_KIND,
          widgetId: c.id,
          version: c.version,
          resourceUri: `ui://grackle/${c.id}`,
        };
        return renderResult({ rendered: true, id: c.id, name: c.name, version: c.version }, descriptor);
      } catch (error) {
        return grpcErrorToToolResult(error);
      }
    },
  },
  {
    name: "component_show",
    group: "component",
    description:
      "Render a one-off React/JSX component inline in the chat against the Grackle component library (no persistence). Provide `source` as JSX that calls render(<YourComponent {...props}/>) (react-live noInline); `props` supplies the data. `React`, `props`, and Grackle components (e.g. Button, Callout, Spinner) are in scope. Use component_register + component_render to reuse a component across renders.",
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
  {
    name: "widget_show",
    group: "widget",
    description:
      "Render a one-off raw-HTML widget inline in the chat from an inline HTML body, without persisting it. For React/JSX use component_show; for reuse use component_register + component_render.",
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
        rendererKind: HTML_RENDERER_KIND,
        body: args.body as string,
        props: (args.props as Record<string, unknown> | undefined) ?? {},
        allowInlineScripts: true,
        resourceUri: "",
      };
      return renderResult({ rendered: true }, descriptor);
    },
  },
];
