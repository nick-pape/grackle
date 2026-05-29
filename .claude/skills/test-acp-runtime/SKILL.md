---
name: test-acp-runtime
description: Spawn the ACP-variant runtimes (claude-code-acp / codex-acp / copilot-acp). claude-code-acp validated; it surfaces real tool failures that native claude-code can't. Run with /test-acp-runtime. Pairs with /launch-grackle.
---

# Test the ACP runtimes

How to spawn the **ACP-variant** runtimes — `claude-code-acp`, `codex-acp`, `copilot-acp` — against an isolated test server. Assumes a server from `/launch-grackle` (with `GRACKLE_URL` + `GRACKLE_API_KEY` exported).

> **Why ACP matters:** the native runtimes (`claude-code`/`copilot`/`codex`) are slated to be deprecated in favor of these ACP variants. ACP is a standard protocol with a uniform `tool_call_update` `status` (`completed`/`failed`), so one adapter (`runtime-acp`) covers all agents — and unlike **native** `claude-code` (which emits synthetic empty `tool_result`s and can't surface failures), `claude-code-acp` reports **real** tool failures.

## Model names

ACP runtimes are listed as model "(agent-selected)" by `grackle runtimes`, **but a persona still requires a model** (spawn errors with `FailedPrecondition: persona has no model configured` otherwise):

| Runtime           | Model to pass                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `claude-code-acp` | `sonnet` / `opus` / `haiku` (runs Claude underneath) — **validated with `sonnet`**             |
| `codex-acp`       | a Codex model (same ChatGPT-account gating as native — use `gpt-5.5`; see /test-codex-runtime) |
| `copilot-acp`     | a Copilot model, e.g. `claude-sonnet-4.5` (see /test-copilot-runtime)                          |

## Spawn it

```bash
grackle persona create "ACP Tester" --runtime claude-code-acp --model sonnet --prompt "You are a test agent."
grackle spawn local "Run exactly this one shell command and nothing else, then stop: cat /nonexistent_file_xyz" --persona acp-tester
```

## What it proves (confirmed live 2026-05-29)

- **Spawns cleanly.** The earlier `Invalid permissions.defaultMode: auto` failure (#1366) is fixed by #1370 — `claude-code-acp` now isolates its `CLAUDE_CONFIG_DIR` from your personal `~/.claude` (which may carry the interactive-only `defaultMode: "auto"`).
- **Surfaces real tool failures.** A failing command (`cat /nonexistent`) produced a `tool_result` with `content {is_ok:false}` + `"tool_error":true` and the real `Exit code 1` / `No such file` text — via the adapter's `status === "failed"` → `toolError` mapping (`packages/runtime-acp/src/acp.ts`). This is the case **native** `claude-code` cannot express.

## Inspecting results

```
$GRACKLE_HOME/.grackle/logs/<session-id>/stream.jsonl
```

`tool_result` content = `{is_ok, content, past_tense_message}`; failures carry `"tool_error":true`.

## See also

- `/launch-grackle`, `/test-claude-runtime`, `/test-copilot-runtime`, `/test-codex-runtime`
- #1366 / #1370 (the spawn fix)
