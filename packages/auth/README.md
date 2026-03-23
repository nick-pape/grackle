# @grackle-ai/auth

Authentication and authorization primitives for [Grackle](https://github.com/nick-pape/grackle).

## Features

- **API key management** — Generate, persist, and verify 256-bit API keys with constant-time comparison
- **Browser sessions** — HMAC-signed cookie sessions with automatic expiry and cleanup
- **Pairing codes** — Time-limited 6-character codes with IP-based rate limiting for device pairing
- **OAuth 2.1** — Dynamic client registration, PKCE (S256), authorization codes, and refresh token rotation
- **HMAC-signed tokens** — OAuth access tokens and scoped task tokens for MCP authentication
- **MCP request auth** — Middleware that authenticates API key, OAuth, and scoped token bearers
- **Security headers** — CSP and defense-in-depth headers for HTTP responses

## Logger Configuration

Auth modules use a pluggable logger. Call `setAuthLogger()` at startup to inject your application logger:

```typescript
import { setAuthLogger } from "@grackle-ai/auth";
import { logger } from "./my-logger.js";

setAuthLogger(logger);
```

If not configured, a default console-based logger is used.
