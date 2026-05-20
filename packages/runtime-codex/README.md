# @grackle-ai/runtime-codex

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/runtime-codex"><img src="https://img.shields.io/npm/v/@grackle-ai/runtime-codex.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

Grackle runtime that drives OpenAI's Codex agent.

## Overview

This package implements the `AgentRuntime` interface from [`@grackle-ai/runtime-sdk`](https://www.npmjs.com/package/@grackle-ai/runtime-sdk) by wrapping OpenAI's Codex SDK (`@openai/codex-sdk`), which in turn drives the Codex CLI. The exported `CodexRuntime` is registered with the PowerLine runtime registry under the name `codex`, so tasks can run against Codex anywhere PowerLine runs (Docker, local, SSH, Codespace).

When a session starts, the runtime creates a Codex thread, runs the prompt with `runStreamed()`, and translates the SDK's thread events into Grackle's normalized agent event stream (text, reasoning, tool use/results, usage, and errors). It supports multi-turn conversations, follow-up input, resuming a previous thread, MCP servers, and `maxTurns` enforcement.

## Configuration

All configuration is supplied via environment variables so the runtime behaves identically across every environment type.

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | yes* | OpenAI API key. Read automatically by the Codex SDK. |
| `CODEX_API_KEY` | no | Explicit API-key override; takes precedence over `OPENAI_API_KEY`. |
| `OPENAI_BASE_URL` | no | Custom base URL for the OpenAI API. |
| `CODEX_CLI_PATH` | no | Path to the Codex CLI binary, overriding default PATH resolution. |

\* Either `OPENAI_API_KEY` or `CODEX_API_KEY` must be set. If neither is present, Codex returns no messages and the session reports an authentication error.

Threads are created with full filesystem access (`sandboxMode: "danger-full-access"`), no approval prompts (`approvalPolicy: "never"`), and the git-repo check skipped, since the agent runs inside an already-isolated Grackle environment. The working directory and `model` are set per session from the spawn options; system context is injected as Codex `developer_instructions`, and MCP servers are translated into Codex's `mcp_servers` config.

## Models

The model is selected per session from the spawn options and passed straight through to the Codex thread. When no model is specified, the Codex SDK / CLI default is used. This package does not pin or restrict the model list — any model your installed Codex CLI accepts is valid.

## Credentials

Codex authenticates with an OpenAI API key, resolved in this order:

1. `CODEX_API_KEY` (explicit override)
2. `OPENAI_API_KEY` (read automatically by the SDK)

Grackle delivers these credentials to the PowerLine over the gRPC connection at task start, so nothing needs to be baked into the environment image.

## Requirements

- Node.js >= 22
- The Codex CLI installed and available on `PATH` (or set `CODEX_CLI_PATH`)
- An OpenAI API key (`OPENAI_API_KEY` or `CODEX_API_KEY`)

The `@openai/codex-sdk` package is installed lazily on first use into an isolated per-runtime directory, so it does not need to be a direct dependency of your project.

## License

MIT
