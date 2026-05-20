# @grackle-ai/runtime-acp

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/runtime-acp"><img src="https://img.shields.io/npm/v/@grackle-ai/runtime-acp.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

Grackle runtime that drives any agent speaking the Agent Client Protocol (ACP) over stdio.

## Overview

The [Agent Client Protocol (ACP)](https://agentclientprotocol.com) is a JSON-RPC protocol, framed as newline-delimited JSON over stdio, that lets a client drive a coding agent: initialize, authenticate, create a session, send prompts, and receive streamed session updates. This runtime spawns an ACP-compatible agent CLI as a subprocess and talks to it over its stdin/stdout — so a single implementation can drive many different agents (e.g. Goose, `codex-acp`, Copilot, the Claude agent ACP bridge).

`AcpRuntime` implements the `@grackle-ai/runtime-sdk` runtime interface (extending `BaseAgentRuntime` / `BaseAgentSession`) and is loaded by the Grackle PowerLine, which registers one runtime per configured ACP agent. Each session translates ACP session updates into Grackle `AgentEvent`s (text, thoughts, tool calls/results, plans, and usage), auto-approves permission requests, and forwards MCP servers to the agent.

## Configuration

`AcpRuntime` is constructed with an `AcpAgentConfig`, which names the runtime and describes the agent CLI to spawn:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | — | Runtime name used for registry lookup and the isolated install directory (e.g. `"codex-acp"`) |
| `command` | `string` | — | Agent command to spawn (e.g. `"codex-acp"`, `"copilot"`, `"goose"`) |
| `args` | `string[]` | — | CLI arguments passed to the command (e.g. `["--acp", "--stdio"]`) |
| `env` | `Record<string, string>` | — | Additional environment variables for the subprocess |

The Grackle PowerLine registers several ACP agents out of the box:

| Runtime name | Command | Args |
|--------------|---------|------|
| `goose` | `goose` | `acp` |
| `codex-acp` | `codex-acp` | — |
| `copilot-acp` | `copilot` | `--acp --stdio` |
| `claude-code-acp` | `claude-agent-acp` | — |

The ACP SDK (`@agentclientprotocol/sdk`) is installed lazily into an isolated per-runtime directory (`~/.grackle/runtimes/<name>/`) the first time a session starts; that directory's `.bin` is prepended to the subprocess `PATH`.

## Credentials

Credentials are passed through to the agent subprocess via the process environment (plus any `env` overrides in the config). During ACP `initialize`, the runtime inspects the agent's advertised auth methods and, if an `env_var` method is offered whose required variables are all present in the environment, calls `authenticate()` with it. This is required by some bridges (e.g. Copilot) and is a best-effort, non-fatal step for others (e.g. `codex-acp`, `claude-code-acp`). Each agent defines its own required credential variables.

## Requirements

- Node.js >= 22
- An ACP-compatible agent CLI available on `PATH` (or installed into the runtime's isolated directory), e.g. `goose`, `codex-acp`, `copilot`, or `claude-agent-acp`
- Whatever credentials the chosen agent requires, supplied via the environment

## License

MIT
