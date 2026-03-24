# @grackle-ai/web-server

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
