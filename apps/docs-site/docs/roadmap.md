---
id: roadmap
title: Roadmap
sidebar_position: 100
---

# Roadmap

Everything below is direction, not shipped. The names are real intentions. The code is not here yet. Where the plague is headed, in the order it matters.

Today there is one thing: Grackle, the project. Underneath, the long shape is a kernel — **GrackleRoost** — that owns mechanism, and **PowerLine**, the wire the claws perch on. The rest is policy, and policy is moving out.

## The userland split

One project tries to be two products. We're splitting it.

**GrackleClaw** — autonomous fleets. Spawn a plague on a webhook. Leave it overnight. Wake to a mob that worked a bug down to the bone. No human in the loop by design; you set the trigger and the boundary, the claws do the rest. Webhooks, schedules, ambient work — all of it lands here.

**GrackleNest** — coding with a claw. Human in the loop, by design. This is the rename of what we've been calling _GrackleCode_. The task-tree and the review-gate you use today are the seed of it: you decompose, you watch, you approve before it lands. Nest is that experience grown into its own app.

Same kernel under both. Different posture toward the human.

## GrackleGate — one wire for the tools

Today a claw reaches its tools through a single shared mouth. We want a real [aggregator and gateway](./features/coordination): many MCP servers folded behind one, an mcp-gateway swallowed whole.

The point is identity. Every tool call routed in the claw's name, signed with the claw's key, leaving the claw's name in the log. When one does something it shouldn't, you read the log and you know which one. No shared credential, no anonymous reach.

## Sandboxing

Right now a claw runs close to the host. Too close.

The direction is stronger isolation — a hard wall between what a claw can touch and what runs the wire. This does not exist yet. It is a wall we intend to build, not a wall you can lean on today. Until it's here, treat a claw as something with the reach of the [kernel](./architecture/kernel) it perches on, and grant accordingly.

## A2A — agent to agent

Claws talk to each other inside Grackle already. Next they talk across the fence: agent-to-agent protocol interop, so a claw on our wire can hand work to an agent that isn't ours, and take it back. Coming. Not here.

---

None of this ships today. When it does, it moves out of this page and into its own.
