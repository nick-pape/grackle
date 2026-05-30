import type { Command } from "commander";

/** Register the `serve` command that starts the Grackle server and web UI. */
export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the Grackle server")
    .option("--port <port>", "Server port", "7434")
    .option("--web-port <port>", "Web UI port", "3000")
    .option("--mcp-port <port>", "MCP server port", "7435")
    .option(
      "--public-url <url>",
      "Canonical browser-facing origin (e.g. https://grackle.home) when behind a TLS reverse proxy; source of truth for the OAuth scheme/host, Secure cookie, HSTS, and pairing URL",
    )
    .option(
      "--mcp-origin <origin>",
      "Browser-facing MCP origin (e.g. https://mcp.example.com) for reverse-proxy/TLS deployments; trusted asset/CSP origin for widgets",
    )
    .option("--sandbox-port <port>", "MCP Apps widget sandbox port", "7436")
    .option(
      "--sandbox-origin <origin>",
      "Browser-facing MCP Apps sandbox origin (e.g. https://sandbox.example.com) for reverse-proxy/TLS deployments",
    )
    .option("--powerline-port <port>", "Local PowerLine port", "7433")
    .option("--allow-network", "Bind to all interfaces (0.0.0.0) for LAN access")
    .option(
      "--insecure",
      "Deliberately allow cleartext on a non-loopback bind. Required without TLS (GRACKLE_TLS_CERT/KEY) or a https GRACKLE_PUBLIC_URL. Sets GRACKLE_ALLOW_INSECURE=1.",
    )
    .action(
      async (opts: {
        port: string;
        webPort: string;
        mcpPort: string;
        publicUrl?: string;
        mcpOrigin?: string;
        sandboxPort: string;
        sandboxOrigin?: string;
        powerlinePort: string;
        allowNetwork: boolean;
        insecure?: boolean;
      }) => {
        process.env.GRACKLE_PORT = opts.port;
        process.env.GRACKLE_WEB_PORT = opts.webPort;
        process.env.GRACKLE_MCP_PORT = opts.mcpPort;
        if (opts.publicUrl !== undefined) {
          process.env.GRACKLE_PUBLIC_URL = opts.publicUrl;
        }
        if (opts.mcpOrigin !== undefined) {
          process.env.GRACKLE_MCP_ORIGIN = opts.mcpOrigin;
        }
        process.env.GRACKLE_SANDBOX_PORT = opts.sandboxPort;
        if (opts.sandboxOrigin !== undefined) {
          process.env.GRACKLE_SANDBOX_ORIGIN = opts.sandboxOrigin;
        }
        process.env.GRACKLE_POWERLINE_PORT = opts.powerlinePort;
        process.env.GRACKLE_HOST = opts.allowNetwork ? "0.0.0.0" : "127.0.0.1";
        // Don't clobber an env-supplied opt-in (e.g. from the Docker image,
        // systemd unit, or `.env` file) when --insecure wasn't passed.
        if (opts.insecure) {
          process.env.GRACKLE_ALLOW_INSECURE = "1";
        }

        console.log(`Starting Grackle server...`);
        console.log(
          `gRPC on port ${opts.port}, Web UI on port ${opts.webPort}, MCP on port ${opts.mcpPort}, Sandbox on port ${opts.sandboxPort}, PowerLine on port ${opts.powerlinePort}`,
        );
        if (opts.allowNetwork) {
          console.log("Network access enabled — binding to all interfaces");
        }

        // Dynamic import to start the server
        await import("@grackle-ai/server");
      },
    );
}
