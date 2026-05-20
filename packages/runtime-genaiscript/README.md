# @grackle-ai/runtime-genaiscript

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/runtime-genaiscript"><img src="https://img.shields.io/npm/v/@grackle-ai/runtime-genaiscript.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

Grackle runtime that drives the [GenAIScript](https://microsoft.github.io/genaiscript/) CLI.

## Overview

This package implements the `AgentRuntime` interface from [`@grackle-ai/runtime-sdk`](https://www.npmjs.com/package/@grackle-ai/runtime-sdk), letting Grackle run agents authored as GenAIScript programs. It is registered inside PowerLine under the runtime name `genaiscript` and is selected by any persona whose `runtime` is set to `"genaiscript"`.

Each session writes the persona's script to a temporary `.genai.mjs` file and invokes the GenAIScript CLI as a child process (`genaiscript run <script> -o <outputDir>`). The CLI is one-shot: a session runs the script to completion, streams progress, and then idles — it cannot be resumed and does not accept interactive input. The GenAIScript package is installed lazily into an isolated per-runtime directory the first time it is needed (see [Requirements](#requirements)).

## Configuration

The runtime takes no static configuration of its own. Behavior is driven by the per-session `SpawnOptions` supplied by Grackle:

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | `string` | Identifies the session and the temporary script file |
| `scriptContent` | `string` | The GenAIScript program executed as a `.genai.mjs` file |
| `mcpBroker` | `{ url, token }` | Optional MCP broker; injected into the script (see below) |

When an MCP broker is present, its URL and token are passed to the script as GenAIScript variables via environment variables, readable inside the script as `env.vars.GRACKLE_MCP_URL` and `env.vars.GRACKLE_MCP_TOKEN`:

| Environment variable | Script accessor |
|----------------------|-----------------|
| `GENAISCRIPT_VAR_GRACKLE_MCP_URL` | `env.vars.GRACKLE_MCP_URL` |
| `GENAISCRIPT_VAR_GRACKLE_MCP_TOKEN` | `env.vars.GRACKLE_MCP_TOKEN` |

## Events

The session streams `AgentEvent`s as the CLI runs:

| Event | Source |
|-------|--------|
| `system` | Stderr lines from the CLI (progress, `console.log` output) and lifecycle messages |
| `text` | The script's output text and any annotations, parsed from the CLI's `res.json` |
| `usage` | Token counts and cost, parsed from `res.json` when reported |
| `error` | Script annotations marked as errors, non-zero exit, or spawn failures |
| `status` | Final session status — `waiting_input` on success, `failed` otherwise |

## Models & Credentials

Model selection and provider authentication are handled by GenAIScript itself, not by this runtime. The script declares the model it wants (e.g. via `script({ model })` or a `model` alias), and the GenAIScript CLI resolves the corresponding provider credentials from the process environment / its own configuration (`.env`, etc.) following GenAIScript's standard conventions. This runtime does not define its own model list and does not read provider API keys directly — it inherits the environment of the PowerLine process it runs in.

See the [GenAIScript configuration docs](https://microsoft.github.io/genaiscript/getting-started/configuration/) for the supported providers and credential variables.

## Requirements

- Node.js >= 22
- The [GenAIScript](https://www.npmjs.com/package/genaiscript) CLI — installed automatically on first use into an isolated per-runtime directory (Grackle pins a compatible version)
- Valid credentials for whichever model provider your scripts target (configured per GenAIScript's conventions)

## License

MIT
