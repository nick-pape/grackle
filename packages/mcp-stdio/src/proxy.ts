import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

const esmRequire: NodeRequire = createRequire(import.meta.url);
const { version } = esmRequire("../package.json") as { version: string };

/** Default MCP HTTP endpoint when GRACKLE_URL is not set. */
const DEFAULT_GRACKLE_URL: string = "http://127.0.0.1:7435/mcp";

/** Create a fresh upstream transport pointing at the Grackle HTTP MCP server. */
export function newTransport(grackleUrl: string, apiKey: string): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(new URL(grackleUrl), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
  });
}

/** Create and connect a new upstream MCP client. */
function connect(grackleUrl: string, apiKey: string): Promise<Client> {
  const c = new Client(
    { name: "grackle-mcp-stdio", version },
    { capabilities: {} },
  );
  return c.connect(newTransport(grackleUrl, apiKey)).then(() => c);
}

/** Manages the upstream client as a promise to avoid async assignment races. */
export interface ClientManager {
  getClient: () => Promise<Client>;
  resetClient: () => void;
}

/** Create a ClientManager that lazily connects and reconnects on demand. */
export function createClientManager(grackleUrl: string, apiKey: string): ClientManager {
  let upstreamPromise: Promise<Client> | undefined;

  function getClient(): Promise<Client> {
    if (!upstreamPromise) {
      // Assign synchronously so concurrent callers share the same promise.
      // On failure, clear so the next call retries.
      upstreamPromise = connect(grackleUrl, apiKey).catch((err: unknown) => {
        upstreamPromise = undefined;
        throw err;
      });
    }
    return upstreamPromise;
  }

  function resetClient(): void {
    const old = upstreamPromise;
    upstreamPromise = undefined;
    old?.then((c) => c.close()).catch(() => { /* ignore close errors */ });
  }

  return { getClient, resetClient };
}

/**
 * Call `fn` with the upstream client, reconnecting once on any error.
 * Exported for testability.
 */
export async function withReconnect<T>(
  manager: ClientManager,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  try {
    return await fn(await manager.getClient());
  } catch (err) {
    process.stderr.write(`Reconnecting upstream: ${(err as Error).message}\n`);
    manager.resetClient();
    return fn(await manager.getClient());
  }
}

/** Create the stdio MCP server that proxies all requests to the Grackle HTTP MCP server. */
export function createProxyServer(grackleUrl: string, apiKey: string): Server {
  const manager = createClientManager(grackleUrl, apiKey);

  const server = new Server(
    { name: "grackle-mcp-stdio", version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = await withReconnect(manager, (c) => c.listTools());
    return { tools: result.tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const { name, arguments: args } = req.params;
    return withReconnect(
      manager,
      (c) => c.callTool({ name, arguments: args }),
    ) as Promise<CallToolResult>;
  });

  return server;
}

/** Start the proxy: connect upstream, then attach to stdio and serve. */
export async function main(): Promise<void> {
  const grackleUrl = process.env.GRACKLE_URL ?? DEFAULT_GRACKLE_URL;
  const apiKey = process.env.GRACKLE_API_KEY;
  if (!apiKey) {
    process.stderr.write("ERROR: GRACKLE_API_KEY is not set\n");
    process.exit(1);
  }

  const server = createProxyServer(grackleUrl, apiKey);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`grackle-mcp-stdio ready (upstream: ${grackleUrl})\n`);

  function shutdown(): void {
    process.exit(0);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
