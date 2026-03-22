# @grackle-ai/server

The central server for [Grackle](https://github.com/nick-pape/grackle) — an open-source platform for running AI coding agents on any remote environment.

`@grackle-ai/server` is the backbone of a Grackle installation. It manages environments, sessions, tasks, and workspaces, persists state in SQLite, and bridges real-time events to connected clients over WebSocket. Everything in Grackle flows through this server.

## What it does

- **gRPC API** (ConnectRPC on HTTP/2) — the primary control plane used by the CLI, web UI, and MCP clients to manage environments, start sessions, create tasks, and query state.
- **SQLite database** (via Drizzle ORM, WAL mode) — durable storage for environments, sessions, workspaces, tasks, findings, personas, and settings. Migrations run automatically on startup.
- **WebSocket bridge** — pushes real-time session events, environment status changes, and domain events to the web UI and other subscribers.
- **Adapter orchestration** — provisions, connects, and health-checks remote environments through pluggable adapters (Docker, SSH, GitHub Codespaces, local).
- **Credential forwarding** — securely pushes API keys and tokens to remote environments so agents can authenticate with upstream services.
- **Session lifecycle** — spawns agent sessions on remote PowerLine instances, streams output, handles suspension/recovery, and auto-hibernates idle sessions.
- **MCP server** (Streamable HTTP) — exposes Grackle capabilities to MCP-compatible clients with OAuth-based authorization.
- **Web UI hosting** — serves the `@grackle-ai/web` SPA and handles pairing-code authentication for browser clients.
- **Domain event bus** — internal pub/sub system that drives WebSocket broadcasts, session lifecycle management, and auto-reconnect logic.

## Installation

```bash
npm install @grackle-ai/server
```

> **Note:** `@grackle-ai/server` requires Node.js 22 or later. The `better-sqlite3` native module must be compiled during installation — if you use pnpm, you may need to run `pnpm approve-builds` or add `better-sqlite3` to your `onlyBuiltDependencies` list.

Most users should install [`@grackle-ai/cli`](https://www.npmjs.com/package/@grackle-ai/cli) instead, which bundles the server and provides the `grackle` command:

```bash
npm install -g @grackle-ai/cli
grackle serve
```

## Architecture

```
         CLI / Web UI / MCP clients
                   |
            gRPC (HTTP/2)
                   |
        ┌──────────┴──────────┐
        │   @grackle-ai/server │
        │                      │
        │  SQLite   Event Bus  │
        │  Stores   WS Bridge  │
        └──────┬───────────────┘
               │
          PowerLine (gRPC)
               │
     ┌─────────┼─────────┐
   Docker    SSH    Codespaces ...
```

The server sits between user-facing clients and remote environments. Clients talk to the server over gRPC; the server talks to environments over the PowerLine protocol. State is persisted locally in SQLite at `~/.grackle/grackle.db`.

## Configuration

The server is configured through environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `GRACKLE_PORT` | `7434` | gRPC server listen port |
| `GRACKLE_WEB_PORT` | `3000` | Web UI + WebSocket listen port |
| `GRACKLE_MCP_PORT` | `7435` | MCP server listen port |
| `GRACKLE_POWERLINE_PORT` | `7433` | Local PowerLine listen port |
| `GRACKLE_HOST` | `127.0.0.1` | Bind address (use `0.0.0.0` for LAN access) |
| `GRACKLE_HOME` | `~` | Parent of the `.grackle` data directory |

## License

[MIT](https://github.com/nick-pape/grackle/blob/main/LICENSE)
