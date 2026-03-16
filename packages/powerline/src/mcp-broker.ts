import { randomUUID } from "node:crypto";
import http from "node:http";
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
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  createToolRegistry,
  authenticateMcpRequest,
  type AuthContext,
  type ToolDefinition,
  type ToolRegistry,
} from "@grackle-ai/mcp";
import { logger } from "./logger.js";

/** Options for starting the MCP broker. */
export interface McpBrokerOptions {
  /** Host to bind the HTTP server to (loopback). */
  bindHost: string;
  /** gRPC URL of the Grackle server. */
  grpcUrl: string;
  /** API key for gRPC auth and scoped token signing. */
  apiKey: string;
}

/** Handle returned after broker startup. */
export interface McpBrokerHandle {
  /** Dynamic port assigned by the OS. */
  port: number;
  /** Full URL of the broker's /mcp endpoint. */
  url: string;
  /** API key for scoped token signing. */
  apiKey: string;
  /** Shut down the HTTP server. */
  close(): Promise<void>;
}

// ─── Tool scoping ───────────────────────────────────────────

/** Tools exposed to scoped-token (agent) callers. Matches the old stdio stub's surface area. */
const BROKER_TOOLS: ReadonlySet<string> = new Set([
  "finding_post", "finding_list", "task_create",
]);

/** Old stub tool names aliased to new registry names for backward compatibility. */
const ALIASES: ReadonlyMap<string, string> = new Map([
  ["post_finding", "finding_post"],
  ["query_findings", "finding_list"],
]);

/** Resolve a tool by name, handling aliases and scope checks. */
function getToolWithAlias(
  registry: ToolRegistry,
  name: string,
  authContext: AuthContext,
): ToolDefinition | undefined {
  const resolved = registry.get(name) ?? registry.get(ALIASES.get(name) ?? "");
  if (!resolved) {
    return undefined;
  }
  // Scoped tokens only see BROKER_TOOLS; API key auth sees everything
  if (authContext.type === "scoped" && !BROKER_TOOLS.has(resolved.name)) {
    return undefined;
  }
  return resolved;
}

/** List tools visible to the given auth context, including aliases for discoverability. */
function listToolsForAuth(registry: ToolRegistry, authContext: AuthContext): ToolDefinition[] {
  if (authContext.type === "api-key") {
    return registry.list();
  }
  // Scoped: return BROKER_TOOLS under their canonical names
  const tools = registry.list((t) => BROKER_TOOLS.has(t.name));
  // Also include alias entries so agents using old names can discover them
  const aliasEntries: ToolDefinition[] = [];
  for (const [alias, canonical] of ALIASES) {
    const tool = registry.get(canonical);
    if (tool && BROKER_TOOLS.has(canonical)) {
      aliasEntries.push({ ...tool, name: alias });
    }
  }
  return [...tools, ...aliasEntries];
}

// ─── gRPC client factory ────────────────────────────────────

/** Create a ConnectRPC client pointing at the Grackle gRPC server. */
function createGrpcClient(grpcUrl: string, apiKey: string): Client<typeof grackle.Grackle> {
  const transport = createGrpcTransport({
    baseUrl: grpcUrl,
    interceptors: [
      (next) => async (req) => {
        req.header.set("Authorization", `Bearer ${apiKey}`);
        return next(req);
      },
    ],
  });
  return createClient(grackle.Grackle, transport);
}

// ─── MCP server instance factory ────────────────────────────

/** Maximum request body size in bytes (1 MB). */
const MAX_BODY_SIZE: number = 1_048_576;

/** Parse the JSON body from an incoming HTTP request with size limit enforcement. */
async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize: number = 0;
    let destroyed: boolean = false;
    req.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE && !destroyed) {
        destroyed = true;
        reject(new Error("Request body too large"));
        req.resume(); // drain remaining data
        return;
      }
      if (!destroyed) {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      if (destroyed) {
        return;
      }
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

/** Create an MCP Server instance with tool handlers wired to the gRPC backend. */
function createMcpServerInstance(
  grpcClient: Client<typeof grackle.Grackle>,
  registry: ToolRegistry,
  authContext: AuthContext,
): Server {
  const server = new Server(
    { name: "grackle-powerline-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = listToolsForAuth(registry, authContext);
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: zodToJsonSchema(t.inputSchema, { target: "jsonSchema7" }),
        annotations: t.annotations,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;
    const tool = getToolWithAlias(registry, name, authContext);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    // Validate inputs
    const parsed = tool.inputSchema.safeParse(args ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ error: "Invalid arguments", code: "INVALID_ARGUMENT", issues }, null, 2),
        }],
        isError: true,
      };
    }

    try {
      logger.info({ tool: name, resolved: tool.name }, "MCP broker: executing tool");

      // Enforce claim-based scoping: override projectId/taskId from the scoped token
      // to prevent cross-project access (the broker authenticates to gRPC with the server API key).
      const scopedArgs = parsed.data as Record<string, unknown>;
      if (authContext.type === "scoped") {
        if ("projectId" in scopedArgs) {
          scopedArgs.projectId = authContext.projectId;
        }
      }

      const result = await tool.handler(scopedArgs, grpcClient, authContext);

      // Note: we intentionally do NOT emit finding/subtask_create AgentEvents here.
      // The gRPC handlers (postFinding, createTask) already persist data and broadcast
      // via WebSocket. Emitting events would cause double-writes because the server's
      // event processor also intercepts those event types from the PowerLine stream.

      return result as CallToolResult;
    } catch (error: unknown) {
      logger.error({ tool: name, err: error }, "MCP broker: tool execution failed");
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ─── Singleton broker ───────────────────────────────────────

/** Module-level handle for the singleton broker instance. */
let brokerHandle: McpBrokerHandle | undefined;

/**
 * Start the MCP broker HTTP server on a dynamic loopback port.
 *
 * Listens on port 0 (OS-assigned) to avoid port conflicts.
 * Serves the Streamable HTTP MCP protocol on `/mcp`.
 *
 * Note: The `grpcUrl` must be reachable from the PowerLine process. For local/SSH
 * environments this is loopback; for Docker/Codespace environments the server's adapter
 * layer provides connectivity (port forwarding, tunnels). Expanding reachability is
 * handled at the adapter level, not here.
 */
export async function startMcpBroker(options: McpBrokerOptions): Promise<McpBrokerHandle> {
  const { bindHost, grpcUrl, apiKey } = options;
  const grpcClient = createGrpcClient(grpcUrl, apiKey);
  const registry = createToolRegistry();

  /** Active transports keyed by MCP session ID. */
  const transports: Map<string, StreamableHTTPServerTransport> = new Map();
  /** Auth contexts keyed by MCP session ID — used to reject session hijack attempts. */
  const authContexts: Map<string, AuthContext> = new Map();

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    // Auth check
    const authContext = authenticateMcpRequest(req, apiKey);
    if (!authContext) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const method = req.method?.toUpperCase();

    if (method === "POST") {
      let body: unknown;
      try {
        body = await parseBody(req);
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : "Bad request";
        const statusCode = message === "Request body too large" ? 413 : 400;
        if (!res.headersSent) {
          res.writeHead(statusCode, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32700, message },
            id: null,
          }));
        }
        return;
      }

      try {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        if (sessionId && transports.has(sessionId)) {
          // Reject if the auth type changed from the session's initial auth context
          const initialAuth = authContexts.get(sessionId);
          if (initialAuth && initialAuth.type !== authContext.type) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Auth context mismatch for session" }));
            return;
          }
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res, body);
          return;
        }

        if (isInitializeRequest(body) && (!sessionId || !transports.has(sessionId))) {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid: string) => {
              logger.info({ sessionId: sid }, "MCP broker: session initialized");
              transports.set(sid, transport);
              authContexts.set(sid, authContext);
            },
          });

          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && transports.has(sid)) {
              transports.delete(sid);
              authContexts.delete(sid);
            }
          };

          const mcpServer = createMcpServerInstance(grpcClient, registry, authContext);
          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, body);
          return;
        }

        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
          id: null,
        }));
      } catch (error) {
        logger.error({ err: error }, "MCP broker: error handling POST");
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          }));
        }
      }
    } else if (method === "GET") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !transports.has(sessionId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or missing session ID" }));
        return;
      }
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    } else if (method === "DELETE") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !transports.has(sessionId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or missing session ID" }));
        return;
      }
      const transport = transports.get(sessionId)!;
      try {
        await transport.handleRequest(req, res);
      } catch (error) {
        logger.error({ err: error }, "MCP broker: error handling DELETE");
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Error processing session termination" }));
        }
      }
    } else {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
    }
  });

  return new Promise<McpBrokerHandle>((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(0, bindHost, () => {
      const addr = httpServer.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get broker address"));
        return;
      }
      const port = addr.port;
      const urlHost = bindHost.includes(":") ? `[${bindHost}]` : bindHost;
      const url = `http://${urlHost}:${port}/mcp`;
      logger.info({ port, url }, "MCP broker listening");
      resolve({
        port,
        url,
        apiKey,
        close: async () => {
          for (const transport of transports.values()) {
            try {
              await transport.close();
            } catch { /* best-effort */ }
          }
          transports.clear();
          return new Promise<void>((resolve) => {
            httpServer.close(() => resolve());
          });
        },
      });
    });
  });
}

/** In-flight startup promise to prevent duplicate starts. */
let brokerStarting: Promise<McpBrokerHandle> | undefined;

/**
 * Ensure the singleton broker is started. Returns the handle.
 *
 * If already running, returns the existing handle immediately.
 * Called lazily on first Spawn() that provides credentials.
 */
export function ensureBrokerStarted(apiKey: string, grpcUrl: string): Promise<McpBrokerHandle> {
  if (brokerHandle) {
    return Promise.resolve(brokerHandle);
  }
  if (brokerStarting) {
    return brokerStarting;
  }
  const promise = startMcpBroker({
    bindHost: "127.0.0.1",
    grpcUrl,
    apiKey,
  }).then((handle) => {
    brokerHandle = handle;
    brokerStarting = undefined;
    return handle;
  }).catch((err: unknown) => {
    // Clear in-flight promise so subsequent calls can retry
    brokerStarting = undefined;
    throw err;
  });
  brokerStarting = promise;
  return promise;
}

/**
 * Shut down the singleton broker. Called during graceful shutdown.
 */
export async function shutdownBroker(): Promise<void> {
  const handle = brokerHandle;
  if (handle) {
    brokerHandle = undefined;
    await handle.close();
  }
}

/**
 * Reset the singleton broker state. Intended for testing only.
 * @internal
 */
export function resetBrokerHandle(): void {
  brokerHandle = undefined;
  brokerStarting = undefined;
}
