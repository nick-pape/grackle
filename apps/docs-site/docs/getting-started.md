---
id: getting-started
title: Getting Started
sidebar_position: 2
---

# Getting Started

Get Grackle running and spawn your first AI agent session in about 5 minutes.

## Requirements

- **Node.js 22** (supported range is `>=22.0.0 <24.0.0` — Node 24+ is not yet supported)
- **Docker** (if you want containerized environments)

## Option 1: Docker (recommended) {#docker-install}

Pull and run the pre-built image from GitHub Container Registry:

```bash
docker run -it --rm \
  -p 3000:3000 -p 7434:7434 -p 7435:7435 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v grackle-data:/data \
  ghcr.io/nick-pape/grackle:latest
```

The image sets `GRACKLE_HOME=/data` and runs as the `node` user, so mount the named volume at `/data` to persist your database and API key across container restarts.

This gives you the full Grackle stack — server, web UI, MCP server, and a local PowerLine instance — in one container. Mount the Docker socket to let Grackle create agent environments as sibling containers. The Docker image also bundles Neo4j and enables the knowledge graph by default.

:::tip Find the pairing URL in the container logs
The web UI is gated behind a one-time pairing step. The container prints a pairing URL on startup, so grab it from the logs:

```bash
docker logs <container>
```

Look for the `Open in browser: http://...:3000/pair?code=XXXXXX` line and open that URL (or copy the 6-character code into the pairing page at http://localhost:3000/pair). The code expires after 5 minutes — see [First launch](#first-launch) below.
:::

## Option 2: npm / CLI

```bash
# Install the CLI globally
npm install -g @grackle-ai/cli

# Start the server
grackle serve
```

:::tip Skip the global install
You can prefix every command with `npx` instead:

```bash
npx @grackle-ai/cli serve
```

:::

:::note pnpm users
pnpm v8+ blocks native install scripts by default. If `grackle serve` crashes with a `Could not locate the bindings file` error, run `pnpm approve-builds` after installing, or add this to your `package.json`:

```json
{ "pnpm": { "onlyBuiltDependencies": ["better-sqlite3"] } }
```

:::

## Option 3: From source

```bash
git clone https://github.com/nick-pape/grackle.git
cd grackle
rush install && rush build
node packages/server/dist/index.js
```

:::note Knowledge graph is Docker-only by default
The knowledge graph subsystem is **off** on npm and from-source installs. To enable it you must run your own Neo4j instance and set `GRACKLE_KNOWLEDGE_ENABLED=true` (plus the `GRACKLE_NEO4J_*` connection settings — see `.env.example`). The Docker image bundles Neo4j and sets `GRACKLE_KNOWLEDGE_ENABLED=true` for you, so the knowledge graph works out of the box there.
:::

## What starts

However you install, the server starts three services on localhost:

| Service         | Port | Purpose                                        |
| --------------- | ---- | ---------------------------------------------- |
| **Web UI**      | 3000 | Dashboard, chat interface, real-time streaming |
| **gRPC server** | 7434 | CLI and PowerLine communication                |
| **MCP server**  | 7435 | AI agent tool access                           |

A local PowerLine instance also starts automatically — you can run agents on your own machine right away.

## First launch

The web UI is gated behind a one-time **pairing** step. Any request to `http://localhost:3000/` without a valid session cookie is redirected to `/pair`.

1. On startup, the server prints a pairing URL to your terminal:

   ```text
   Open in browser:
   http://localhost:3000/pair?code=ABC123

   Pairing code expires in 5 minutes.
   Run `grackle pair` to generate a new code.
   ```

   Open that URL. It carries the 6-character code in the query string and pairs you automatically. Alternatively, open **http://localhost:3000/pair** and type the 6-character code into the form.

2. After pairing, the **setup wizard** appears and walks you through four steps:
   1. **Welcome** — Brief intro to what Grackle does
   2. **About** — A bit more on how Grackle works
   3. **Runtime selection** — Pick your default agent (Claude Code, Copilot, Codex, or Goose)
   4. **Notifications** — Optionally enable browser notifications, then finish

   Finishing creates your default persona and drops you into the chat interface.

:::warning Pairing code expires in 5 minutes
If the code has expired (the pairing page shows "Invalid or expired pairing code"), run `grackle pair` to generate a fresh code and URL, then open it.
:::

![Live agent stream — tool cards, code output, and interaction](/img/task-stream-view.png)

## Set up credentials

Your chosen runtime needs API credentials. See the [full credential setup guide](./guides/credentials) or quick-start with:

```bash
# For Claude Code
grackle credential-provider set claude api_key
grackle token set ANTHROPIC_API_KEY --env ANTHROPIC_API_KEY

# For Codex
grackle credential-provider set codex on
grackle token set OPENAI_API_KEY --env OPENAI_API_KEY

# For Copilot
grackle credential-provider set github on
grackle credential-provider set copilot on
```

:::note Where the value comes from
`grackle token set <name> --env <VAR>` reads the value from the named environment variable in your current shell. Use `--file <path>` to read it from a file instead. With **neither** flag, `grackle token set` drops into an interactive prompt and asks you to type the value — it does not read the matching environment variable implicitly.
:::

## Add a Docker environment

If you have Docker running, add a containerized environment:

```bash
grackle env add my-env --docker
grackle env provision my-env
```

The provision step pulls an image, starts a container, installs PowerLine inside it, and connects. You'll see progress streamed to your terminal.

## Spawn your first session

```bash
grackle spawn my-env "Say hello and list the files in the current directory"
```

You'll see the agent's output streamed in real time — text, tool calls, and results. Press `Ctrl+C` to detach (the session keeps running).

You can also spawn sessions from the web UI by typing your request into the [chat interface](./guides/chat).

## What's next

You now have a working Grackle setup. From here:

- **[Chat interface](./guides/chat)** — Use natural language to manage everything
- **[Add more environments](./concepts/environments)** — SSH hosts, Codespaces, or just use the built-in local environment
- **[Create a workspace](./concepts/projects-tasks)** — Organize work into tasks with dependencies and branch isolation
- **[Configure personas](./concepts/personas)** — Customize agent behavior with system prompts, tools, and model selection
- **[Multi-agent orchestration](./guides/orchestration)** — Scale from one agent to coordinated teams
