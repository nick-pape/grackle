---
name: test-codex-runtime
description: Spawn the `codex` runtime against a test server. WARNING: with a ChatGPT-account login + Codex SDK 0.111.0, every tested model was rejected — records the rejected list. Run with /test-codex-runtime. Pairs with /launch-grackle.
---

# Test the Codex runtime

How to spawn the **`codex`** runtime against an isolated test server. Assumes a server from `/launch-grackle` (with `GRACKLE_URL` + `GRACKLE_API_KEY` exported).

## ⚠️ Status: blocked on a ChatGPT account (as of 2026-05-29)

With **ChatGPT-account auth** and the installed **Codex SDK `0.111.0`**, **no tested model worked** — Codex could not be spawned successfully. Recorded so future testers don't repeat the guess-and-check:

| Model         | Result                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `o3`          | ❌ "not supported when using Codex with a ChatGPT account" (this is what `grackle runtimes` advertises) |
| `o3-mini`     | ❌ same                                                                                                 |
| `gpt-5-codex` | ❌ same                                                                                                 |
| `gpt-5`       | ❌ same                                                                                                 |
| `gpt-5.1`     | ❌ same                                                                                                 |
| `gpt-5-mini`  | ❌ same                                                                                                 |
| `gpt-5.5`     | ❌ "requires a newer version of Codex. Please upgrade" (SDK 0.111.0 too old)                            |

Two distinct walls: most models are **account-gated** ("not supported … with a ChatGPT account"), and the newest (`gpt-5.5`) is **CLI-version-gated**.

## How to get Codex working (hypotheses to try)

Pick one, then **record the model that works in the table above**:

1. **OpenAI API-key auth** instead of a ChatGPT account — the account gating wording strongly implies API-key auth unlocks more models.
2. **A higher ChatGPT tier** (Pro/Team) that includes Codex model access.
3. **A newer Codex SDK** (`@openai/codex-sdk` > 0.111.0, installed under `~/.grackle/runtimes/codex/`) so `gpt-5.5`/`gpt-5.x-codex` are recognized.

The model string is passed **verbatim** to the SDK (`packages/runtime-codex/src/codex.ts` — `threadOptions.model = this.model`); Grackle does no validation, so any string the installed Codex accepts is valid.

## Spawn it (once a working model is known)

```bash
grackle persona create "Codex Tester" --runtime codex --model <WORKING_MODEL> --prompt "You are a test agent."
grackle spawn local "Run exactly this one shell command and nothing else, then stop: cat /nonexistent_file_xyz" --persona codex-tester
```

Errors surface as `error` + `status: failed` events in the session log — check there to distinguish a model-gating rejection from a real run.

## What it would prove

Codex surfaces real per-tool outcomes by type: `command_execution` non-zero `exit_code`, `file_change` `status`, `mcp_tool_call` `error` — all lifted to the first-class `toolError` field (`packages/runtime-codex/src/codex.ts`). Inspect `$GRACKLE_HOME/.grackle/logs/<session-id>/stream.jsonl` for `tool_result` `{is_ok,...}` + `"tool_error":true`.

## See also

- `/launch-grackle`, `/test-claude-runtime`, `/test-copilot-runtime`, `/test-acp-runtime`
