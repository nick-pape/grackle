---
id: root-chat
title: Using the Root Chat
sidebar_position: 2
---

# Using the Root Chat

The root chat is your conversation with the System agent. Plain language in, work out. Describe what you want; the System agent drives Grackle — creating tasks, spawning claws, managing environments.

It is durable. History persists server-side and reloads on mount, so it survives a refresh and follows you across tabs. Pick it back up and the same conversation continues. No suggested actions, no fresh start.

## One prerequisite

You need a connected **local environment**. Until one exists, the message input stays hidden and the empty state tells you so.

Add one first — see [Connect an Environment](./connect-environment). Then return to the chat and the input appears.

## Ask for what you want

- "Add a Docker environment called build-server and provision it."
- "Create a task to fix the flaky auth test in the API workspace and start it."
- "What tasks are running? Any failures?"

The System agent runs on a swappable runtime — Claude Code, Copilot, Codex, GenAIScript, or an ACP-bridged agent. Whichever your default persona specifies.

## Where it lives

The root chat is the landing page of the [web UI](../features/web-ui). It is strictly the root-task conversation. For agent-to-agent IPC streams, use the **Coordination** tab.

## Next

- [Connect an Environment](./connect-environment) — the prerequisite.
- [Create a Task](./create-task) — drive structured work.
- [Chat](../features/chat) — the full reference.
