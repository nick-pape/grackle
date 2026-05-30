---
id: connect-environment
title: Connect an Environment
sidebar_position: 3
---

# Connect an Environment

A claw needs a wire to perch on. That's an environment.

An environment is a machine you point claws at — Docker, SSH, a Codespace, or local if you must. PowerLine rides the wire inside it; the agent runs there, not on your laptop.

```bash
grackle env add prod --docker     # Docker is the default
grackle env provision prod
```

`provision` installs PowerLine, opens the wire, waits for the perch to go green.

```bash
grackle env list
```

- **connected** — wire's live, claws can perch.
- **sleeping** — it dozed off (usually a stopped Codespace). `grackle env wake prod`.
- **error** — the wire never came up. Check the host, provision again.

Other wires: `--local` (this machine), `--ssh --host box --user me`, `--codespace --codespace-name <name>`.

Already have a container running? `--attach <name>` perches on it without owning its lifecycle.

A wire with no claw on it is just a warm machine. → [Create a Task](./create-task)

---

Deeper detail in [Environments & Workspaces](../building-blocks/environments-workspaces). Pushing credentials onto the wire is covered in [Credentials](../features/credentials). New here? Start at [Installation](./installation).
