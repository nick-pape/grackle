---
id: personas-runtimes
title: Personas & Runtimes
sidebar_position: 3
---

# Personas & Runtimes

A **persona** is the recipe for an agent — a named, reusable agent config. A **runtime** is the engine it flies on. Pick a runtime and model, write the prompt, set the limits. Spawn the persona; the agent runs as a session.

## What a persona holds

| Field                 | What it sets                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Name**              | Display name (e.g. `Senior Reviewer`).                                                                      |
| **Type**              | `agent` (interactive session) or `script` (run-to-completion). See below.                                   |
| **Runtime**           | A [runtime](#runtime-catalog) catalog key (`claude-code`, `copilot`, `codex`, `genaiscript`, ACP variants). |
| **Model**             | The model to drive (`sonnet`, `gpt-4o`, …). Required for agents, optional for scripts.                      |
| **System prompt**     | Prepended to every session.                                                                                 |
| **Max turns**         | Turn limit. `0` = unlimited.                                                                                |
| **Tool config**       | Allow / deny lists over the agent's runtime tools (`Write`, `Edit`, `Bash`).                                |
| **MCP servers**       | Extra MCP servers the agent can reach, each with its own optional tool allowlist.                           |
| **Allowed MCP tools** | Persona-scoped allowlist over Grackle's own [MCP tools](#built-in-mcp-tools).                               |

## Agent vs. script

Every persona has a type.

- **`agent`** (default) — an interactive session. The runtime drives a model through the work, turn by turn, until the task is done or the turn limit bites. A model is required.
- **`script`** — a [GenAIScript](../advanced/scripting) program that runs to completion. The `script` field holds the source, or load it from a file. No model required; the script decides which models, if any, it calls.

```bash
# A script persona that runs to completion
grackle persona create "Nightly Report" \
  --type script \
  --runtime genaiscript \
  --script-file ./scripts/report.genai.mjs
```

## Create one

```bash
grackle persona create "Senior Reviewer" \
  --runtime claude-code \
  --model sonnet \
  --prompt "You are a senior code reviewer. Correctness, security, maintainability. Do not change code — review and report." \
  --max-turns 5
```

Load the prompt from a file instead:

```bash
grackle persona create "Architect" \
  --runtime claude-code \
  --model sonnet \
  --prompt-file ./prompts/architect.md
```

From the web UI: **Settings → Personas → Create**.

On first run Grackle seeds one persona — Claude Code on `sonnet`. The setup wizard lets you swap the runtime. It is used whenever nothing else is specified.

## Resolution cascade

When a session starts, Grackle walks down until it finds a persona. First non-empty value wins.

1. **Request** — the `--persona` flag on spawn/start.
2. **Task** — the persona pinned to the task.
3. **Workspace** — the persona pinned to the workspace.
4. **App** — the global default.

## Runtime catalog

A runtime is the agent engine that does the work inside a session. Swap it without touching anything else. Two families: **native** runtimes wrap a vendor SDK directly; **ACP-bridged** runtimes reach their agent over the cross-vendor Agent Client Protocol.

### Native

| Runtime        | ID            | Default model    | Models                    | SDK                        |
| -------------- | ------------- | ---------------- | ------------------------- | -------------------------- |
| Claude Code    | `claude-code` | `sonnet`         | `sonnet`, `opus`, `haiku` | Anthropic Claude Agent SDK |
| GitHub Copilot | `copilot`     | `gpt-4o`         | `gpt-4o`                  | GitHub Copilot SDK         |
| Codex          | `codex`       | `gpt-5.5`        | `gpt-5.5`                 | OpenAI Codex SDK           |
| GenAIScript    | `genaiscript` | _script-defined_ | _script-defined_          | GenAIScript CLI            |

Native runtimes carry the full feature set: streaming, tool use, session resume, MCP integration, worktree isolation. GenAIScript is a scripting runtime, not a conversational agent — it powers [script personas](../advanced/scripting).

### ACP-bridged (experimental)

These speak the **Agent Client Protocol**. Experimental. The catalog exposes no fixed model list — selection is provider-dependent.

| Runtime           | ID                | Bridge                                            |
| ----------------- | ----------------- | ------------------------------------------------- |
| Goose             | `goose`           | Native ACP (`goose acp`)                          |
| Codex (ACP)       | `codex-acp`       | stdio bridge (`@zed-industries/codex-acp`)        |
| Copilot (ACP)     | `copilot-acp`     | stdio bridge (`copilot --acp --stdio`)            |
| Claude Code (ACP) | `claude-code-acp` | stdio bridge (`@zed-industries/claude-agent-acp`) |

Goose is provider-agnostic — Anthropic, OpenAI, Google, others. Point it via `goose configure` or `GOOSE_PROVIDER` / `GOOSE_MODEL`, and install Goose on the host yourself.

### Host-agnostic, installed on demand

Runtimes are host-agnostic. The host does not report availability — PowerLine lazily `npm`-installs a runtime's packages the first time it is used. The whole catalog is reachable on any environment: Local, Docker, SSH, Codespace. "Available" means "in the catalog," nothing more.

So there is no per-runtime support list to memorize. Note that not every runtime × environment pair is exercised by CI, so the experimental ones may need extra setup on a given host.

## Choosing a runtime

A runtime is chosen through its persona. Override per-session with `--persona`:

```bash
grackle spawn my-env "Fix the bug" --persona copilot-engineer
```

Or change the default persona's runtime in the web UI under **Settings → Personas**.

## Tool config

Personas gate which runtime tools the agent gets:

- **Allowed** — whitelist.
- **Disallowed** — blacklist.

Block `Write`, `Edit`, and `Bash` for a read-only reviewer. Allow a narrow set for a focused specialist.

## MCP servers

A persona can attach extra MCP servers — database clients, API explorers, doc search — without touching the global config. Each server names a command, its args, and an optional allowlist of tools from that server.

## Built-in MCP tools

Separate from tool config and from per-server tool lists. The **allowed MCP tools** field (`allowed_mcp_tools`) is a persona-scoped allowlist over Grackle's own [MCP tools](../features/mcp-server) — the tools the agent uses to coordinate with Grackle itself (`task_create`, `task_list`, and so on). Empty means the agent gets the default scoped set.

Three distinct controls, then:

- **Tool config** — the agent's runtime tools (`Write`, `Edit`, `Bash`).
- **MCP server tools** — an allowlist scoped to one external MCP server the persona adds.
- **Allowed MCP tools** — the allowlist over Grackle's built-in tools.

Use a preset instead of listing tools by hand:

```bash
# Preset: default, worker, orchestrator, or admin
grackle persona create "Worker" --prompt "You are a worker." --mcp-tools-preset worker

# Or name tools explicitly
grackle persona create "Reporter" --prompt "..." --mcp-tools task_list,task_search,task_show
```

| Preset           | Reach                                                       |
| ---------------- | ----------------------------------------------------------- |
| **default**      | Baseline scoped set for task agents.                        |
| **worker**       | Strict subset for leaf-task execution. No subtask creation. |
| **orchestrator** | `default` plus task-coordination and delegation tools.      |
| **admin**        | The broadest set — every registered tool.                   |

## Credentials

Each runtime needs credentials to reach its provider. Grackle injects them through [credential providers](../features/credentials):

| Provider | Modes                            | Reaches                                |
| -------- | -------------------------------- | -------------------------------------- |
| Claude   | `off`, `subscription`, `api_key` | Anthropic API access                   |
| GitHub   | `off`, `on`                      | GitHub token for Copilot and Codespace |
| Copilot  | `off`, `on`                      | GitHub Copilot auth                    |
| Codex    | `off`, `on`                      | OpenAI API access                      |
| Goose    | `off`, `on`                      | Goose config and provider API keys     |

```bash
grackle credential-provider set claude api_key
grackle credential-provider set github on
```

Or in the web UI under **Settings → Credentials**.

## Managing personas

```bash
grackle persona list                              # list all
grackle persona show <id>                          # full detail, including the prompt
grackle persona edit <id> --model opus --max-turns 10
grackle persona delete <id>
```

## Next

- [Create an orchestration](../getting-started/create-orchestration) — put a persona to work.
- [Tasks & sessions](./tasks-sessions) — what an agent runs against.
- [Credentials](../features/credentials) — names and keys for every agent.
- [Scripting](../advanced/scripting) — script personas and GenAIScript.
