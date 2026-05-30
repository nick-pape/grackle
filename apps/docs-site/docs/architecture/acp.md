---
id: acp
title: ACP
sidebar_position: 4
---

# ACP

**ACP** — the [Agent Client Protocol](https://agentclientprotocol.com/) — is how Grackle drives an agent it has no native SDK for. The agent runs as a subprocess. Grackle speaks ACP to it over stdio.

Most runtimes are wired in directly: Claude Code, Copilot, and Codex each have a bespoke runtime that talks to the vendor SDK. ACP is the other door. When an agent ships an ACP mode — Goose does — Grackle reaches it without writing a new runtime. One adapter, every ACP-speaking agent.

## How it works

Inside an environment, [PowerLine](./powerline-ahp) registers an `AcpRuntime` for each ACP entry. Spawning a session does the rest:

1. PowerLine spawns the agent command with `stdio: ["pipe", "pipe", "inherit"]`.
2. It opens an ACP connection over the child's stdin/stdout (newline-delimited JSON-RPC).
3. The prompt goes in, events stream back, and PowerLine relays them up the wire over AHP — same as any other runtime.

The agent process is the claw. ACP is the only language Grackle and that process share.

## The runtimes

Each ACP entry is a command and its arguments. All are **experimental**.

| Runtime           | Command                 | Drives                             |
| ----------------- | ----------------------- | ---------------------------------- |
| `goose`           | `goose acp`             | Block Goose                        |
| `codex-acp`       | `codex-acp`             | OpenAI Codex, via the ACP bridge   |
| `copilot-acp`     | `copilot --acp --stdio` | GitHub Copilot, via the ACP bridge |
| `claude-code-acp` | `claude-agent-acp`      | Claude Code, via the ACP bridge    |

Goose is the reason ACP exists here — an agent with no Grackle SDK, reached anyway. The three bridges are the same vendors Grackle already drives natively, routed through ACP instead; they exist to test the door, not to replace the native runtimes.

`claude-code-acp` runs with an isolated `CLAUDE_CONFIG_DIR` so it can't inherit a developer's `~/.claude` settings. A personal interactive-only mode in that file would crash the headless session before it starts.

The packages each runtime needs are installed on demand. You select one by name like any runtime — see [Personas & runtimes](../building-blocks/personas-runtimes).

## Three protocols, three boundaries

Grackle composes standard protocols rather than inventing one. Each speaks across a different seam:

| Protocol | Boundary                  | Carries                                                |
| -------- | ------------------------- | ------------------------------------------------------ |
| **AHP**  | server ↔ host (the wire) | spawn, events, credentials — JSON-RPC over a WebSocket |
| **ACP**  | host ↔ agent (the claw)  | prompts and events to a subprocess over stdio          |
| **MCP**  | agent ↔ tools            | the tool surface the agent calls out to                |

AHP is the wire. ACP is how a claw that knows neither AHP nor a Grackle SDK still perches on it. [MCP](./mcp) is what the agent reaches for once it's running.

ACP and AHP look alike — both are JSON-RPC — and that is the trap. AHP is Grackle's own host protocol between the server and PowerLine. ACP is a foreign protocol Grackle speaks _down_ to an agent it doesn't own. Different seam, different direction.

Credentials still flow the Grackle way: the runtime pulls them on demand through AHP. See [Credentials](../features/credentials).
