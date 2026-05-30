---
id: chat
title: Chat
sidebar_position: 2
---

# Chat

The landing page is a conversation with the **System agent** — the claw that runs on the root task. Plain language in, work out. It does not memorize commands for you; it drives Grackle directly through MCP tools.

This is the full reference. For the install-and-go path, start with [Using the Root Chat](../getting-started/root-chat).

## What the System agent can do

It sees every Grackle capability as a tool — environments, tasks, sessions, personas, knowledge. Describe the outcome; it picks the calls.

| You say                                                         | It does                                        |
| --------------------------------------------------------------- | ---------------------------------------------- |
| "Add a Docker environment called build-server and provision it" | creates and provisions an environment          |
| "Fix the flaky auth test in the API workspace and start it"     | spawns a task, spawns a claw on it             |
| "What's running? Any failures?"                                 | reads task and session state                   |
| "What do we know about the payment module?"                     | queries the knowledge graph (when enabled)     |
| "Stand up three Docker envs and start the top three tasks"      | runs the whole sequence, several claws at once |

Anything the MCP server exposes is reachable here. The agent is the front door to the rest of the system, not a separate one.

## A durable conversation

The chat is not ephemeral. It is the persistent root-task conversation, written server-side as it happens.

- History reloads when the page mounts. A refresh costs you nothing.
- The same conversation is shared across browser tabs — open two, see one thread.
- Picking it back up continues where you left off. There is no fresh start, no suggested-action cards offered to you.

When a wire drops mid-thought, the claw suspends and events buffer. Reconnect and it resumes. You steer; the conversation holds.

## History and sessions

The chat is one long thread, but the work underneath it is many [tasks and sessions](../building-blocks/tasks-sessions).

When you ask for structured work, the System agent creates tasks and spawns claws to run them. Each claw is its own session with its own name and key — it perches on a wire, runs, reports back, and dies. The chat is where you watch and redirect; the sessions are where the work actually happens.

You do not manage those sessions by hand from here. Ask, and the agent spawns, checks, or kills them on your behalf.

## Runtime

The System agent runs on whatever runtime your **default persona** specifies. Swappable — change the persona, change the engine.

| Runtime         | Best for                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Claude Code** | general purpose, strong at orchestration                                                                               |
| **Codex**       | OpenAI models, reasoning-heavy work                                                                                    |
| **Copilot**     | GitHub-integrated workflows                                                                                            |
| **GenAIScript** | scripted, deterministic flows                                                                                          |
| **ACP-bridged** | external agents over the Agent Client Protocol (`goose`, `codex-acp`, `copilot-acp`, `claude-code-acp` — experimental) |

Set the runtime during first-run setup, or later under **Settings → Personas** by editing the default persona.

## Where Coordination splits off

The chat is strictly the root-task conversation — you and the System agent, nothing else.

When claws talk to each other, that traffic does not surface here. Agent-to-agent IPC lives in the [Coordination](./coordination) tab. Older `/chat/:streamId` links redirect there.

So: the chat is the spine. [Coordination](./coordination) is the cross-talk between the claws it spawns. [Orchestration](./orchestration) is how one agent decomposes work and hands pieces out.

## Next

- [Web UI](./web-ui) — where the chat lives.
- [Coordination](./coordination) — agent-to-agent streams.
- [Tasks and Sessions](../building-blocks/tasks-sessions) — the work under the thread.
