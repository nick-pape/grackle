---
id: scripting
title: Scripting (GenAIScript)
sidebar_position: 1
---

# Scripting (GenAIScript)

Not every claw needs an LLM. Some run deterministic TypeScript — a linter, a formatter, an analyzer, a nightly report — under the same task and session primitives as the agents.

That is a **script persona**: a [GenAIScript](../building-blocks/personas-runtimes) program that runs to completion. No conversation, no turn limit, no model required. It starts, it does the work, it ends.

## Script or agent

| Use a **script persona** when…              | Use an **agent persona** when…           |
| ------------------------------------------- | ---------------------------------------- |
| The steps are fixed and you wrote them down | The steps depend on what the agent finds |
| You want the same result every run          | You want judgment, not a procedure       |
| No model call is needed                     | A model drives the work, turn by turn    |

A script can still call a model if it wants to — GenAIScript exposes one. But it decides when, not the runtime. That is why a script persona needs no model of its own.

## Create one

```bash
grackle persona create "Nightly Report" \
  --type script \
  --script-file ./scripts/report.genai.mjs
```

Two flags do the work:

- `--type script` — marks the persona as a script, not an agent.
- `--script-file <path>` — reads the GenAIScript source from disk. Pass the source inline with `--script "<code>"` instead.

The runtime defaults to `genaiscript` for script personas, so `--runtime` is optional. So is `--model` — a script persona is allowed to have none. Leave the prompt off; it isn't used.

A minimal script:

```js
// report.genai.mjs
const files = await workspace.findFiles("**/*.test.ts");
def("TESTS", files);
$`Count the test files and list any that lack an assertion.`;
```

## How it runs

A script persona slots into a [task](../getting-started/create-task) like any other claw. Spawn a session against it, and PowerLine runs the script on the wire:

- It runs **once**. One run is one turn. When the script exits, the session goes idle — done.
- It does **not** take interactive input, and it cannot be resumed. Kill it and it stops.
- Progress streams back as it works — `console.log` and GenAIScript's own progress land as session events, same as an agent's output. The final result text comes back when it finishes.

A nonzero exit, or a script that reports failure, ends the session as **failed**. Everything else ends **idle**.

## Next

- [Personas and runtimes](../building-blocks/personas-runtimes) — the full persona model.
- [Create a task](../getting-started/create-task) — give your script something to run against.
