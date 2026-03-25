# @grackle-ai/web-server

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/web-server"><img src="https://img.shields.io/npm/v/@grackle-ai/web-server.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

HTTP web server for [Grackle](https://github.com/nick-pape/grackle) — static file serving, device pairing, OAuth authorization, and ConnectRPC proxy.

## Overview

`createWebServer(options)` returns an `http.Server` that handles:

- **Static file serving** — serves the `@grackle-ai/web` SPA with path traversal protection and SPA fallback
- **Device pairing** — `/pair` endpoint for pairing code entry and session cookie creation
- **OAuth 2.1** — `/.well-known/oauth-authorization-server`, `/register`, `/authorize`, `/token` endpoints
- **ConnectRPC proxy** — forwards `/grackle.Grackle/*` requests to injected ConnectRPC routes (Connect protocol over HTTP/1.1)
- **Session auth gate** — unauthenticated requests redirect to `/pair`

## Usage

```typescript
import { createWebServer } from "@grackle-ai/web-server";
import { registerGrackleRoutes } from "./grpc-service.js";

const webServer = createWebServer({
  apiKey,
  webPort: 3000,
  bindHost: "127.0.0.1",
  connectRoutes: registerGrackleRoutes,
});

webServer.listen(3000, "127.0.0.1");
```

## API

### `createWebServer(options: WebServerOptions): http.Server`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `apiKey` | `string` | yes | API key for session/bearer auth |
| `webPort` | `number` | yes | Port (used for OAuth URL generation) |
| `bindHost` | `string` | yes | Bind host (`127.0.0.1` or `0.0.0.0`) |
| `connectRoutes` | `(router) => void` | no | ConnectRPC route registration function |
| `webDistDir` | `string` | no | Override web UI dist directory |

### `isWildcardAddress(host: string): boolean`

Returns `true` if the host is a wildcard bind address (`0.0.0.0`, `::`, etc.).
