---
name: test-copilot-runtime
description: Spawn and exercise the `copilot` runtime against a test server. CRITICAL: gpt-4o does NOT work — use claude-sonnet-4.5. Run with /test-copilot-runtime. Pairs with /launch-grackle.
---

# Test the GitHub Copilot runtime

How to spawn the **`copilot`** runtime against an isolated test server. Assumes a server from `/launch-grackle` (with `GRACKLE_URL` + `GRACKLE_API_KEY` exported).

## Allowed model names ✅ / ❌

| Model               | Works?                | Notes                                                                                                                                         |
| ------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-sonnet-4.5` | ✅ **confirmed live** | The `@github/copilot-sdk` README default; spawns and runs                                                                                     |
| `gpt-5`             | ⚠️ likely             | Documented for Copilot CLI; not individually confirmed here                                                                                   |
| `claude-sonnet-4`   | ⚠️ likely             | From GitHub's supported-models docs                                                                                                           |
| `claude-haiku-4.5`  | ⚠️ likely             | From GitHub's supported-models docs                                                                                                           |
| `gpt-4o`            | ❌ **does NOT work**  | `Model "gpt-4o" is not available.` GPT-4o is intentionally absent from the Copilot **CLI/SDK** (only in Copilot Chat + the VS Code extension) |

> ⚠️ **`grackle runtimes` advertises `gpt-4o` for copilot — that is wrong/unavailable for the CLI.** Use **`claude-sonnet-4.5`**. (Catalog entry: `packages/common/src/runtime-catalog.ts`; worth fixing — see the runtime-catalog.)

## Spawn it

```bash
grackle persona create "Copilot Tester" --runtime copilot --model claude-sonnet-4.5 \
  --prompt "You are a test agent. When asked to run a command, use your shell tool to run exactly that one command and nothing else."
grackle spawn local "Use your shell tool to run exactly this one command, then stop: cat /nonexistent_file_xyz" --persona copilot-tester
```

## What it proves (outcome signal)

Copilot surfaces real per-tool outcomes on the `tool.execution_complete` event (`data.success` / `data.error`), which the adapter lifts to the first-class `toolError` field (`packages/runtime-copilot/src/copilot.ts`).

**Confirmed live (#1362):** a failing tool execution persisted as `content: {"is_ok":false,...}` **and** `"tool_error":true`. Copilot is the cleanest way to exercise the real tool-failure path end-to-end (native claude-code can't — see /test-claude-runtime).

## Inspecting results

```
$GRACKLE_HOME/.grackle/logs/<session-id>/stream.jsonl
```

`tool_result` content = `{is_ok, content, past_tense_message}`; failures carry `"tool_error":true`.

## See also

- `/launch-grackle`, `/test-claude-runtime`, `/test-codex-runtime`, `/test-acp-runtime`
