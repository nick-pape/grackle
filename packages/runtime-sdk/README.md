# @grackle-ai/runtime-sdk

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/runtime-sdk"><img src="https://img.shields.io/npm/v/@grackle-ai/runtime-sdk.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

SDK for building [Grackle](https://github.com/nick-pape/grackle) agent runtimes.

Grackle runs AI coding agents inside environments. Each kind of agent is driven by a **runtime**: a module that knows how to spawn that particular agent SDK, stream its events, feed it follow-up input, and tear it down. A runtime is to an agent (Claude Code, Codex, Copilot, GenAIScript, ACP) what an [adapter](https://www.npmjs.com/package/@grackle-ai/adapter-sdk) is to an environment.

This package provides the interfaces, base classes, and shared utilities you need to write a custom runtime. If you want to drive an agent that isn't covered by the built-in runtimes, implement the `AgentRuntime` interface (or extend `BaseAgentRuntime` / `BaseAgentSession`) and plug it into the Grackle PowerLine.

### Built-in Runtime Packages

- [`@grackle-ai/runtime-claude-code`](https://www.npmjs.com/package/@grackle-ai/runtime-claude-code) — Anthropic Claude Code (Claude Agent SDK)
- [`@grackle-ai/runtime-copilot`](https://www.npmjs.com/package/@grackle-ai/runtime-copilot) — GitHub Copilot
- [`@grackle-ai/runtime-codex`](https://www.npmjs.com/package/@grackle-ai/runtime-codex) — OpenAI Codex
- [`@grackle-ai/runtime-genaiscript`](https://www.npmjs.com/package/@grackle-ai/runtime-genaiscript) — GenAIScript
- [`@grackle-ai/runtime-acp`](https://www.npmjs.com/package/@grackle-ai/runtime-acp) — Agent Client Protocol (ACP) agents

## Install

```bash
npm install @grackle-ai/runtime-sdk
```

## Key Concepts

### Runtimes

A runtime is a class that implements the `AgentRuntime` interface. It tells Grackle how to:

- **Spawn** — create and start a new agent session from a set of `SpawnOptions` (prompt, model, max turns, branch, MCP servers, and more).
- **Resume** — reattach to a previously suspended session using its runtime session ID.

Both `spawn()` and `resume()` return an `AgentSession`.

### Sessions

An `AgentSession` is a handle to an in-progress agent run. It exposes:

- **`stream()`** — an async iterable of `AgentEvent`s emitted as the agent works.
- **`sendInput(text)`** — send follow-up user input to a session that is waiting for it.
- **`kill(reason?)`** — forcefully terminate the session.
- **`drainBufferedEvents()`** — collect any events that were buffered but not yet consumed by the stream.

Each `AgentEvent` carries a `type`, `timestamp`, `content`, and optional `raw` payload.

### Base Classes

Most runtimes don't implement these interfaces from scratch. The SDK ships two abstract base classes that encode the shared lifecycle so a new runtime only needs to fill in the SDK-specific pieces:

- **`BaseAgentRuntime`** — implements `spawn()` and `resume()` by delegating to a single `createSession()` method you supply.
- **`BaseAgentSession`** — implements the full event-queue and `waiting_input` lifecycle: streaming, sequential follow-up processing, status transitions, and teardown. Subclasses implement abstract hooks such as `setupSdk()`, `runInitialQuery()`, `executeFollowUp()`, and `abortActive()`.

### Shared Utilities

- **Working directory & worktrees** — `resolveWorkingDirectory()` and `findGitRepoPath()` locate the right git repository (honoring Docker `/workspace` and Codespaces `/workspaces/*` conventions) and prepare it for the session. The lower-level `ensureWorktree()` / `removeWorktree()` helpers create and clean up per-branch git worktrees for isolation.
- **MCP configuration** — `resolveMcpServers()` merges MCP server configs from the shared `GRACKLE_MCP_CONFIG` file and spawn options, applies `disallowedTools` filtering, and injects the Grackle MCP broker entry. `convertMcpServers()` translates Grackle's keyed config into the named-array format expected by ACP agents.
- **Runtime installer** — `ensureRuntimeInstalled()` lazily installs a runtime's npm packages into an isolated `~/.grackle/runtimes/<name>/` directory, `importFromRuntime()` dynamically imports modules from it, and `getRuntimeBinDirectory()` exposes the runtime's `.bin` path for spawning agent CLIs.
- **`AsyncQueue`** — a small `AsyncIterable` queue used to bridge pushed events into `for await` consumers, with `push`, `shift`, `drain`, and `close`.
- **`logger`** — a shared [pino](https://github.com/pinojs/pino) structured logger.

## Requirements

- Node.js >= 22

## License

MIT
