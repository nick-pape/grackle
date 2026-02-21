import { Command } from "commander";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { ConnectError, Code } from "@connectrpc/connect";
import http2 from "node:http2";
import { registerSidecarRoutes } from "./grpc-server.js";
import { registerRuntime } from "./runtime-registry.js";
import { StubRuntime } from "./runtimes/stub.js";
import { ClaudeCodeRuntime } from "./runtimes/claude-code.js";
import { DEFAULT_SIDECAR_PORT } from "@grackle/common";
import { logger } from "./logger.js";

function main(): void {
  const program = new Command();

  program
    .name("grackle-sidecar")
    .description("Grackle sidecar agent runtime")
    .version("0.0.1")
    .option("--port <port>", "Port to listen on", String(DEFAULT_SIDECAR_PORT))
    .option("--token <token>", "Authentication token")
    .action((opts: { port: string; token?: string }) => {
      const port = parseInt(opts.port, 10);
      const sidecarToken = opts.token || process.env.GRACKLE_SIDECAR_TOKEN || "";

      // Register runtimes
      registerRuntime(new StubRuntime());
      registerRuntime(new ClaudeCodeRuntime());

      // Start HTTP/2 server with optional auth
      const handler = connectNodeAdapter({
        routes: registerSidecarRoutes,
        interceptors: sidecarToken
          ? [
              (next) => async (req) => {
                const authHeader = req.header.get("authorization") || "";
                const token = authHeader.replace(/^Bearer\s+/i, "");
                if (token !== sidecarToken) {
                  throw new ConnectError("Unauthorized", Code.Unauthenticated);
                }
                return next(req);
              },
            ]
          : [],
      });

      const server = http2.createServer(handler);

      server.listen(port, () => {
        const authStatus = sidecarToken ? "authenticated" : "NO AUTH (development only)";
        logger.info({ port, authStatus }, "Sidecar listening on http://localhost:%d [%s]", port, authStatus);
      });

      // Graceful shutdown
      function shutdown(): void {
        logger.info("Shutting down sidecar...");
        server.close();
        process.exit(0);
      }

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });

  program.parse();
}

main();
