---
id: getting-started
title: Getting Started
sidebar_position: 2
---

# Getting Started

Get Grackle running and spawn your first AI agent session in about 5 minutes.

## Requirements

- **Node.js 22** or later
- **Docker** (if you want containerized environments)

## Install and start

```bash
# Install the CLI globally
npm install -g @grackle-ai/cli

# Start the server
grackle serve
```

This starts three things on localhost:
- **gRPC server** on port 7434
- **Web UI** on port 3000
- **MCP server** on port 7435

A local PowerLine instance also starts automatically — you can run agents on your own machine right away.

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

## Open the web UI

Navigate to **http://localhost:3000**. On first launch you'll see a setup wizard that walks you through picking a default runtime (Claude Code, Copilot, or Codex).

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

You can also spawn sessions from the web UI by clicking **New Chat** and selecting an environment.

## What's next

You now have a working Grackle setup. From here:

- **[Add more environments](./concepts/environments)** — SSH hosts, Codespaces, or just use the built-in local environment
- **[Create a project](./concepts/projects-tasks)** — Organize work into tasks with dependencies and branch isolation
- **[Configure personas](./concepts/personas)** — Customize agent behavior with system prompts, tools, and model selection
- **[Set up credentials](./guides/auth)** — Manage API keys, tokens, and credential providers
