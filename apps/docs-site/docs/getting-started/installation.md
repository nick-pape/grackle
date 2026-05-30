---
id: installation
title: Installation
sidebar_position: 1
---

# Installation

Get the server up. Get past the pairing gate. Everything else is a later recipe.

:::warning Experimental
Grackle is experimental. You are handing an AI ambient access to real machines. Run it where a mistake stays cheap.
:::

## Requirements

- **Node.js** — supported range `>=22.0.0 <24.0.0`. Node 24+ does not run.
- **Docker** — only if you want containerized [environments](../building-blocks/environments-workspaces).

## Docker (recommended)

Pull the image and run the whole stack in one container.

```bash
docker run -it --rm \
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

No global install? Prefix with `npx`:

```bash
npx @grackle-ai/cli serve
```

From source:

```bash
git clone https://github.com/nick-pape/grackle.git
cd grackle
rush install && rush build
node packages/server/dist/index.js
```

:::note pnpm blocks native builds
pnpm v8+ refuses install scripts by default. If `grackle serve` dies with `Could not locate the bindings file`, run `pnpm approve-builds`, or pin it in `package.json`:

```json
{ "pnpm": { "onlyBuiltDependencies": ["better-sqlite3"] } }
```

:::

:::note Knowledge graph is Docker-only by default
On npm and from-source installs the [knowledge graph](../features/knowledge-graph) is off. To run it, stand up your own Neo4j and set `GRACKLE_KNOWLEDGE_ENABLED=true` plus the `GRACKLE_NEO4J_*` settings (see `.env.example`).
:::

## What starts

However you install, the server binds three services to localhost — plus a local PowerLine, so a claw can perch on your own machine right away.

| Service     | Port | What it carries                 |
| ----------- | ---- | ------------------------------- |
| Web UI      | 3000 | Dashboard, chat, live streaming |
| gRPC server | 7434 | CLI and PowerLine traffic       |
| MCP server  | 7435 | Agent tool access               |

## The pairing gate

The web UI is locked. Any request to `http://localhost:3000/` without a valid session is bounced to `/pair`.

On startup the server prints a pairing URL:

```text
Open in browser:
http://localhost:3000/pair?code=ABC123

Pairing code expires in 5 minutes.
Run `grackle pair` to generate a new code.
```

Open that URL — it carries the 6-character code and pairs you. Or open `http://localhost:3000/pair` and type the code by hand.

On Docker, the URL is in the logs:

```bash
docker logs <container>
```

Look for the `Open in browser: ...` line.

:::warning The code expires in 5 minutes
See `Invalid or expired pairing code`? Run `grackle pair` for a fresh code and URL, then open it.
:::

## The setup wizard

Once paired, a four-step wizard runs:

| Step              | What it does                                                     |
| ----------------- | ---------------------------------------------------------------- |
| **Welcome**       | What Grackle is.                                                 |
| **About**         | How it works.                                                    |
| **Runtime**       | Pick your default agent — Claude Code, Copilot, Codex, or Goose. |
| **Notifications** | Optionally enable browser notifications, then finish.            |

Finishing mints your default persona and drops you into the root chat.

---

The server is up and you are in. Next: [Using the Root Chat](./root-chat).
