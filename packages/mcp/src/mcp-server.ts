import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { grackle, ROOT_TASK_ID, RENDER_TOOL_PREFIX, selectPromotedRenderTools } from "@grackle-ai/common";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  isInitializeRequest,
  McpError,
  ErrorCode,
  type CallToolResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import pino, { type Logger } from "pino";
import { z } from "zod";
import type { AuthContext } from "@grackle-ai/auth";
import { authenticateMcpRequest, pruneRevocations } from "@grackle-ai/auth";
import { grpcErrorToToolResult } from "./error-handler.js";
import type { ToolDefinition, ToolResult, GrackleClients } from "./tool-registry.js";
import { createToolRegistry } from "./tools/index.js";
import { buildComponentRenderResult, propsValidationError } from "./tools/component.js";
import { resolveToolForAuth, listToolsForAuth } from "./tool-scoping.js";
import { createResourceRegistry } from "./resources/index.js";
import { hostSupportsUiApps, uiToolMeta } from "./ui-app.js";
import { WIDGET_RENDER_META_KEY, type WidgetRenderDescriptor } from "./widget-render-meta.js";
import { tryServeWidgetAsset } from "./widget-asset-server.js";

/** Read the package version from package.json at module load time. */
const PACKAGE_VERSION: string = (JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
) as { version: string }).version;

const logger: Logger = pino({
  name: "grackle-mcp",
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV !== "production"
    ? { target: "pino/file", options: { destination: 1 } }
    : undefined,
});

/**
 * Pushes an MCP Apps widget render event into a session's stream. Injected by the
 * server (wraps `@grackle-ai/core`'s `publishWidgetEvent`). Declared structurally
 * to avoid widening this package's runtime dependencies onto core.
 */
export type PublishWidgetEvent = (
  sessionId: string,
  payload: {
    resourceUri: string;
    toolName: string;
    html: string;
    rendererKind?: string;
    csp?: unknown;
    toolInput?: Record<string, unknown>;
    toolResult?: unknown;
    widgetId?: string;
    version?: number;
  },
) => void;

/** Options for creating an MCP server. */
export interface McpServerOptions {
  /** Host address to bind the MCP server to. */
  bindHost: string;
  /** Port for the MCP server to listen on. */
  mcpPort: number;
  /** Port of the co-located gRPC server for backend calls. */
  grpcPort: number;
  /** API key used for authenticating both inbound MCP and outbound gRPC requests. */
  apiKey: string;
  /** Base URL of the OAuth authorization server (web server). When set, enables OAuth discovery. */
  authorizationServerUrl?: string;
  /**
   * Explicit browser-facing MCP origin (GRACKLE_MCP_ORIGIN), e.g.
   * `https://mcp.example.com`. Used as the trusted asset/CSP origin for
   * broker-captured widgets so it never depends on the (spoofable) request
   * `Host` header. When unset, the broker derives it from `bindHost` + `mcpPort`.
   */
  mcpOrigin?: string;
  /** Optional plugin-contributed tool groups to register alongside built-in tools. */
  toolGroups?: ToolDefinition[][];
  /** Push MCP Apps widget render events into session streams (in-process, from the server). */
  publishWidgetEvent?: PublishWidgetEvent;
}

/** Create per-service ConnectRPC clients pointing at the co-located Grackle gRPC server. */
function createGrpcClients(bindHost: string, grpcPort: number, apiKey: string): GrackleClients {
  const transport = createGrpcTransport({
    baseUrl: `http://${bindHost}:${grpcPort}`,
    interceptors: [
      (next) => async (req) => {
        req.header.set("Authorization", `Bearer ${apiKey}`);
        return next(req);
      },
    ],
  });
  return {
    core: createClient(grackle.GrackleCore, transport),
    orchestration: createClient(grackle.GrackleOrchestration, transport),
    scheduling: createClient(grackle.GrackleScheduling, transport),
    knowledge: createClient(grackle.GrackleKnowledge, transport),
  };
}

/**
 * Resolve the persona's allowed MCP tools from the gRPC backend.
 * Returns a ReadonlySet for filtering, or undefined to use the default SCOPED_TOOLS.
 */
async function resolvePersonaTools(
  grpcClients: GrackleClients,
  authContext: AuthContext,
): Promise<ReadonlySet<string> | undefined> {
  if (authContext.type !== "scoped" || !authContext.personaId) {
    return undefined;
  }
  try {
    const persona = await grpcClients.orchestration.getPersona({ id: authContext.personaId });
    if (persona.allowedMcpTools.length > 0) {
      const tools = new Set(persona.allowedMcpTools);
      logger.info(
        { personaId: authContext.personaId, toolCount: tools.size },
        "Resolved persona MCP tools: %d tools",
        tools.size,
      );
      return tools;
    }
  } catch (error) {
    // Fail open to default scoped tools (not full access) on transient errors.
    // This is a security tradeoff: a stricter persona would get broader access,
    // but failing closed would make sessions unusable on transient backend errors.
    // The default scoped set is still significantly restricted vs full access.
    logger.warn(
      { personaId: authContext.personaId, err: error },
      "Failed to resolve persona for tool filtering; falling back to default scoped tools",
    );
  }
  return undefined;
}

/** Create a low-level MCP Server instance with tool handlers wired to the ConnectRPC backend. */
/**
 * Build the JSON Schema for a dynamic `render_<name>` tool's input from a stored
 * component `propsSchema` (#1272). Round-trips through zod so the result is always
 * a valid, normalized JSON Schema; an empty or unparseable schema falls back to a
 * permissive empty object (the props are then validated at call time anyway).
 */
function dynamicRenderInputSchema(propsSchema: string): ReturnType<typeof z.toJSONSchema<z.ZodType>> {
  if (propsSchema) {
    try {
      return z.toJSONSchema(z.fromJSONSchema(JSON.parse(propsSchema) as Parameters<typeof z.fromJSONSchema>[0]));
    } catch {
      // fall through to the permissive schema
    }
  }
  return z.toJSONSchema(z.object({}));
}

async function createMcpServerInstance(
  grpcClients: GrackleClients,
  authContext: AuthContext,
  assetBaseUrl: string,
  brokerAssetOrigin: string,
  publishWidgetEvent: PublishWidgetEvent | undefined,
  toolGroups?: ToolDefinition[][],
): Promise<Server> {
  const registry = createToolRegistry(toolGroups);
  // In broker mode the captured widget's asset/CSP origin must be the trusted,
  // browser-facing MCP origin (config-derived), never the request Host. In
  // standalone mode the direct client reached us on `assetBaseUrl`, so use that.
  const widgetAssetOrigin: string = publishWidgetEvent !== undefined ? brokerAssetOrigin : assetBaseUrl;
  const resourceRegistry = createResourceRegistry(widgetAssetOrigin);

  // Resolve persona-scoped tool set once at session creation (cached for session lifetime)
  const personaAllowedTools = await resolvePersonaTools(grpcClients, authContext);

  const visibleTools = listToolsForAuth(registry, authContext, personaAllowedTools);
  logger.info(
    { authType: authContext.type, toolCount: visibleTools.length },
    "MCP session exposing %d tools",
    visibleTools.length,
  );

  const server = new Server(
    { name: "grackle-mcp", version: PACKAGE_VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  // Pre-compute the visible tool list and names (immutable for this session).
  // UI (MCP Apps) tools carry _meta.ui.resourceUri so a host knows which ui://
  // resource to render.
  const visibleToolDefs = visibleTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(t.inputSchema),
    annotations: t.annotations,
    ...(t.uiResourceUri ? { _meta: uiToolMeta(t.uiResourceUri) } : {}),
  }));
  const visibleToolNames = visibleTools.map((t) => t.name).join(", ");
  /** Names of UI tools — only listed to hosts that can render MCP Apps widgets. */
  const uiToolNames = new Set(visibleTools.filter((t) => t.uiResourceUri).map((t) => t.name));

  /**
   * Broker capture: push a self-contained widget render event into the scoped
   * agent's session stream when a UI tool is invoked. Read in-process (does not
   * rely on the agent SDK preserving `_meta`); non-fatal. Shared by the static
   * tool path and the dynamic `render_<name>` dispatcher (#1272) so they can't drift.
   */
  function captureWidgetRender(
    toolName: string,
    uiResourceUri: string | undefined,
    result: ToolResult,
    toolInput: Record<string, unknown>,
  ): void {
    if (authContext.type !== "scoped" || !publishWidgetEvent) {
      return;
    }
    try {
      const dynamic = result._meta?.[WIDGET_RENDER_META_KEY] as WidgetRenderDescriptor | undefined;
      if (dynamic) {
        // Dynamic, agent-authored render (component_render / component_show /
        // widget_show / render_<name>); grackle-react React runtime (#1268/#1269).
        publishWidgetEvent(authContext.taskSessionId, {
          rendererKind: dynamic.rendererKind || "mcp-app-html",
          resourceUri: dynamic.resourceUri ?? "",
          toolName,
          html: dynamic.body,
          csp: {
            resourceDomains: [widgetAssetOrigin],
            connectDomains: [widgetAssetOrigin],
            allowInlineScripts: dynamic.allowInlineScripts === true,
            allowUnsafeEval: dynamic.allowUnsafeEval === true,
          },
          toolInput: dynamic.props ?? toolInput,
          toolResult: result,
          ...(dynamic.widgetId ? { widgetId: dynamic.widgetId } : {}),
          ...(dynamic.version !== undefined ? { version: dynamic.version } : {}),
        });
      } else if (uiResourceUri) {
        // Static Grackle-served widget (show_hello_widget, T2/T3).
        const resource = resourceRegistry.get(uiResourceUri);
        if (resource) {
          publishWidgetEvent(authContext.taskSessionId, {
            resourceUri: uiResourceUri,
            toolName,
            html: resource.read().text,
            csp: { resourceDomains: [widgetAssetOrigin], connectDomains: [widgetAssetOrigin] },
            toolInput,
            toolResult: result,
          });
        }
      }
    } catch (widgetErr) {
      logger.warn({ tool: toolName, err: widgetErr }, "Widget event capture failed (non-fatal)");
    }
  }

  /**
   * Synthesize the dynamic `render_<name>` tool definitions for the caller's
   * promoted components (#1272). Queried per `tools/list` so promote/demote is
   * reflected on the agent's next listing. Fails open (returns []) so a registry
   * error never breaks `tools/list`. Iterates `updatedAt DESC` (listComponents
   * order); on a slug collision the most-recently-updated component wins — the
   * dispatcher (handleDynamicRender) uses the identical loop so the tool shown is
   * the tool called.
   */
  async function dynamicRenderToolDefs(): Promise<typeof visibleToolDefs> {
    if (authContext.type !== "scoped" || !authContext.workspaceId) {
      return [];
    }
    let components: grackle.Component[];
    try {
      const resp = await grpcClients.orchestration.listComponents({ workspaceId: authContext.workspaceId });
      components = resp.components;
    } catch (err) {
      logger.warn({ workspaceId: authContext.workspaceId, err }, "Failed to list components for dynamic render tools (omitting)");
      return [];
    }
    const defs: typeof visibleToolDefs = [];
    for (const { toolName, component: c } of selectPromotedRenderTools(components)) {
      defs.push({
        name: toolName,
        description: `Render the "${c.name}" component (v${c.version}) inline. Promoted from this workspace's component registry; its inputSchema is the component's prop schema.`,
        inputSchema: dynamicRenderInputSchema(c.propsSchema),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: uiToolMeta(`ui://grackle/${c.id}`),
      });
    }
    return defs;
  }

  /**
   * Dispatch a dynamic `render_<name>` call (#1272). Resolves the promoted
   * component in the caller's workspace (the ownership boundary — only the
   * caller's own workspace is searched, identical to `component_render`), validates
   * props against its prop schema, and renders via the shared helper. Authorized
   * by registry ownership, NOT the static/persona allowlist.
   */
  async function handleDynamicRender(name: string, rawArgs: Record<string, unknown>): Promise<CallToolResult> {
    const unknownTool: CallToolResult = { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    if (authContext.type !== "scoped" || !authContext.workspaceId) {
      return unknownTool;
    }
    let components: grackle.Component[];
    try {
      const resp = await grpcClients.orchestration.listComponents({ workspaceId: authContext.workspaceId });
      components = resp.components;
    } catch (error) {
      return grpcErrorToToolResult(error) as CallToolResult;
    }
    const match = selectPromotedRenderTools(components).find((e) => e.toolName === name)?.component;
    if (!match) {
      return unknownTool;
    }
    const props = rawArgs;
    const validationErr = propsValidationError(match.propsSchema, props);
    if (validationErr) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `props do not match the component's propsSchema: ${validationErr}`, code: "INVALID_ARGUMENT" }, null, 2) }],
        isError: true,
      };
    }
    logger.info({ tool: name, componentId: match.id }, "Executing dynamic render tool: %s", name);
    const result = buildComponentRenderResult(match, props);
    captureWidgetRender(name, undefined, result, props);
    return result as CallToolResult;
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Expose widget tools when EITHER:
    //  (a) the broker is active (publishWidgetEvent injected) — Grackle is itself
    //      the ui-capable host. It captures the widget call and renders it in the
    //      chat, so the agent's own MCP client (a mere conduit here) need not
    //      advertise the io.modelcontextprotocol/ui extension; or
    //  (b) the connecting client advertises that extension — the spec-compliant
    //      path for the standalone MCP server, where the client renders the
    //      widget itself.
    const uiOn = publishWidgetEvent !== undefined || hostSupportsUiApps(server.getClientCapabilities());
    const staticTools = uiOn ? visibleToolDefs : visibleToolDefs.filter((t) => !uiToolNames.has(t.name));
    // Dynamic render_<name> tools render UI, so only offer them when UI is on (#1272).
    const dynamicTools = uiOn ? await dynamicRenderToolDefs() : [];
    return { tools: [...staticTools, ...dynamicTools] };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: resourceRegistry.list().map((r) => ({
        uri: r.uri,
        name: r.name,
        ...(r.description ? { description: r.description } : {}),
        mimeType: r.mimeType,
        ...(r.meta ? { _meta: r.meta } : {}),
      })),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request): Promise<ReadResourceResult> => {
    // Resources are session-global and unscoped in #1237 (a widget shell is not
    // sensitive). Per-session / auth-scoped resources are #1239.
    const resource = resourceRegistry.get(request.params.uri);
    if (!resource) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${request.params.uri}`);
    }
    const { text } = resource.read();
    return {
      contents: [
        {
          uri: resource.uri,
          mimeType: resource.mimeType,
          text,
          ...(resource.meta ? { _meta: resource.meta } : {}),
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;
    // Dynamic render_<name> tools (#1272) are synthesized per workspace and aren't
    // in the registry; dispatch them by registry ownership (NOT the static/persona
    // allowlist) before the normal resolve. The registry.get guard keeps any real
    // static tool taking precedence over the dynamic prefix.
    if (name.startsWith(RENDER_TOOL_PREFIX) && registry.get(name) === undefined) {
      return await handleDynamicRender(name, (args ?? {}) as Record<string, unknown>);
    }
    const tool = resolveToolForAuth(registry, name, authContext, personaAllowedTools);
    if (!tool) {
      // Distinguish "unknown tool" from "not permitted by persona/scope"
      const existsInRegistry = registry.get(name) !== undefined;
      if (!existsInRegistry) {
        logger.warn({ tool: name }, "Unknown tool call: %s", name);
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
      }
      const available = visibleToolNames;
      logger.warn(
        { tool: name, authType: authContext.type, personaId: authContext.type === "scoped" ? authContext.personaId : undefined },
        "Tool call rejected by scope: %s",
        name,
      );
      return {
        content: [{ type: "text", text: `Tool "${name}" is not permitted for this session. Available tools: ${available}` }],
        isError: true,
      };
    }

    // Inject context from scoped token so callers don't need to provide it
    const rawArgs = (args ?? {}) as Record<string, unknown>;
    if (authContext.type === "scoped") {
      if (tool.group === "workspace") {
        // Workspace management tools take an explicit target workspace ID.
        // Root task (global orchestrator) may target any workspace freely.
        // Workspace-bound non-root agents may only manage their own workspace:
        //   - reject cross-workspace calls with PERMISSION_DENIED
        //   - fill in their workspace if none was provided
        const boundWorkspace = authContext.workspaceId;
        if (boundWorkspace && authContext.taskId !== ROOT_TASK_ID) {
          // Only compare when the caller supplied a valid string — non-string or empty
          // values fall through to Zod validation which returns INVALID_ARGUMENT.
          const requestedWorkspaceId =
            typeof rawArgs.workspaceId === "string" && rawArgs.workspaceId
              ? rawArgs.workspaceId
              : undefined;
          if (requestedWorkspaceId !== undefined && requestedWorkspaceId !== boundWorkspace) {
            return {
              content: [{ type: "text", text: JSON.stringify({ error: "workspaceId does not match the authenticated workspace", code: "PERMISSION_DENIED" }, null, 2) }],
              isError: true,
            };
          }
          rawArgs.workspaceId = boundWorkspace;
        }
        // else: root task or unbound caller — leave the caller-supplied workspaceId intact
      } else {
        rawArgs.workspaceId = authContext.workspaceId;
      }
      // Auto-parent subtasks: when an agent creates a task, parent it to the agent's own task
      if (name === "task_create" && authContext.taskId) {
        rawArgs.parentTaskId = authContext.taskId;
      }
      // Enforce workspace scoping: verify task belongs to the caller's workspace.
      // Skip check when caller has no workspace (root task agents can see any task).
      if (name === "task_show" && authContext.workspaceId && typeof rawArgs.taskId === "string" && rawArgs.taskId) {
        try {
          const task = await grpcClients.orchestration.getTask({ id: rawArgs.taskId as string });
          if ((task.workspaceId || undefined) !== authContext.workspaceId) {
            return {
              content: [{ type: "text", text: JSON.stringify({ error: "Task belongs to a different workspace", code: "PERMISSION_DENIED" }, null, 2) }],
              isError: true,
            };
          }
        } catch (error) {
          return grpcErrorToToolResult(error) as CallToolResult;
        }
      }
    }

    // Validate inputs against Zod schema
    const parsed = tool.inputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      );
      logger.warn({ tool: name, issues }, "Input validation failed: %s", name);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { error: "Invalid arguments", code: "INVALID_ARGUMENT", issues },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    try {
      logger.info({ tool: name, resolved: tool.name }, "Executing MCP tool: %s", name);
      const result = await tool.handler(parsed.data as Record<string, unknown>, grpcClients, authContext);
      // MCP Apps: when a session agent invokes a widget tool, push a self-contained
      // widget render event into that session's stream (broker capture — read
      // in-process, does not depend on the agent SDK preserving _meta). Non-fatal.
      captureWidgetRender(tool.name, tool.uiResourceUri, result, parsed.data as Record<string, unknown>);
      return result as CallToolResult;
    } catch (error: unknown) {
      logger.error({ tool: name, err: error }, "Tool execution failed: %s", name);
      try {
        return grpcErrorToToolResult(error) as CallToolResult;
      } catch {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  });

  return server;
}

/** Interval for pruning stale revocation entries (1 hour). */
const REVOCATION_PRUNE_INTERVAL_MS: number = 60 * 60 * 1000;

/**
 * Create an HTTP server that serves the MCP Streamable HTTP protocol on `/mcp`.
 *
 * The server manages stateful sessions — each MCP client gets its own transport
 * and Server instance, tracked by session ID.
 */
export function createMcpServer(options: McpServerOptions): http.Server {
  const { bindHost, mcpPort, grpcPort, apiKey, authorizationServerUrl, toolGroups, publishWidgetEvent, mcpOrigin } = options;
  // Trusted, browser-facing MCP origin for broker-captured widgets (their
  // `<script src>` + CSP allowlist). Derived from server config — NOT the request
  // `Host` header, which a hostile MCP client could spoof to point widget assets
  // / CSP at an attacker origin. Override via GRACKLE_MCP_ORIGIN for
  // reverse-proxy / TLS deployments where loopback isn't browser-reachable.
  const dialableMcpHost: string = bindHost === "0.0.0.0" || bindHost === "::" ? "127.0.0.1" : bindHost;
  const brokerAssetOrigin: string = mcpOrigin ?? `http://${dialableMcpHost}:${mcpPort}`;
  /** Parsed auth server URL, used for dynamic derivation of authorization_servers. */
  const parsedAuthServerUrl = authorizationServerUrl
    ? new URL(authorizationServerUrl)
    : undefined;
  /** Effective port (explicit or protocol default). */
  const authServerPort = parsedAuthServerUrl
    ? (parsedAuthServerUrl.port || (parsedAuthServerUrl.protocol === "https:" ? "443" : "80"))
    : undefined;
  /** Scheme to use for derived auth URLs (preserves https when configured). */
  const authServerScheme = parsedAuthServerUrl?.protocol ?? "http:";
  const grpcClients = createGrpcClients(bindHost, grpcPort, apiKey);

  /** Map of active session transports, keyed by session ID. */
  const transports: Map<string, StreamableHTTPServerTransport> = new Map();

  /** Map of authentication contexts, keyed by MCP session ID. */
  const authContexts: Map<string, AuthContext> = new Map();

  // Periodically prune stale revocation entries
  const pruneInterval = setInterval(() => pruneRevocations(), REVOCATION_PRUNE_INTERVAL_MS);
  pruneInterval.unref();

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    // Derive resource URL from request Host header (dialable by the client)
    const requestResourceUrl = `http://${req.headers.host || url.host}`;

    // OAuth Protected Resource Metadata (RFC 9728) — no auth required
    // Derive auth server URL from request hostname so the browser stays on the
    // same host — avoids CSP form-action 'self' mismatch (localhost vs 127.0.0.1).
    if (authServerPort && url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      const hostPart = url.hostname.includes(":") ? `[${url.hostname}]` : url.hostname;
      const derivedAuthUrl = `${authServerScheme}//${hostPart}:${authServerPort}`;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        resource: requestResourceUrl,
        authorization_servers: [derivedAuthUrl],
      }));
      return;
    }

    // Serve the built-in widget's browser assets (static JS) before the /mcp
    // routing + auth check — an MCP Apps host sandbox fetches these without the
    // API key. They are non-sensitive (the widget shell + the ext-apps App).
    if (req.method?.toUpperCase() === "GET" && tryServeWidgetAsset(url.pathname, res)) {
      return;
    }

    // Only serve the /mcp endpoint
    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    // Auth check on every request
    const authContext = authenticateMcpRequest(req, apiKey);
    if (!authContext) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authorizationServerUrl) {
        headers["WWW-Authenticate"] =
          `Bearer resource_metadata="${requestResourceUrl}/.well-known/oauth-protected-resource/mcp"`;
      }
      res.writeHead(401, headers);
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const method = req.method?.toUpperCase();

    if (method === "POST") {
      await handlePost(req, res, grpcClients, transports, authContexts, authContext, publishWidgetEvent, brokerAssetOrigin, toolGroups);
    } else if (method === "GET") {
      await handleGet(req, res, transports);
    } else if (method === "DELETE") {
      await handleDelete(req, res, transports, authContexts);
    } else {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
    }
  });

  return httpServer;
}

/** Maximum request body size in bytes (1 MB). */
const MAX_BODY_SIZE: number = 1_048_576;

/** Parse the JSON body from an incoming HTTP request with size limit enforcement. */
async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize: number = 0;
    req.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(body);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Resolve the public origin the client reached us on, for embedding into widget
 * asset URLs. Honors `X-Forwarded-Proto` (reverse proxies) and TLS for the
 * scheme, and normalizes the Host header through `URL` so a hostile value cannot
 * inject markup when interpolated into the widget HTML's `<script src>`.
 *
 * @returns A clean `scheme://host[:port]` origin, or `http://localhost` if the
 *   Host header is missing or unparseable.
 */
export function resolveAssetBaseUrl(
  hostHeader: string | undefined,
  forwardedProto: string | string[] | undefined,
  encrypted: boolean,
): string {
  const rawProto: string | undefined = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const proto: string | undefined = rawProto?.split(",")[0]?.trim();
  const scheme: string = proto && proto.length > 0 ? proto : encrypted ? "https" : "http";
  try {
    return new URL(`${scheme}://${hostHeader ?? "localhost"}`).origin;
  } catch {
    return "http://localhost";
  }
}

/** Handle POST requests to /mcp — initialization or tool calls. */
async function handlePost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  grpcClients: GrackleClients,
  transports: Map<string, StreamableHTTPServerTransport>,
  authContexts: Map<string, AuthContext>,
  authContext: AuthContext,
  publishWidgetEvent: PublishWidgetEvent | undefined,
  brokerAssetOrigin: string,
  toolGroups?: ToolDefinition[][],
): Promise<void> {
  try {
    const body = await parseBody(req);
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      // Reject if the auth type changed from the session's initial auth context
      const initialAuth = authContexts.get(sessionId);
      if (initialAuth && initialAuth.type !== authContext.type) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Auth context mismatch for session" }));
        return;
      }

      // Existing session — route to its transport
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, body);
      return;
    }

    if (isInitializeRequest(body) && (!sessionId || !transports.has(sessionId))) {
      // New initialization — create a new transport + server
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          logger.info({ sessionId: sid }, "MCP session initialized");
          transports.set(sid, transport);
          authContexts.set(sid, authContext);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports.has(sid)) {
          logger.info({ sessionId: sid }, "MCP session closed");
          transports.delete(sid);
          authContexts.delete(sid);
        }
      };

      // Asset base URL is the origin the client actually reached us on, so the
      // widget HTML references assets correctly. Normalized via URL parsing to
      // avoid attribute injection from a hostile Host header.
      const encrypted = "encrypted" in req.socket && (req.socket as { encrypted?: boolean }).encrypted === true;
      const assetBaseUrl = resolveAssetBaseUrl(req.headers.host, req.headers["x-forwarded-proto"], encrypted);
      const mcpServer = await createMcpServerInstance(grpcClients, authContext, assetBaseUrl, brokerAssetOrigin, publishWidgetEvent, toolGroups);
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    // Invalid request — no session or not an init request
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: No valid session ID provided" },
      id: null,
    }));
  } catch (error) {
    logger.error({ err: error }, "Error handling MCP POST request");
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      }));
    }
  }
}

/** Handle GET requests to /mcp — SSE streams for server-initiated messages. */
async function handleGet(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  transports: Map<string, StreamableHTTPServerTransport>,
): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid or missing session ID" }));
    return;
  }

  const transport = transports.get(sessionId)!;

  // When the SSE connection drops (client crash/disconnect), close the
  // transport so the existing onclose handler cleans up the session maps.
  res.on("close", () => {
    if (transports.has(sessionId)) {
      logger.info({ sessionId }, "SSE stream closed; cleaning up abandoned session");
      transport.close().catch((error) => {
        logger.warn({ sessionId, err: error }, "Error closing transport for abandoned SSE session");
      });
    }
  });

  await transport.handleRequest(req, res);
}

/** Handle DELETE requests to /mcp — session termination. */
async function handleDelete(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  transports: Map<string, StreamableHTTPServerTransport>,
  authContexts: Map<string, AuthContext>,
): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid or missing session ID" }));
    return;
  }

  const transport = transports.get(sessionId)!;
  try {
    await transport.handleRequest(req, res);
    authContexts.delete(sessionId);
  } catch (error) {
    logger.error({ err: error }, "Error handling session termination");
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Error processing session termination" }));
    }
  }
}
