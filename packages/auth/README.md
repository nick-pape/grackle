# @grackle-ai/auth

<p align="center">
  <img src="https://raw.githubusercontent.com/nick-pape/grackle/main/apps/docs-site/static/img/grackle-logo.png" alt="Grackle" width="200" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@grackle-ai/auth"><img src="https://img.shields.io/npm/v/@grackle-ai/auth.svg" alt="npm version" /></a>
  <a href="https://github.com/nick-pape/grackle/actions/workflows/ci.yml"><img src="https://github.com/nick-pape/grackle/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

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
