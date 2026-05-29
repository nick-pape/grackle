---
name: test-codex-runtime
description: Spawn the `codex` runtime against a test server. Use model `gpt-5.5` (requires Codex SDK >= 0.135.0). Run with /test-codex-runtime. Pairs with /launch-grackle.
---

# Test the Codex runtime

How to spawn the **`codex`** runtime against an isolated test server. Assumes a server from `/launch-grackle` (with `GRACKLE_URL` + `GRACKLE_API_KEY` exported).

## Allowed model names ✅ / ❌ (ChatGPT-account auth)

| Model                                                            | Works?                | Notes                                                                                                                                                                |
| ---------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gpt-5.5`                                                        | ✅ **confirmed live** | Needs **Codex SDK >= 0.135.0** (the catalog pin). On the old 0.111.0 it errored "requires a newer version of Codex."                                                 |
| `o3`, `o3-mini`, `gpt-5-codex`, `gpt-5`, `gpt-5.1`, `gpt-5-mini` | ❌                    | "not supported when using Codex with a ChatGPT account" — these are **account-gated** (likely need OpenAI API-key auth or a higher tier), independent of SDK version |

> The catalog (`packages/common/src/runtime-catalog.ts`) advertises **`gpt-5.5`** and pins `@openai/codex-sdk ^0.135.0`. If `grackle runtimes` still shows `o3`, the catalog hasn't been rebuilt/installed.

History: the SDK was bumped `^0.111.0 → ^0.135.0` precisely to unlock `gpt-5.5` (validated 2026-05-29). The runtime installer (`runtime-installer.ts`) auto-reinstalls when the catalog spec changes (it compares the persisted package spec), so the global `~/.grackle/runtimes/codex/` upgrades on the next codex spawn.

## Spawn it

```bash
grackle persona create "Codex Tester" --runtime codex --model gpt-5.5 --prompt "You are a test agent."
grackle spawn local "Run exactly this one shell command and nothing else, then stop: cat /nonexistent_file_xyz" --persona codex-tester
```

The model string is passed **verbatim** to the SDK (`packages/runtime-codex/src/codex.ts` — `threadOptions.model = this.model`); Grackle does no validation, so any model the installed Codex accepts is valid.

## What it proves (confirmed live #1362)

Codex surfaces real per-tool outcomes by type — `command_execution` non-zero `exit_code`, `file_change` `status`, `mcp_tool_call` `error` — lifted to the first-class `toolError` field. Verified end-to-end: a failing command (`cat /nonexistent` → `[exit 1]`) persisted as `content {is_ok:false}` **and** `"tool_error":true`. A successful command omits `tool_error`.

## Inspecting results

```
$GRACKLE_HOME/.grackle/logs/<session-id>/stream.jsonl
```

`tool_result` content = `{is_ok, content, past_tense_message}`; failures carry `"tool_error":true`. Model-gating rejections show up as `error` + `status: failed` events (check the log to distinguish a rejection from a real run).

## See also

- `/launch-grackle`, `/test-claude-runtime`, `/test-copilot-runtime`, `/test-acp-runtime`
