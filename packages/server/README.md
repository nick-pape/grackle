# @grackle-ai/server

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
