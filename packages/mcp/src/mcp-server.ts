import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { grackle } from "@grackle-ai/common";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  isInitializeRequest,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import pino, { type Logger } from "pino";
import { z } from "zod";
import type { AuthContext } from "@grackle-ai/auth";
import { authenticateMcpRequest, pruneRevocations } from "@grackle-ai/auth";
import { grpcErrorToToolResult } from "./error-handler.js";
import type { ToolDefinition, GrackleClients } from "./tool-registry.js";
import { createToolRegistry } from "./tools/index.js";
import { resolveToolForAuth, listToolsForAuth } from "./tool-scoping.js";

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
  /** Optional plugin-contributed tool groups to register alongside built-in tools. */
  toolGroups?: ToolDefinition[][];
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
async function createMcpServerInstance(
  grpcClients: GrackleClients,
  authContext: AuthContext,
  toolGroups?: ToolDefinition[][],
): Promise<Server> {
  const registry = createToolRegistry(toolGroups);

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
    { capabilities: { tools: {} } },
  );

  // Pre-compute the visible tool list and names (immutable for this session)
  const visibleToolDefs = visibleTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(t.inputSchema),
    annotations: t.annotations,
  }));
  const visibleToolNames = visibleTools.map((t) => t.name).join(", ");

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: visibleToolDefs };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;
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
      rawArgs.workspaceId = authContext.workspaceId;
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
  const { bindHost, grpcPort, apiKey, authorizationServerUrl, toolGroups } = options;
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
      await handlePost(req, res, grpcClients, transports, authContexts, authContext, toolGroups);
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

/** Handle POST requests to /mcp — initialization or tool calls. */
async function handlePost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  grpcClients: GrackleClients,
  transports: Map<string, StreamableHTTPServerTransport>,
  authContexts: Map<string, AuthContext>,
  authContext: AuthContext,
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

      const mcpServer = await createMcpServerInstance(grpcClients, authContext, toolGroups);
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
