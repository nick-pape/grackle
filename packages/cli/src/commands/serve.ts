import type { Command } from "commander";

/** Register the `serve` command that starts the Grackle server and web UI. */
export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the Grackle server")
    .option("--port <port>", "Server port", "7434")
    .option("--web-port <port>", "Web UI port", "3000")
    .action(async (opts) => {
      process.env.GRACKLE_PORT = opts.port;
      process.env.GRACKLE_WEB_PORT = opts.webPort;

      console.log(`Starting Grackle server on port ${opts.port}...`);
      console.log(`Web UI will be available at http://localhost:${opts.webPort}`);

      // Dynamic import to start the server
      await import("@grackle/server");
    });
}
