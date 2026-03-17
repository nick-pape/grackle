// Workaround: @github/copilot-sdk imports "vscode-jsonrpc/node" without .js
// extension, which fails in Node 22 strict ESM resolution. Register a module
// resolve hook to fix it before any SDK imports occur.
import { register } from "node:module";
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s,c,n){return s==="vscode-jsonrpc/node"?n("vscode-jsonrpc/node.js",c):n(s,c);}`,
    ),
);

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
import { AcpRuntime } from "./runtimes/acp.js";
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
    .option(
      "--port <port>",
      "Port to listen on",
      String(DEFAULT_POWERLINE_PORT),
    )
    .option("--token <token>", "Authentication token")
    .option("--host <host>", "Host to bind to", "127.0.0.1")
    .action((opts: { port: string; token?: string; host: string }) => {
      const port = parseInt(opts.port, 10);
      const host = opts.host;
      const powerlineToken =
        opts.token || process.env.GRACKLE_POWERLINE_TOKEN || "";

      // Register runtimes
      registerRuntime(new StubRuntime());
      registerRuntime(new ClaudeCodeRuntime());
      registerRuntime(new CopilotRuntime());
      registerRuntime(new CodexRuntime());
      registerRuntime(new AcpRuntime({ name: "codex-acp", command: "codex", args: ["--acp"] }));
      registerRuntime(new AcpRuntime({ name: "copilot-acp", command: "copilot", args: ["--acp"] }));
      registerRuntime(new AcpRuntime({ name: "claude-code-acp", command: "claude", args: ["--acp"] }));

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
