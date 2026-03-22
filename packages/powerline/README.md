# @grackle-ai/powerline

The **PowerLine** is the remote agent runtime that runs inside each [Grackle](https://github.com/nick-pape/grackle) environment. It receives commands from the central Grackle server over gRPC (ConnectRPC on HTTP/2), spawns AI coding agents, and streams their output back in real time.

Think of PowerLine as the "agent host" — it runs wherever your code lives (a Docker container, a remote VM, a GitHub Codespace) and manages the full lifecycle of agent sessions: spawning, streaming, input delivery, suspension, and teardown.

## How it works

When you add an environment to Grackle, the server connects to that environment's PowerLine instance over gRPC. From there, the server can:

- **Spawn agent sessions** — start any supported AI runtime with a prompt, model, and optional configuration like MCP servers, git branch isolation, and system context.
- **Stream events** — receive tool calls, code output, and status updates as they happen, bridged to the Web UI and CLI via WebSocket.
- **Deliver input** — send user messages to agents waiting for interactive input.
- **Suspend and resume** — if the gRPC connection drops, buffered events are parked and can be drained on reconnect. Sessions resume where they left off.
- **Push credentials** — securely inject API keys and tokens as environment variables or files (with path-traversal protection).
- **Manage git worktrees** — isolate each task on its own branch in its own worktree, so agents never interfere with each other.

## Supported runtimes

PowerLine uses a pluggable runtime architecture. Each runtime implements a common interface for spawning and streaming agent sessions.

| Runtime | Description |
|---------|-------------|
| **Claude Code** | Anthropic's Claude via the Agent SDK |
| **Copilot** | GitHub Copilot CLI agent |
| **Codex** | OpenAI Codex CLI agent |
| **Goose** | Goose agent (via ACP) |
| **GenAIScript** | Script-based agent for single-turn automation |

Additional runtimes can be added by implementing the `AgentRuntime` interface.

## Installation

```bash
npm install @grackle-ai/powerline
```

You don't typically install PowerLine directly. The Grackle server installs and launches it automatically in Docker environments, and it runs as a standalone process in SSH and Codespace environments.

For development or manual use:

```bash
npx @grackle-ai/powerline --port 7433 --token <secret>
```

## Usage

```bash
# Start with authentication (required by default)
grackle-powerline --token my-secret-token

# Or use an environment variable
GRACKLE_POWERLINE_TOKEN=my-secret-token grackle-powerline

# Start without authentication (development only)
grackle-powerline --no-auth

# Start on a custom port and host
grackle-powerline --port 9000 --host 0.0.0.0 --token my-secret-token
```

A token is required by default via `--token` or the `GRACKLE_POWERLINE_TOKEN` environment variable. To run without authentication for local development, pass `--no-auth` explicitly.

## Requirements

- Node.js >= 22
- Agent runtimes are installed on demand — only the runtimes you use need to be available on the system

## License

MIT
