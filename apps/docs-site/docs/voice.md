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

## The metaphor (load-bearing)

Birds on wires. Grackles are loud, sharp, and they travel in numbers. The product is named for them; PowerLine is where they perch.

Use these — they map to things that exist:

| Word                 | Means                                                        |
| -------------------- | ------------------------------------------------------------ |
| **claw**             | a running agent (the technical term stays `session`)         |
| **wire** / PowerLine | the host inside an environment where the agent actually runs |
| **perch**            | an agent landing and running on a wire                       |
| **plague**           | many claws at once (the actual collective noun for grackles) |
| **mob**              | a plague swarming a single problem                           |
| **name + key**       | every agent gets its own identity and its own credentials    |

Do **not** use these as names — they are product splits we have not built:

- **roost, nest, gate** — someday GrackleRoost / GrackleNest / GrackleGate. Today there is "the server," "approval," and so on. Don't write them as if they ship. Anything still on the drawing board goes in [Roadmap](./roadmap), never in a feature or concept page.

## Nouns stay technical

The voice is a skin over accurate docs. Headings and the words a reader types stay literal and match the CLI: **environment, session, task, persona, workspace, runtime, plugin**. Flavor lives in the prose around them — never rename a command.

> A claw runs as a **session**. Spawn one, watch it work, kill it when it strays.
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

| Don't                                                                                         | Do                                                                                 |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| "Welcome! In this guide we'll walk through spawning your first agent session. Let's dive in!" | "Spawn a claw, give it a task, watch it work."                                     |
| "Grackle's powerful orchestration engine enables seamless multi-agent coordination."          | "One agent decomposes the work and hands pieces to others. They report back."      |
| "Don't worry if a session disconnects — Grackle has you covered!"                             | "Wires drop. The claw suspends, events buffer, and it picks up where it left off." |

When in doubt: shorter, colder, truer.
