---
id: voice
title: Voice
unlisted: true
---

# Voice

Grackle's docs have a voice. Hold it. This page is the reference — read it before writing or editing a page.

## The register

Dark Folkish. The voice of someone who has seen what happens when you hand an AI ambient credentials and walked away. Confident. Faintly menacing. Never cute.

- Short sentences. Fragments allowed. Rhythm matters.
- Treat agents as serious tools, not friendly assistants. No "Let's get started!", no "Happy coding!", no exclamation-point cheer.
- Imply failure modes; don't lecture them. _"When one does something stupid at 3 AM, you know which one."_
- No hype words: revolutionary, next-gen, AI-powered, seamless, powerful, robust, blazing-fast, effortless. Cut them.
- Don't explain the metaphor. Inhabit it.

## The metaphor (use sparingly)

Birds on wires. Grackles are loud, sharp, and they travel in numbers. The name carries the mood; PowerLine is the wire agents run on. The metaphor sets the _tone_ — it is not a vocabulary you sprinkle on every noun.

For now, keep the literal bird-nouns out of the prose:

- **Don't** call a running agent a "claw." Call it what the sentence means — **an agent**, **a session**, or **a task**.
- **Don't** call many agents "a plague" or "a mob." Say **many agents**, **a fleet of agents**, or just **Grackle**.
- "**wire**" for PowerLine is fine as an occasional descriptor; don't lean on "perch."

The full bird lexicon (plague, claw, mob, flock, roost, nest, gate) is held in reserve for top-level brand surfaces and the [Roadmap](./roadmap), not working docs. When in doubt, use the plain technical noun.

Do **not** use these as product names — they are splits we have not built:

- **roost, nest, gate** — someday GrackleRoost / GrackleNest / GrackleGate. Today there is "the server," "approval," and so on. Don't write them as if they ship. Anything on the drawing board goes in [Roadmap](./roadmap), never in a feature or concept page.

## Nouns stay technical

The voice is a skin over accurate docs. Headings and the words a reader types stay literal and match the CLI: **environment, session, task, persona, workspace, runtime, plugin**. Flavor lives in the rhythm and the menace, not in renamed nouns — and never rename a command.

> A task runs as a **session**. Spawn one, watch it work, kill it when it strays.
>
> `grackle spawn prod "..."` → a session on the wire.

## Page shape

- Tight. Skimmable in about 30 seconds.
- Lead with the thing, not throat-clearing. The first line says what this is or does.
- Show the command, then a line or two on what it does — not a paragraph.
- Tables and short lists over walls of prose.
- One job per page. Link out instead of re-explaining.
- End a recipe by pointing at the next step.

## Do / don't

| Don't                                                                                         | Do                                                                                    |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| "Welcome! In this guide we'll walk through spawning your first agent session. Let's dive in!" | "Spawn an agent, give it a task, watch it work."                                      |
| "Grackle's powerful orchestration engine enables seamless multi-agent coordination."          | "One agent decomposes the work and hands pieces to others. They report back."         |
| "Don't worry if a session disconnects — Grackle has you covered!"                             | "Wires drop. The session suspends, events buffer, and it picks up where it left off." |

When in doubt: shorter, colder, truer.
