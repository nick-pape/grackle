import { Command } from "commander";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { ConnectError, Code } from "@connectrpc/connect";
import http2 from "node:http2";
import { timingSafeEqual } from "node:crypto";
import { registerPowerLineRoutes } from "./grpc-server.js";
import { registerRuntime } from "./runtime-registry.js";
import { StubRuntime } from "./runtimes/stub.js";
import { ClaudeCodeRuntime } from "./runtimes/claude-code.js";
import { CopilotRuntime } from "./runtimes/copilot.js";
import { CodexRuntime } from "./runtimes/codex.js";
import { DEFAULT_POWERLINE_PORT } from "@grackle-ai/common";
import { createRequire } from "node:module";
import { logger } from "./logger.js";

const esmRequire: NodeRequire = createRequire(import.meta.url);
const { version } = esmRequire("../package.json") as { version: string };

function main(): void {
  const program = new Command();

  program
    .name("grackle-powerline")
    .description("Grackle PowerLine agent runtime")
    .version(version)
    .option("--port <port>", "Port to listen on", String(DEFAULT_POWERLINE_PORT))
    .option("--token <token>", "Authentication token")
    .action((opts: { port: string; token?: string }) => {
      const port = parseInt(opts.port, 10);
      const powerlineToken = opts.token || process.env.GRACKLE_POWERLINE_TOKEN || "";

      // Register runtimes
      registerRuntime(new StubRuntime());
      registerRuntime(new ClaudeCodeRuntime());
      registerRuntime(new CopilotRuntime());
      registerRuntime(new CodexRuntime());

      // Start HTTP/2 server with optional auth
      const handler = connectNodeAdapter({
        routes: registerPowerLineRoutes,
        interceptors: powerlineToken
          ? [
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
            ]
          : [],
      });

      const server = http2.createServer(handler);

      server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          logger.fatal({ port }, "Port %d is already in use. Is another PowerLine running?", port);
          process.exit(1);
        }
        logger.fatal({ err }, "PowerLine server error");
        process.exit(1);
      });

      server.listen(port, () => {
        const authStatus = powerlineToken ? "authenticated" : "NO AUTH (development only)";
        logger.info({ port, authStatus }, "PowerLine listening on http://localhost:%d [%s]", port, authStatus);
      });

      // Graceful shutdown
      function shutdown(): void {
        logger.info("Shutting down PowerLine...");
        server.close();
        process.exit(0);
      }

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });

  program.parse();
}

main();
