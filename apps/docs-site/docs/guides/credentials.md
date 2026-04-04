---
id: credentials
title: Credential Setup
sidebar_position: 5
---

# Credential Setup

Each agent runtime needs credentials to authenticate with its AI provider. Grackle manages this through **credential providers** and a **token broker** that encrypts secrets at rest and pushes them securely to environments on demand.

## Credential providers

Credential providers control which runtimes have access to their backing services. Configure them from the CLI or web UI.

```bash
# Check current provider status
grackle credential-provider list
```

| Provider | Modes | What it provides |
|----------|-------|-----------------|
| **Claude** | `off`, `subscription`, `api_key` | Anthropic API access for Claude Code |
| **GitHub** | `off`, `on` | GitHub token for Copilot and Codespace operations |
| **Copilot** | `off`, `on` | GitHub Copilot agent authentication |
| **Codex** | `off`, `on` | OpenAI API access for Codex |
| **Goose** | `off`, `on` | Goose provider configuration and API keys |

### Setting providers

```bash
# Use your Anthropic API key for Claude Code
grackle credential-provider set claude api_key

# Enable GitHub integration (for Copilot and Codespaces)
grackle credential-provider set github on

# Enable Codex
grackle credential-provider set codex on
```

Or configure from the web UI under **Settings > Credentials**.

## Token management

Tokens are the actual secrets — API keys, access tokens, OAuth tokens. Grackle encrypts them with AES-256-GCM at rest in `~/.grackle/grackle.db` (the main SQLite database).

### Setting tokens

```bash
# Set your Anthropic API key (prompts for the value interactively)
# --env-var specifies the exact environment variable injected into the agent process
grackle token set ANTHROPIC_API_KEY --env-var ANTHROPIC_API_KEY

# Set an OpenAI API key
grackle token set OPENAI_API_KEY --env-var OPENAI_API_KEY
```

:::note Token name vs environment variable
The first argument to `grackle token set` is the token's **name** in Grackle's store. By default the injected environment variable is `<NAME>_TOKEN` (e.g., `ANTHROPIC_API_KEY_TOKEN`). Use `--env-var` to specify the exact variable name the runtime expects.
:::

### How tokens reach agents

When a session spawns, the token broker:

1. Looks up which tokens the runtime needs
2. Decrypts them from the local store
3. Pushes them to the environment's PowerLine instance over gRPC
4. PowerLine injects them as environment variables for the agent process

For `env_var` type tokens, values exist only in the agent's process environment. For `file` type tokens, they are written to a file on the remote environment.

## Per-runtime setup

### Claude Code

Claude Code uses the [Anthropic Claude Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview).

**Option A — API key:**
```bash
grackle credential-provider set claude api_key
grackle token set ANTHROPIC_API_KEY --env-var ANTHROPIC_API_KEY
```

**Option B — Subscription (Max plan):**
```bash
grackle credential-provider set claude subscription
```
Uses your existing Claude subscription. Requires `claude` CLI to be authenticated on the machine.

### GitHub Copilot

Copilot uses the [GitHub Copilot SDK](https://github.com/features/copilot).

```bash
grackle credential-provider set github on
grackle credential-provider set copilot on
```

Requires a GitHub token with Copilot access. Set it as a token if your environment doesn't have `gh` CLI auth:

```bash
grackle token set GITHUB_TOKEN --env-var GITHUB_TOKEN
```

### OpenAI Codex

Codex uses the [OpenAI Codex SDK](https://openai.com/index/codex/).

```bash
grackle credential-provider set codex on
grackle token set OPENAI_API_KEY --env-var OPENAI_API_KEY
```

### Goose

[Goose](https://block.github.io/goose/) is provider-agnostic — it can use Anthropic, OpenAI, Google, and many other LLM providers.

```bash
grackle credential-provider set goose on
```

Configure your Goose provider and model via `goose configure` or environment variables (`GOOSE_PROVIDER`, `GOOSE_MODEL`). Goose must be [installed separately](https://block.github.io/goose/docs/getting-started/installation/) on the target environment.

Set whichever API key your chosen Goose provider requires:

```bash
# If using Anthropic as Goose's provider
grackle token set ANTHROPIC_API_KEY --env-var ANTHROPIC_API_KEY

# If using OpenAI
grackle token set OPENAI_API_KEY --env-var OPENAI_API_KEY
```

## Security details

- **Encryption**: AES-256-GCM with a randomly generated key stored in `~/.grackle/api-key`
- **Transport**: Tokens are pushed over gRPC (plain HTTP/2 by default; TLS when configured)
- **At rest**: Never stored in plaintext on disk — always encrypted in the SQLite token store
- **In process**: `env_var` type tokens exist only in the agent's process environment; `file` type tokens are written to disk on the environment
- **Timing-safe comparison**: API key validation uses constant-time comparison to prevent timing attacks

For full authentication details (API keys, pairing codes, session cookies, OAuth), see the [Authentication guide](./auth).
