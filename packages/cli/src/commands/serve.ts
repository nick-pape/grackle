import type { Command } from "commander";

/** Loopback addresses accepted by `--host`. Security policy: bind to loopback only. */
const LOOPBACK_HOSTS: Set<string> = new Set(["127.0.0.1", "::1"]);

/**
 * Format a bind host for embedding in a URL.
 * IPv6 literals (containing `:`) must be bracketed per RFC 2732.
 */
function formatHostForUrl(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

/** Register the `serve` command that starts the Grackle server and web UI. */
export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the Grackle server")
    .option("--port <port>", "Server port", "7434")
    .option("--web-port <port>", "Web UI port", "3000")
    .option("--host <address>", "Bind address — must be a loopback address (127.0.0.1 or ::1)", "127.0.0.1")
    .action(async (opts) => {
      if (!LOOPBACK_HOSTS.has(opts.host)) {
        console.error(`Error: --host must be a loopback address (127.0.0.1 or ::1). Got: ${opts.host}`);
        console.error("Binding to non-loopback addresses would expose the API key to the network.");
        process.exit(1);
      }

      process.env.GRACKLE_PORT = opts.port;
      process.env.GRACKLE_WEB_PORT = opts.webPort;
      process.env.GRACKLE_HOST = opts.host;

      const urlHost = formatHostForUrl(opts.host);
      console.log(`Starting Grackle server on ${opts.host}:${opts.port}...`);
      console.log(`Web UI will be available at http://${urlHost}:${opts.webPort}`);

      // Dynamic import to start the server
      await import("@grackle-ai/server");
    });
}
