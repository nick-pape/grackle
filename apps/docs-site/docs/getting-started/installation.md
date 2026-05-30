---
id: installation
title: Installation
sidebar_position: 1
---

# Installation

Get Grackle running and pair the web UI. Two paths: Docker, or npm/source.

:::warning
Grackle is pre-1.0 and experimental. Unresolved security issues, sharp edges, broken workflows. Not for production.
:::

## Requirements

- **Node.js 22** — supported range `>=22.0.0 <24.0.0`. Node 24+ is not yet supported.
- **Docker** — only if you want containerized [environments](../building-blocks/environments-workspaces).

## Docker (recommended)

Pull the image and run the whole stack in one container.

```bash
docker run -d --name grackle \
  -p 3000:3000 -p 7434:7434 -p 7435:7435 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v grackle-data:/data \
  ghcr.io/nick-pape/grackle:latest
```

- The image sets `GRACKLE_HOME=/data` and runs as `node`. Mount the named volume at `/data` so your database and key survive a restart.
- Mount the Docker socket to let Grackle spawn agent environments as sibling containers.
- This image bundles Neo4j and turns the [knowledge graph](../features/knowledge-graph) on by default.

## npm / source

Install the CLI and start the server.

```bash
npm install -g @grackle-ai/cli
grackle serve
```

Build from source when you want the bleeding edge:

```bash
git clone https://github.com/nick-pape/grackle
cd grackle
rush install && rush build
node packages/server/dist/index.js
```

:::note Knowledge graph is Docker-only by default
The knowledge graph is **off** on npm and from-source installs. To enable it, run your own Neo4j and set `GRACKLE_KNOWLEDGE_ENABLED=true` (plus the `GRACKLE_NEO4J_*` connection settings — see `.env.example`). The Docker image bundles Neo4j and enables it for you.
:::

## What starts

`grackle serve` brings up four things on localhost:

| Service     | Port | What it is               |
| ----------- | ---- | ------------------------ |
| Web UI + WS | 3000 | The browser interface    |
| Server gRPC | 7434 | What the CLI talks to    |
| MCP server  | 7435 | Tools for outside agents |
| PowerLine   | 7433 | A local wire to run on   |

## First launch

The web UI is gated behind a one-time **pairing** step. On startup the server prints a pairing URL:

```text
Open in browser:
http://localhost:3000/pair?code=ABC123
```

Open it, or go to `http://localhost:3000/pair` and type the six-character code. Running in Docker, read the URL from the container logs:

```bash
docker logs grackle
```

:::warning The code expires in 5 minutes
If it lapses, mint a new one with `grackle pair` (in Docker, `docker exec grackle grackle pair`).
:::

## The setup wizard

After pairing, a four-step wizard runs once:

1. **Welcome** — what you're looking at.
2. **About** — what Grackle does.
3. **Runtime** — pick the default runtime.
4. **Notifications** — grant browser notifications, or don't.

It writes your default persona and drops you into the root chat.

→ [Using the Root Chat](./root-chat)
