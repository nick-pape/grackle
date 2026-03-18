import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type Client } from "@connectrpc/connect";
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
import type { AuthContext } from "./auth-context.js";
import { authenticateMcpRequest } from "./auth-middleware.js";
import { grpcErrorToToolResult } from "./error-handler.js";
import { pruneRevocations } from "./scoped-token.js";
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
}

/** Create a ConnectRPC client pointing at the co-located Grackle gRPC server. */
function createGrpcClient(bindHost: string, grpcPort: number, apiKey: string): Client<typeof grackle.Grackle> {
  const transport = createGrpcTransport({
    baseUrl: `http://${bindHost}:${grpcPort}`,
    interceptors: [
      (next) => async (req) => {
        req.header.set("Authorization", `Bearer ${apiKey}`);
        return next(req);
      },
    ],
  });
  return createClient(grackle.Grackle, transport);
}

/** Create a low-level MCP Server instance with tool handlers wired to the ConnectRPC backend. */
function createMcpServerInstance(grpcClient: Client<typeof grackle.Grackle>, authContext: AuthContext): Server {
  const registry = createToolRegistry();

  const server = new Server(
    { name: "grackle-mcp", version: PACKAGE_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = listToolsForAuth(registry, authContext);
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: z.toJSONSchema(t.inputSchema),
        annotations: t.annotations,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;
    const tool = resolveToolForAuth(registry, name, authContext);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    // Inject context from scoped token so callers don't need to provide it
    const rawArgs = (args ?? {}) as Record<string, unknown>;
    if (authContext.type === "scoped") {
      rawArgs.projectId = authContext.projectId;
      // Auto-parent subtasks: when an agent creates a task, parent it to the agent's own task
      if (name === "task_create" && authContext.taskId) {
        rawArgs.parentTaskId = authContext.taskId;
      }
      // Enforce project scoping: verify task belongs to the caller's project
      if (name === "task_show" && typeof rawArgs.taskId === "string" && rawArgs.taskId) {
        try {
          const task = await grpcClient.getTask({ id: rawArgs.taskId as string });
          if (task.projectId !== authContext.projectId) {
            return {
              content: [{ type: "text", text: JSON.stringify({ error: "Task belongs to a different project", code: "PERMISSION_DENIED" }, null, 2) }],
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
      const result = await tool.handler(parsed.data as Record<string, unknown>, grpcClient, authContext);
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
  const { bindHost, grpcPort, apiKey, authorizationServerUrl } = options;
  const grpcClient = createGrpcClient(bindHost, grpcPort, apiKey);

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
    if (authorizationServerUrl && url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        resource: requestResourceUrl,
        authorization_servers: [authorizationServerUrl],
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
      await handlePost(req, res, grpcClient, transports, authContexts, authContext);
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
  grpcClient: Client<typeof grackle.Grackle>,
  transports: Map<string, StreamableHTTPServerTransport>,
  authContexts: Map<string, AuthContext>,
  authContext: AuthContext,
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

      const mcpServer = createMcpServerInstance(grpcClient, authContext);
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
