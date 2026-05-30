---
id: roadmap
title: Roadmap
sidebar_position: 100
---

# Roadmap

Everything below is direction, not shipped. The names are real intentions. The code is not here yet. Where Grackle is headed, in the order it matters.

Today there is one thing: Grackle, the project. Underneath, the long shape is a kernel — **GrackleRoost** — that owns mechanism, and **PowerLine**, the wire the agents run on. The rest is policy, and policy is moving out.

## The userland split

One project tries to be two products. We're splitting it.

**GrackleClaw** — autonomous fleets. Spawn a fleet of agents on a webhook. Leave it overnight. Wake to a group of agents that worked a bug down to the bone. No human in the loop by design; you set the trigger and the boundary, the agents do the rest. Webhooks, schedules, ambient work — all of it lands here.

**GrackleNest** — coding with an agent. Human in the loop, by design. This is the rename of what we've been calling _GrackleCode_. The task-tree and the review-gate you use today are the seed of it: you decompose, you watch, you approve before it lands. Nest is that experience grown into its own app.

Same kernel under both. Different posture toward the human.

## GrackleGate — one wire for the tools

Today an agent reaches its tools through a single shared [MCP server](./features/mcp-server). We want a real aggregator and gateway: many MCP servers folded behind one, an mcp-gateway swallowed whole.

The point is identity. Every tool call routed in the agent's name, signed with the agent's key, leaving the agent's name in the log. When one does something it shouldn't, you read the log and you know which one. No shared credential, no anonymous reach.

## Sandboxing

Right now an agent runs close to the host. Too close.

The direction is stronger isolation — a hard wall between what an agent can touch and what runs the wire. This does not exist yet. It is a wall we intend to build, not a wall you can lean on today. Until it's here, treat an agent as something with the reach of the [kernel](./architecture/kernel) it runs on, and grant accordingly.

## A2A — agent to agent

Agents talk to each other inside Grackle already. Next they talk across the fence: agent-to-agent protocol interop, so an agent on our wire can hand work to an agent that isn't ours, and take it back. Coming. Not here.

---

None of this ships today. When it does, it moves out of this page and into its own.
