# @grackle-ai/core

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
