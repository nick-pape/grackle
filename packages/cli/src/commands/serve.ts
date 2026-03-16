import type { Command } from "commander";

/** Register the `serve` command that starts the Grackle server and web UI. */
export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the Grackle server")
    .option("--port <port>", "Server port", "7434")
    .option("--web-port <port>", "Web UI port", "3000")
    .option("--mcp-port <port>", "MCP server port", "7435")
    .option("--no-open", "Do not auto-open the browser on startup")
    .action(async (opts: { port: string; webPort: string; mcpPort: string; open: boolean }) => {
      process.env.GRACKLE_PORT = opts.port;
      process.env.GRACKLE_WEB_PORT = opts.webPort;
      process.env.GRACKLE_MCP_PORT = opts.mcpPort;
      process.env.GRACKLE_HOST = "0.0.0.0";

      if (!opts.open) {
        process.env.GRACKLE_NO_OPEN = "1";
      }

      console.log(`Starting Grackle server...`);
      console.log(`gRPC on port ${opts.port}, Web UI on port ${opts.webPort}, MCP on port ${opts.mcpPort}`);

      // Dynamic import to start the server
      await import("@grackle-ai/server");
    });
}
