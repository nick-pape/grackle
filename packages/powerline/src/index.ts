import { Command } from "commander";
import http from "node:http";
import { mountAhpServer } from "./ahp-handlers.js";
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
    .option("--port <port>", "Port to listen on", String(DEFAULT_POWERLINE_PORT))
    .option("--token <token>", "Authentication token")
    .option("--no-auth", "Run without authentication (development only)")
    .option("--host <host>", "Host to bind to", "127.0.0.1")
    .action((opts: { port: string; token?: string; auth: boolean; host: string }) => {
      const port = parseInt(opts.port, 10);
      const host = opts.host;
      const powerlineToken = opts.auth
        ? opts.token || process.env.GRACKLE_POWERLINE_TOKEN || ""
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
      registerRuntime(
        new AcpRuntime({ name: "copilot-acp", command: "copilot", args: ["--acp", "--stdio"] }),
      );
      registerRuntime(
        new AcpRuntime({
          name: "claude-code-acp",
          command: "claude-agent-acp",
          args: [],
          // Isolate from ~/.claude so interactive-only settings (e.g.
          // permissions.defaultMode "auto") don't crash session/new (#1366).
          isolateClaudeConfig: true,
        }),
      );

      // HR8d: PowerLine speaks AHP JSON-RPC over WebSocket (not gRPC).
      // AhpServerSocket handles the HTTP upgrade and Bearer-token auth.
      const server = http.createServer((req, res) => {
        // Health probe — no auth, bypasses AHP entirely.
        if (req.url === "/healthz") {
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }
        // Anything else hitting the HTTP path (not WS) gets 404 — the AHP
        // wire is WS-only on /ahp.
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found — AHP WebSocket endpoint is /ahp");
      });

      const ahp = mountAhpServer({ server, powerlineToken });

      server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          logger.fatal({ port }, "Port %d is already in use. Is another PowerLine running?", port);
        } else {
          logger.fatal({ err }, "PowerLine server error");
        }
        process.exitCode = 1;
        shutdown();
      });

      server.listen(port, host, () => {
        const authStatus = powerlineToken ? "authenticated" : "NO AUTH (development only)";
        logger.info(
          { port, host, authStatus },
          "PowerLine listening on ws://%s:%d/ahp [%s]",
          host,
          port,
          authStatus,
        );
      });

      // Graceful shutdown: always attempt server.close() regardless of
      // whether the AHP teardown succeeded — otherwise an AHP-close error
      // would skip HTTP teardown and abruptly exit.
      function shutdown(): void {
        logger.info("Shutting down PowerLine...");
        let ahpErr: unknown;
        ahp
          .close()
          .catch((err: unknown) => {
            ahpErr = err;
            logger.error({ err }, "AHP teardown failed");
          })
          .finally(() => {
            server.close(() => {
              process.exit(ahpErr !== undefined ? 1 : process.exitCode || 0);
            });
          });
      }

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });

  program.parse();
}

main();
