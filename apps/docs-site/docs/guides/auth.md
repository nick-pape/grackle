---
id: auth
title: Authentication & Security
sidebar_position: 1
---

# Authentication & Security

Grackle has several authentication layers depending on how you're connecting. This guide covers all of them.

## API key

The API key is Grackle's primary credential. It's a 256-bit hex string generated automatically the first time you run `grackle serve`, stored at `~/.grackle/api-key`.

The CLI reads this file automatically. If you're connecting from a different machine, set it via environment variable:

```bash
export GRACKLE_API_KEY=<your-key>
grackle env list
```

The API key is used for:
- **CLI** — Sent as `Authorization: Bearer <key>` on every gRPC call
- **WebSocket** — Passed as `?token=<key>` query parameter
- **MCP clients** — Used as the global auth token (full access)

## Pairing codes (web UI)

The web UI authenticates through **pairing codes** — short-lived 6-character codes that grant a browser session.

```bash
grackle pair
```

This prints a pairing code, a URL, and a QR code. Enter the code at the pairing prompt in the web UI (or scan the QR from your phone). The code expires after **5 minutes** and is single-use.

After pairing, the browser receives a **session cookie** (`grackle_session`) that lasts 24 hours. The cookie is `HttpOnly` and `SameSite=Lax`.

### Rate limiting

Pairing is rate-limited: 5 failed attempts per IP per minute. After that, the IP is blocked for 5 minutes.

## Session cookies

After pairing, the browser uses a session cookie for authentication. The cookie contains a session ID and an HMAC-SHA256 signature (using the API key as the secret).

Session cookies are accepted by:
- Web UI HTTP requests (static files, pairing, authorization)
- WebSocket connections (as an alternative to `?token=`)

Sessions expire after 24 hours. Expired sessions are cleaned up automatically.

## OAuth 2.0 (MCP clients)

External MCP clients (like Claude Desktop or other AI tools) authenticate via **OAuth 2.0 with PKCE**:

1. Client calls `/register` for dynamic client registration
2. Client redirects user to `/authorize`
3. User approves (or enters a pairing code if not already authenticated)
4. Client exchanges authorization code for access + refresh tokens at `/token`

Key details:
- Authorization codes expire after **30 seconds** (single-use)
- Refresh tokens last **30 days** (rotated on each use)
- Client registrations expire after **7 days**
- Only loopback redirect URIs are allowed (`localhost`, `127.0.0.1`)

## Tokens

Tokens are credentials that Grackle pushes to environments so agents can authenticate with external services. They're encrypted at rest with AES-256-GCM.

```bash
# Set a token (interactive prompt for the value)
grackle token set ANTHROPIC_API_KEY

# Set from an environment variable
grackle token set GITHUB_TOKEN --env GITHUB_TOKEN

# Set from a file
grackle token set SSH_KEY --file ~/.ssh/id_ed25519 --type file --file-path ~/.ssh/id_ed25519
```

Each token specifies how it should be delivered to environments:
- **Environment variable** (default) — Injected into the agent's process environment
- **File** — Written to a path inside the environment

Tokens are automatically pushed to all connected environments when set, and to new environments when they're provisioned.

```bash
# List tokens (values are never shown)
grackle token list

# Delete a token
grackle token delete ANTHROPIC_API_KEY
```

## Credential providers

Credential providers control how Grackle authenticates with AI model providers:

```bash
grackle credential-provider list
grackle credential-provider set claude api_key
grackle credential-provider set github on
```

| Provider | Modes | Notes |
|----------|-------|-------|
| `claude` | `off`, `subscription`, `api_key` | `subscription` uses your Anthropic plan; `api_key` uses a stored token |
| `github` | `off`, `on` | Needed for Copilot runtime and Codespace adapter |
| `copilot` | `off`, `on` | GitHub Copilot authentication |
| `codex` | `off`, `on` | OpenAI API authentication |

## LAN access

By default, Grackle binds to `127.0.0.1` — only accessible from your machine. To access it from other devices on your network (like a phone or tablet):

```bash
grackle serve --allow-network
```

This binds to `0.0.0.0`. Generate a pairing code with `grackle pair` and use it from the other device.

## Security measures

- **Constant-time comparison** for API key and session signature validation (prevents timing attacks)
- **Path traversal prevention** on file token writes and static file serving
- **HMAC-SHA256** session cookie signatures (unforgeable without the API key)
- **AES-256-GCM** encryption for stored tokens (key derived via PBKDF2 from machine identity or `GRACKLE_MASTER_KEY` env var)
- **Loopback-only OAuth redirects** (prevents open redirect attacks)
