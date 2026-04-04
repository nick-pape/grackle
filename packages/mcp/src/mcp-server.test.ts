/**
 * Tests for MCP session lifecycle — specifically that abandoned sessions
 * are cleaned up when the SSE stream disconnects (#972).
 *
 * Uses a real http.Server from createMcpServer with API-key auth and a
 * dummy gRPC port (no backend needed — API-key auth skips gRPC calls
 * during initialization).
 */
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { createMcpServer } from "./mcp-server.js";

// API key must be exactly 64 hex characters (API_KEY_LENGTH in auth-middleware)
const TEST_API_KEY = "a".repeat(64);

/** Spin up a real MCP server on an ephemeral port. */
function startServer(): Promise<http.Server> {
  const server = createMcpServer({
    bindHost: "127.0.0.1",
    mcpPort: 0,
    grpcPort: 19999, // dummy — no gRPC backend needed for these tests
    apiKey: TEST_API_KEY,
  });
  return new Promise<http.Server>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/** Get the port the server is listening on. */
function port(server: http.Server): number {
  return (server.address() as { port: number }).port;
}

/** Standard MCP headers for POST requests. */
function postHeaders(sessionId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "Authorization": `Bearer ${TEST_API_KEY}`,
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
    headers["mcp-protocol-version"] = "2025-03-26";
  }
  return headers;
}

/** Send an MCP initialize request and return the session ID. */
function initialize(server: http.Server): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: port(server),
        path: "/mcp",
        method: "POST",
        headers: postHeaders(),
      },
      (res) => {
        const sessionId = res.headers["mcp-session-id"] as string | undefined;
        // Consume the response body (SSE stream) — read until stream ends
        res.on("data", () => {});
        res.on("end", () => {
          if (!sessionId) {
            reject(new Error("No session ID in response"));
            return;
          }
          resolve(sessionId);
        });
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Send a POST request to an existing session (e.g. tools/list).
 * Returns the HTTP status code.
 */
function postToSession(
  server: http.Server,
  sessionId: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: port(server),
        path: "/mcp",
        method: "POST",
        headers: postHeaders(sessionId),
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk: Buffer) => { responseBody += chunk.toString(); });
        res.on("end", () => resolve({ status: res.statusCode!, body: responseBody }));
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Open a GET SSE stream for the given session. Returns the request object
 * so the caller can abort it to simulate a client crash.
 */
function openSseStream(
  server: http.Server,
  sessionId: string,
): { req: http.ClientRequest; connected: Promise<void> } {
  let resolveConnected: () => void;
  let rejectConnected: (err: Error) => void;
  const connected = new Promise<void>((resolve, reject) => {
    resolveConnected = resolve;
    rejectConnected = reject;
  });

  const req = http.request({
    hostname: "127.0.0.1",
    port: port(server),
    path: "/mcp",
    method: "GET",
    headers: {
      "Accept": "text/event-stream",
      "Authorization": `Bearer ${TEST_API_KEY}`,
      "mcp-session-id": sessionId,
      "mcp-protocol-version": "2025-03-26",
    },
  }, (res) => {
    if (res.statusCode !== 200) {
      rejectConnected!(new Error(`Unexpected SSE status code: ${res.statusCode}`));
      res.resume();
      return;
    }
    resolveConnected!();
    // Keep consuming data so the stream stays open
    res.on("data", () => {});
    res.on("end", () => {});
  });

  req.on("error", (err: NodeJS.ErrnoException) => {
    // Ignore the expected error when the client aborts the request,
    // but surface all other errors so tests don't hang silently.
    if (err.code === "ECONNRESET") {
      return;
    }
    rejectConnected!(err);
  });

  req.end();

  return { req, connected };
}

/** Poll until a condition is met, with a timeout to avoid hanging. */
async function waitUntil(
  fn: () => Promise<boolean>,
  timeoutMs: number = 2000,
  intervalMs: number = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
}

describe("OAuth Protected Resource Metadata", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => { server!.close(() => resolve()); });
      server = undefined;
    }
  });

  /** Start an MCP server with OAuth enabled (authorizationServerUrl set). */
  function startOAuthServer(): Promise<http.Server> {
    const srv = createMcpServer({
      bindHost: "127.0.0.1",
      mcpPort: 0,
      grpcPort: 19999,
      apiKey: TEST_API_KEY,
      authorizationServerUrl: "http://127.0.0.1:3000",
    });
    return new Promise<http.Server>((resolve) => {
      srv.listen(0, "127.0.0.1", () => resolve(srv));
    });
  }

  /** GET request with a custom Host header. */
  function getMetadata(
    srv: http.Server,
    hostHeader: string,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: port(srv),
          path: "/.well-known/oauth-protected-resource/mcp",
          method: "GET",
          headers: { "Host": hostHeader },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          res.on("end", () => resolve({ status: res.statusCode!, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("derives authorization_servers from request Host header", async () => {
    server = await startOAuthServer();

    const res = await getMetadata(server!, "localhost:7435");

    expect(res.status).toBe(200);
    const metadata = JSON.parse(res.body);
    expect(metadata.authorization_servers).toEqual(["http://localhost:3000"]);
    expect(metadata.resource).toBe("http://localhost:7435");
  });

  it("uses 127.0.0.1 when request arrives via 127.0.0.1", async () => {
    server = await startOAuthServer();

    const res = await getMetadata(server!, "127.0.0.1:7435");

    expect(res.status).toBe(200);
    const metadata = JSON.parse(res.body);
    expect(metadata.authorization_servers).toEqual(["http://127.0.0.1:3000"]);
  });

  it("uses custom hostname (e.g. Docker) when request arrives via that host", async () => {
    server = await startOAuthServer();

    const res = await getMetadata(server!, "grackle:7435");

    expect(res.status).toBe(200);
    const metadata = JSON.parse(res.body);
    expect(metadata.authorization_servers).toEqual(["http://grackle:3000"]);
  });
});

describe("MCP session cleanup on SSE disconnect", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => { server!.close(() => resolve()); });
      server = undefined;
    }
  });

  it("cleans up session when GET SSE stream is aborted", async () => {
    server = await startServer();

    // 1. Initialize a session
    const sessionId = await initialize(server!);
    expect(sessionId).toBeTruthy();

    // 2. Verify session is alive
    const alive = await postToSession(server!, sessionId);
    expect(alive.status).toBe(200);

    // 3. Open SSE stream, then abort it (simulate client crash)
    const sse = openSseStream(server!, sessionId);
    await sse.connected;
    sse.req.destroy();

    // 4. Poll until session is cleaned up (close event propagation)
    await waitUntil(async () => {
      const resp = await postToSession(server!, sessionId);
      return resp.status === 400;
    });

    // 5. Session should be gone — POST with old session ID returns 400
    const dead = await postToSession(server!, sessionId);
    expect(dead.status).toBe(400);
  });

  it("still cleans up session on explicit DELETE", async () => {
    server = await startServer();

    const sessionId = await initialize(server!);

    // Send DELETE
    const deleteResult = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: port(server!),
          path: "/mcp",
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${TEST_API_KEY}`,
            "mcp-session-id": sessionId,
            "mcp-protocol-version": "2025-03-26",
          },
        },
        (res) => {
          res.on("data", () => {});
          res.on("end", () => resolve(res.statusCode!));
        },
      );
      req.on("error", reject);
      req.end();
    });

    expect(deleteResult).toBe(200);

    // Session should be gone
    const dead = await postToSession(server!, sessionId);
    expect(dead.status).toBe(400);
  });

  it("only cleans up the disconnected session, not others", async () => {
    server = await startServer();

    // Initialize two sessions
    const sessionA = await initialize(server!);
    const sessionB = await initialize(server!);

    // Open SSE for session A, then abort it
    const sseA = openSseStream(server!, sessionA);
    await sseA.connected;
    sseA.req.destroy();

    // Poll until session A is cleaned up
    await waitUntil(async () => {
      const resp = await postToSession(server!, sessionA);
      return resp.status === 400;
    });

    // Session A should be gone
    const deadA = await postToSession(server!, sessionA);
    expect(deadA.status).toBe(400);

    // Session B should still work
    const aliveB = await postToSession(server!, sessionB);
    expect(aliveB.status).toBe(200);
  });
});
