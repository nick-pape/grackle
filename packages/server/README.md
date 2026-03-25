# @grackle-ai/server

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/server"><img src="https://img.shields.io/npm/v/@grackle-ai/server.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

Grackle server orchestrator — spawns and wires together the four subsystems:

1. **Core** (`@grackle-ai/core`) — gRPC business logic
2. **Web Server** (`@grackle-ai/web-server`) — HTTP static files, pairing, OAuth
3. **MCP** (`@grackle-ai/mcp`) — Model Context Protocol server
4. **PowerLine** (`@grackle-ai/powerline`) — local agent runtime manager

## Usage

```bash
# Start the server
node dist/index.js

# Or via CLI
grackle serve
```

The orchestrator handles:
- Database initialization and seeding
- Adapter registration (Docker, SSH, Codespace, Local)
- Local PowerLine auto-start with crash recovery
- gRPC server (HTTP/2) with Bearer token auth
- Web + WebSocket server wiring
- MCP server startup
- Graceful shutdown coordination
