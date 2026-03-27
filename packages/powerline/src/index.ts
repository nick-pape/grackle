import { Command } from "commander";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { ConnectError, Code, type Interceptor } from "@connectrpc/connect";
import http2 from "node:http2";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { registerPowerLineRoutes } from "./grpc-server.js";
import { registerRuntime } from "./runtime-registry.js";
import { StubRuntime } from "./runtimes/stub.js";
import { StubMcpRuntime } from "./runtimes/stub-mcp.js";
import { GenAIScriptRuntime } from "@grackle-ai/runtime-genaiscript";
import { ClaudeCodeRuntime } from "@grackle-ai/runtime-claude-code";
import { CopilotRuntime } from "@grackle-ai/runtime-copilot";
import { CodexRuntime } from "@grackle-ai/runtime-codex";
import { AcpRuntime } from "@grackle-ai/runtime-acp";
import { DEFAULT_POWERLINE_PORT } from "@grackle-ai/common";
import { createRequire } from "node:module";
import { logger } from "./logger.js";
import { runWithTrace } from "./trace-context.js";

const esmRequire: NodeRequire = createRequire(import.meta.url);
const { version } = esmRequire("../package.json") as { version: string };

// The PowerLine is an independent service, not a nested Claude Code session.
// Clear the nesting guard so agent subprocesses (spawned via the SDK) don't
// refuse to start when the PowerLine happens to be launched from within
// a Claude Code session (e.g. during development or local testing).
delete process.env.CLAUDECODE;

function main(): void {
  const program = new Command();

  program
    .name("grackle-powerline")
    .description("Grackle PowerLine agent runtime")
    .version(version)
    .option(
      "--port <port>",
      "Port to listen on",
      String(DEFAULT_POWERLINE_PORT),
    )
    .option("--token <token>", "Authentication token")
    .option("--no-auth", "Run without authentication (development only)")
    .option("--host <host>", "Host to bind to", "127.0.0.1")
    .action((opts: { port: string; token?: string; auth: boolean; host: string }) => {
      const port = parseInt(opts.port, 10);
      const host = opts.host;
      const powerlineToken = opts.auth
        ? (opts.token || process.env.GRACKLE_POWERLINE_TOKEN || "")
        : "";

      if (!powerlineToken && opts.auth) {
        logger.fatal(
          "No authentication token provided. Set --token, GRACKLE_POWERLINE_TOKEN, or pass --no-auth for development.",
        );
        process.exitCode = 1;
        return;
      }

      // Register runtimes
      registerRuntime(new StubRuntime());
      registerRuntime(new StubMcpRuntime());
      registerRuntime(new GenAIScriptRuntime());
      registerRuntime(new ClaudeCodeRuntime());
      registerRuntime(new CopilotRuntime());
      registerRuntime(new CodexRuntime());
      registerRuntime(new AcpRuntime({ name: "goose", command: "goose", args: ["acp"] }));
      registerRuntime(new AcpRuntime({ name: "codex-acp", command: "codex-acp", args: [] }));
      registerRuntime(new AcpRuntime({ name: "copilot-acp", command: "copilot", args: ["--acp", "--stdio"] }));
      registerRuntime(new AcpRuntime({ name: "claude-code-acp", command: "claude-agent-acp", args: [] }));

      // Start HTTP/2 server with optional auth
      const interceptors: Interceptor[] = [
        // Trace ID interceptor: extract or generate a trace ID for request correlation.
        (next) => (req) => {
          const traceId = req.header.get("x-trace-id") || randomUUID();
          return runWithTrace(traceId, () => next(req));
        },
      ];

      if (powerlineToken) {
        interceptors.push(
          (next) => async (req) => {
            const authHeader = req.header.get("authorization") || "";
            const token = authHeader.replace(/^Bearer\s+/i, "");
            const a = Buffer.from(token);
            const b = Buffer.from(powerlineToken);
            if (a.length !== b.length || !timingSafeEqual(a, b)) {
              throw new ConnectError("Unauthorized", Code.Unauthenticated);
            }
            return next(req);
          },
        );
      }

      const handler = connectNodeAdapter({
        routes: registerPowerLineRoutes,
        interceptors,
      });

      const server = http2.createServer((req, res) => {
        // Health probe — no auth, bypasses ConnectRPC
        if (req.url === "/healthz") {
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }
        // All other requests go through ConnectRPC (gRPC)
        handler(req, res);
      });

      server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          logger.fatal(
            { port },
            "Port %d is already in use. Is another PowerLine running?",
            port,
          );
        } else {
          logger.fatal({ err }, "PowerLine server error");
        }
        process.exitCode = 1;
        shutdown();
      });

      server.listen(port, host, () => {
        const authStatus = powerlineToken
          ? "authenticated"
          : "NO AUTH (development only)";
        logger.info(
          { port, host, authStatus },
          "PowerLine listening on http://%s:%d [%s]",
          host,
          port,
          authStatus,
        );
      });

      // Graceful shutdown
      function shutdown(): void {
        logger.info("Shutting down PowerLine...");
        server.close(() => {
          process.exit(process.exitCode || 0);
        });
      }

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });

  program.parse();
}

main();
