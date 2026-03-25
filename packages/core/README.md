# @grackle-ai/core

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/core"><img src="https://img.shields.io/npm/v/@grackle-ai/core.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

Core gRPC business logic for [Grackle](https://github.com/nick-pape/grackle).

## Overview

This package contains the runtime business logic for the Grackle server:

- **gRPC Service** — ConnectRPC handlers for environment, session, task, workspace, persona, and knowledge operations
- **Event System** — Domain event bus with pub/sub, event processing, and persistence
- **Streaming** — Stream multiplexing, registry, and pipe delivery for real-time agent output
- **WebSocket Bridge** — Event broadcast to connected web clients
- **Session Lifecycle** — Recovery, auto-hibernate, and reanimate for agent sessions
- **Adapter Management** — Registry and health-check heartbeat for environment adapters
- **Signals** — SIGCHLD handling for parent-child task coordination
- **Credentials** — Token push and credential bundling for remote environments

## Usage

This package is consumed by `@grackle-ai/server` (the orchestrator) which wires it together with the web server, MCP server, and PowerLine.

```typescript
import {
  registerGrackleRoutes,
  registerAdapter, startHeartbeat,
  emit, subscribe,
  createWsBridge,
  logger,
} from "@grackle-ai/core";
```
