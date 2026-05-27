# @grackle-ai/runtime-copilot

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/runtime-copilot"><img src="https://img.shields.io/npm/v/@grackle-ai/runtime-copilot.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

Grackle runtime that drives GitHub Copilot via the Copilot SDK (`@github/copilot-sdk`).

## Overview

The Copilot runtime implements the `@grackle-ai/runtime-sdk` `AgentRuntime` interface (`CopilotRuntime extends BaseAgentRuntime`) and wraps the GitHub Copilot SDK. It is registered with the PowerLine runtime registry under the name `copilot` and is selected by personas that target Copilot. Each agent session creates a `CopilotClient`, opens (or resumes) a Copilot session, streams the SDK's events back to Grackle, and tears the session down on completion.

The Copilot SDK (`@github/copilot-sdk`) and the Copilot CLI (`@github/copilot`) are **not** install-time dependencies. They are installed lazily at spawn time into an isolated per-runtime directory (`~/.grackle/runtimes/copilot/`) via `ensureRuntimeInstalled` and imported dynamically, so the package stays light until a Copilot session actually runs.

## Configuration

All configuration is driven by environment variables so the runtime behaves identically across local, Docker, SSH, and other environments.

| Variable                  | Description                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `COPILOT_CLI_PATH`        | Path to the Copilot CLI binary. Defaults to `copilot` resolved via `PATH`.                                                                   |
| `COPILOT_CLI_URL`         | URL of an external Copilot CLI server (e.g. `localhost:4321`). When set, the runtime connects to it instead of spawning a local CLI process. |
| `COPILOT_PROVIDER_CONFIG` | JSON-encoded provider config for bring-your-own-key (BYOK) scenarios (e.g. `type`, `baseUrl`, `apiKey`). Malformed JSON is ignored.          |

Session-level options are passed through from Grackle: the model, an optional system message (injected via the SDK's `systemMessage` in `append` mode), MCP servers, and the working directory. Tool permission prompts are auto-approved (`approveAll`) for headless operation.

> **Note:** the Copilot SDK does not support a turn limit. If a `maxTurns` value is requested, it is logged and ignored — the session runs until idle.

## Models

The model is selected per session and passed straight through to the Copilot SDK's session config; this package does not hard-code a model list or a default. The available models are those exposed by your Copilot CLI / SDK installation.

## Credentials

The runtime resolves a GitHub token from the following environment variables, in priority order:

| Variable               | Priority |
| ---------------------- | -------- |
| `COPILOT_GITHUB_TOKEN` | 1        |
| `GH_TOKEN`             | 2        |
| `GITHUB_TOKEN`         | 3        |

If a token is found, it is passed to the `CopilotClient` and the SDK uses it directly. If none is set, the runtime falls back to the logged-in Copilot user (`useLoggedInUser`). For BYOK setups, supply provider credentials via `COPILOT_PROVIDER_CONFIG` instead.

## Requirements

- Node.js >= 22
- The GitHub Copilot SDK (`@github/copilot-sdk`) and Copilot CLI (`@github/copilot`) — installed lazily into `~/.grackle/runtimes/copilot/` at spawn time, or an external CLI server reachable via `COPILOT_CLI_URL`
- GitHub Copilot credentials — a token in `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN`, a logged-in Copilot CLI session, or a BYOK provider config in `COPILOT_PROVIDER_CONFIG`

## License

MIT
