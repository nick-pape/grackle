# @grackle-ai/common

Shared Protocol Buffer definitions, generated TypeScript code, and common types for the [Grackle](https://github.com/nick-pape/grackle) platform.

Grackle is an open-source platform for running AI coding agents on remote environments — Docker, SSH, GitHub Codespaces, and more. This package provides the core protocol and type definitions that all Grackle packages depend on.

## Installation

```bash
npm install @grackle-ai/common
```

## What's Inside

- **Protocol Buffer definitions** for the `Grackle` (central server) and `GracklePowerLine` (remote agent) gRPC services, compiled to TypeScript via [ConnectRPC](https://connectrpc.com/)
- **Generated TypeScript code** for all gRPC messages, enums, and service descriptors — ready to use with `@connectrpc/connect`
- **Shared types and constants** used across the CLI, server, web UI, and PowerLine packages — status enums, default ports, configuration paths, and more
- **Enum converters** for translating between string representations (used in SQLite and WebSocket payloads) and protobuf enum values (used in gRPC messages)
- **Runtime manifests** describing the npm packages required by each supported agent runtime (Claude Code, Copilot, Codex, Goose, and others)
- **Fuzzy search** utility for client-side and server-side filtering

## Usage

Import the generated proto namespaces and shared types:

```typescript
import { grackle, powerline } from "@grackle-ai/common";
```

The `grackle` namespace contains the central server service definition and all associated message types. The `powerline` namespace contains the remote agent service definition.

## Requirements

- Node.js >= 22

## License

MIT
