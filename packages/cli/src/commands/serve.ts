import type { Command } from "commander";

/** Register the `serve` command that starts the Grackle server and web UI. */
export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the Grackle server")
    .option("--port <port>", "Server port", "7434")
    .option("--web-port <port>", "Web UI port", "3000")
    .option("--mcp-port <port>", "MCP server port", "7435")
    .option("--powerline-port <port>", "Local PowerLine port", "7433")
    .option("--allow-network", "Bind to all interfaces (0.0.0.0) for LAN access")
    .action(async (opts: { port: string; webPort: string; mcpPort: string; powerlinePort: string; allowNetwork: boolean }) => {
      process.env.GRACKLE_PORT = opts.port;
      process.env.GRACKLE_WEB_PORT = opts.webPort;
      process.env.GRACKLE_MCP_PORT = opts.mcpPort;
      process.env.GRACKLE_POWERLINE_PORT = opts.powerlinePort;
      process.env.GRACKLE_HOST = opts.allowNetwork ? "0.0.0.0" : "127.0.0.1";

      console.log(`Starting Grackle server...`);
      console.log(`gRPC on port ${opts.port}, Web UI on port ${opts.webPort}, MCP on port ${opts.mcpPort}, PowerLine on port ${opts.powerlinePort}`);
      if (opts.allowNetwork) {
        console.log("Network access enabled — binding to all interfaces");
      }

      // Dynamic import to start the server
      await import("@grackle-ai/server");
    });
}
