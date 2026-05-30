---
id: credentials
title: Credentials & Access
sidebar_position: 7
---

# Credentials & Access

Every claw gets its own name and its own key. Hand an agent ambient credentials and you lose the thread the moment one does something stupid at 3 AM. Grackle keeps the secrets, decides which runtimes may touch them, and pushes them onto the wire only when a session needs them. Every move leaves its name in the log.

This page covers three things: what each runtime is allowed to authenticate against (**credential providers**), the secrets themselves and how they reach the wire (**the token broker**), and who is allowed to reach the server at all (**access**).

## Credential providers

A provider is a gate, per runtime. It decides whether a runtime may authenticate against its backing service at all. Off means off — no token reaches a claw it isn't cleared for.

```bash
# What's allowed right now
grackle credential-provider list
```

| Provider    | Modes                            | Gates                                             |
| ----------- | -------------------------------- | ------------------------------------------------- |
| **Claude**  | `off`, `subscription`, `api_key` | Anthropic access for Claude Code                  |
| **GitHub**  | `off`, `on`                      | GitHub token for Copilot and Codespace operations |
| **Copilot** | `off`, `on`                      | GitHub Copilot agent authentication               |
| **Codex**   | `off`, `on`                      | OpenAI access for Codex                           |
| **Goose**   | `off`, `on`                      | Goose provider configuration and API keys         |

Claude takes a third mode. `api_key` spends a stored Anthropic key. `subscription` rides your existing Max plan and needs the `claude` CLI already authenticated on the machine — no key stored.

```bash
grackle credential-provider set claude api_key
grackle credential-provider set claude subscription
grackle credential-provider set github on
grackle credential-provider set codex on
```

Or set them in the web UI under **Settings → Credentials**.

Run `grackle runtimes` to see every runtime alongside its credential needs — including the ACP-bridged ones (`codex-acp`, `copilot-acp`, `claude-code-acp`, and `goose`). That list is the authority on what each runtime expects.

## The token broker

Tokens are the actual secrets — API keys, access tokens, OAuth tokens. Grackle holds them encrypted and decides when they reach the wire. A token has a **name** in the store and a **shape** on the way out: injected as an environment variable, or written to a file on the environment.

```bash
# Prompts for the value
grackle token set ANTHROPIC_API_KEY --env-var ANTHROPIC_API_KEY

# List names only — values never print
grackle token list

# Delete one
grackle token delete ANTHROPIC_API_KEY
```

### Name, value source, target

Three things get confused. Keep them apart.

| Part            | What it is                                                                            |
| --------------- | ------------------------------------------------------------------------------------- |
| First argument  | The token's **name** in Grackle's store.                                              |
| `--env`         | **Where the value comes from** — read from one of _your_ local environment variables. |
| `--file <path>` | **Where the value comes from** — read from a file on disk.                            |
| `--env-var`     | **The target variable name on the wire** — what the runtime reads.                    |

With neither `--env` nor `--file`, `grackle token set` prompts for the value.

By default the injected variable is `<NAME>_TOKEN` — name `ANTHROPIC_API_KEY` lands as `ANTHROPIC_API_KEY_TOKEN`. Most runtimes want a specific name. Set it with `--env-var`:

```bash
# Value read from your local OPENAI_API_KEY; lands on the wire as OPENAI_API_KEY
grackle token set OPENAI_API_KEY --env OPENAI_API_KEY --env-var OPENAI_API_KEY

# Value read from a file; written as a file on the environment
grackle token set SSH_KEY --file ~/.ssh/id_ed25519 --type file
```

### How a token reaches a claw

Nothing is pushed ahead of need. When a session spawns, the broker authenticates to that environment's PowerLine on demand:

1. Look up which tokens the runtime needs.
2. Decrypt them from the local store.
3. Call **Authenticate** on the environment's PowerLine over gRPC, naming the provider and token.
4. PowerLine writes them — `env_var` tokens into the agent's process environment, `file` tokens to a path on the environment.

`env_var` values live only in the agent's process. `file` values are written to disk on the environment. Neither lands until a claw is there to use it, and every delivery is named in the log.

## GitHub accounts (multi-identity)

One GitHub token is one identity. Run a plague across repos owned by different identities and a single token won't do. Register accounts under labels and pick which one is default.

```bash
# Register an account with a PAT. Username resolves automatically if omitted.
grackle github-account add work --token <pat> --default

# List — label, username, default, created date
grackle github-account list

# Switch the default
grackle github-account set-default work

# Remove by label or id
grackle github-account remove work

# Pull accounts in from your local `gh auth status`
grackle github-account import
```

`add` takes a required `--token`, optional `--username` (resolved from the PAT when omitted), and `--default`. `remove` and `set-default` accept either the label or the account id. `import` reads the local `gh` CLI auth state and skips accounts already registered.

## Access

Two ways in, two credentials. Don't cross them.

| Caller           | Credential                        |
| ---------------- | --------------------------------- |
| Web UI           | **Pairing code → session cookie** |
| CLI / gRPC / MCP | **Bearer API key**                |

### The API key (gRPC and MCP)

A 256-bit hex string, generated the first time you run `grackle serve`, stored at `~/.grackle/api-key`. The CLI reads it for you. Sent as `Authorization: Bearer <key>` on every gRPC call, and used as the full-access token for MCP clients. From another machine, hand it over by environment:

```bash
export GRACKLE_API_KEY=<your-key>
grackle env list
```

### Pairing code → session cookie (web)

The browser never sees the API key. It earns a session by pairing.

```bash
grackle pair
```

Prints a code, a URL, and a QR. Enter the code in the web UI or scan it from a phone. The code is single-use and dies in 5 minutes. On success the browser holds a session cookie — `HttpOnly`, `SameSite=Lax`, HMAC-SHA256 signed with the API key, good for 24 hours. Pairing is rate-limited: 5 failed attempts per IP per minute, then a 5-minute block.

### Reaching it from the network

The server binds to `127.0.0.1`. Local only, by default. To let a phone or tablet on your network reach it:

```bash
grackle serve --allow-network
```

Now it binds `0.0.0.0`. Generate a code with `grackle pair` and pair from the other device.

## At rest

- **AES-256-GCM** on every stored token. Never plaintext on disk.
- **Master key** from `GRACKLE_MASTER_KEY`, or a persisted key file at `~/.grackle/master-key` when that's unset.
- **Constant-time comparison** on API-key and session-signature checks — no timing leaks.
- **Path-traversal guards** on file-token writes and static serving.
- **Transport**: tokens cross to PowerLine over gRPC on HTTP/2. The built-in server speaks plain HTTP/2 — put TLS in front of it (reverse proxy or terminating load balancer) for anything past localhost.

## Next

- [Install Grackle](../getting-started/installation) if you haven't.
- [Connect an MCP client](./mcp-server) — it authenticates with the API key.
- [Personas and runtimes](../building-blocks/personas-runtimes) — what each runtime expects.
- [Scoped webhook tokens](../advanced/webhooks) — credentials for inbound triggers.
