---
name: test-acp-runtime
description: Spawn the ACP-variant runtimes (claude-code-acp / codex-acp / copilot-acp). Currently BLOCKED by issue #1366 (permissions.defaultMode); records models + how to test once fixed. Run with /test-acp-runtime. Pairs with /launch-grackle.
---

# Test the ACP runtimes

How to spawn the **ACP-variant** runtimes — `claude-code-acp`, `codex-acp`, `copilot-acp` — against an isolated test server. Assumes a server from `/launch-grackle` (with `GRACKLE_URL` + `GRACKLE_API_KEY` exported).

## ⚠️ Status: BLOCKED by #1366 (as of 2026-05-29)

Spawning any ACP runtime fails at session creation:

```
ACP newSession failed: {"code":-32603,"message":"Internal error","data":{"details":"Invalid permissions.defaultMode: auto."}}
```

Tracked in **#1366**. The `"auto"` value is not set in `packages/runtime-acp/src/` — it comes from the `@agentclientprotocol/sdk`, the agent CLI, or a passed config. ACP runtimes are unspawnable until that's resolved.

## Model names

ACP runtimes are listed as model "(agent-selected)" by `grackle runtimes`, **but a persona still requires a model** (spawn errors with `FailedPrecondition: persona has no model configured` otherwise):

| Runtime           | Model to pass                                                                        |
| ----------------- | ------------------------------------------------------------------------------------ |
| `claude-code-acp` | `sonnet` / `opus` / `haiku` (runs Claude underneath)                                 |
| `codex-acp`       | a Codex model (subject to the same ChatGPT-account gating — see /test-codex-runtime) |
| `copilot-acp`     | a Copilot model, e.g. `claude-sonnet-4.5` (see /test-copilot-runtime)                |

## Spawn it (once #1366 is fixed)

```bash
grackle persona create "ACP Tester" --runtime claude-code-acp --model sonnet --prompt "You are a test agent."
grackle spawn local "Run exactly this one shell command and nothing else, then stop: cat /nonexistent_file_xyz" --persona acp-tester
```

## Why ACP is worth testing

Unlike **native** `claude-code` (which emits synthetic empty `tool_result`s and can't surface failures — see /test-claude-runtime), the ACP path carries a **real** `tool_call_update` `status` (`completed` vs `failed`). The adapter maps `status === "failed"` → first-class `toolError: true` (`packages/runtime-acp/src/acp.ts`). So `claude-code-acp` is the way to observe a **real Claude tool failure** end-to-end once #1366 is fixed.

Inspect `$GRACKLE_HOME/.grackle/logs/<session-id>/stream.jsonl` for `tool_result` `{is_ok,...}` + `"tool_error":true`.

## See also

- `/launch-grackle`, `/test-claude-runtime`, `/test-copilot-runtime`, `/test-codex-runtime`
- Issue #1366 (the blocker)
