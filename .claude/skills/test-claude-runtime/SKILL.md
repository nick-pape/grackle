---
name: test-claude-runtime
description: Spawn and exercise the native `claude-code` runtime against a test server, including the model names that work and the synthetic-tool-result gotcha. Run with /test-claude-runtime. Pairs with /launch-grackle.
---

# Test the Claude Code runtime

How to spawn the **native `claude-code`** runtime against an isolated test server and observe its behavior. Assumes you've started a server with `/launch-grackle` (and have `GRACKLE_URL` + `GRACKLE_API_KEY` exported).

## Allowed model names ✅

| Model    | Works? | Notes                                                           |
| -------- | ------ | --------------------------------------------------------------- |
| `sonnet` | ✅     | Default persona (`claude-code` / "Software Engineer") uses this |
| `opus`   | ✅     |                                                                 |
| `haiku`  | ✅     |                                                                 |

No model gating — native Claude Code works out of the box (subscription/OAuth). These are the values `grackle runtimes` advertises and they all spawn.

## Spawn it

The default persona already uses `claude-code`:

```bash
grackle spawn local "<prompt>"                       # uses default persona (claude-code / sonnet)
```

Or make an explicit persona (e.g. to pick opus):

```bash
grackle persona create "Claude Opus Tester" --runtime claude-code --model opus --prompt "You are a test agent."
grackle spawn local "<prompt>" --persona claude-opus-tester
```

## ⚠️ Key gotcha: native Claude Code does NOT surface real tool failures

The Claude Agent SDK runs tools **internally** and (in streaming mode) does **not** emit real `tool_result` blocks with `is_error`. The adapter instead emits **synthetic empty** `tool_result` events that are always successful (`flushPendingToolResults` → `content: "", is_error: false`).

Verified live: prompting Claude Code to run a failing command (`cat /nonexistent`) produced `tool_result` events with `content: {"is_ok":true,...}` (empty) — the failure was **not** observable. This is the separate **bug 1c** (filed off #1355).

**Implication:** you cannot demonstrate a tool _failure_ through native `claude-code`. The adapter's `b.is_error` read (`packages/runtime-claude-code/src/claude-code.ts`) is only exercised when the SDK _does_ surface `tool_result` blocks (some non-streaming modes). To observe a real Claude tool failure, use the **ACP** variant (see /test-acp-runtime — now that #1366 is fixed) — its `tool_call_update` carries a real `status: failed` (validated live).

## Inspecting results

Tool outcomes land in the session's JSONL log:

```
$GRACKLE_HOME/.grackle/logs/<session-id>/stream.jsonl
```

Each `tool_result` event has `content` = `{is_ok, content, past_tense_message}`, and failures additionally carry a first-class `"tool_error":true` (AHP #1362). Success omits `tool_error` (proto3 drops default-false).

## See also

- `/launch-grackle` — start the isolated server first
- `/test-copilot-runtime`, `/test-codex-runtime`, `/test-acp-runtime` — sibling runtimes (and their very different model-name rules)
