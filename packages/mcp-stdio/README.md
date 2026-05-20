# @grackle-ai/mcp-stdio

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/mcp-stdio"><img src="https://img.shields.io/npm/v/@grackle-ai/mcp-stdio.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

stdio-to-HTTP MCP proxy for [Grackle](https://github.com/nick-pape/grackle). Bridges MCP clients that only speak stdio (Claude Desktop, Codex CLI, Clawpilot) to a running Grackle HTTP MCP server using static API-key auth — no OAuth flow required.

## Quick Start

Add to your MCP client config:

```json
{
  "grackle": {
    "command": "npx",
    "args": ["-y", "@grackle-ai/mcp-stdio"],
    "env": {
      "GRACKLE_URL": "http://127.0.0.1:7435/mcp",
      "GRACKLE_API_KEY": "<your-api-key>"
    }
  }
}
```

Or run directly:

```bash
GRACKLE_URL=http://127.0.0.1:7435/mcp GRACKLE_API_KEY=<key> npx @grackle-ai/mcp-stdio
```

Requires **Node.js >= 22**.

## Configuration

| Variable | Description | Default |
| --- | --- | --- |
| `GRACKLE_URL` | Full URL of the Grackle MCP HTTP endpoint | `http://127.0.0.1:7435/mcp` |
| `GRACKLE_API_KEY` | API key for authenticating with the Grackle server. **Required** — the proxy exits with an error if not set. | *(none)* |

The API key is the 64-character hex token stored in `~/.grackle/api-key` on the machine running the Grackle server. For a Docker deployment, see the section below.

---

## Docker Quick Start

The published Grackle image exposes the MCP port (7435) by default when using the provided `docker-compose.yml`:

```bash
# Start Grackle
docker compose up -d

# Read the API key from the container's volume
docker exec grackle cat /data/.grackle/api-key
```

Then use the key in your MCP client config as shown above, with `GRACKLE_URL=http://127.0.0.1:7435/mcp`.

> **Multi-tenant hosts:** The default `docker-compose.yml` binding exposes port 7435 on all interfaces. To restrict to loopback, change the port mapping to `"127.0.0.1:7435:7435"` in your compose file.

---

## How It Works

`@grackle-ai/mcp-stdio` spawns a local stdio MCP server that forwards every `tools/list` and `tools/call` request to the Grackle HTTP MCP server over Streamable HTTP. Tool discovery is fully dynamic — the proxy calls `listTools` upstream on every request so new Grackle tools are automatically available without updating the proxy.

On any network error the proxy reconnects once before propagating the failure. No OAuth flow, no token expiry.

---

## License

MIT
