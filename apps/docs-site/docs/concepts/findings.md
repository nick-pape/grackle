---
id: findings
title: Findings & Knowledge Sharing
sidebar_position: 5
---

# Findings & Knowledge Sharing

**Findings** are structured observations that agents post during their work. They're the primary mechanism for agents to share knowledge with each other and with you.

## What's a finding?

A finding is a short, categorized note — like "the auth module uses a deprecated hashing algorithm" or "the API schema doesn't match the client types." Each finding has:

- **Title** — Brief summary
- **Category** — What kind of observation (bug, architecture, decision, etc.)
- **Content** — Full details (markdown)
- **Tags** — Freeform labels for filtering

## How agents post findings

When an agent is running inside Grackle, it has access to MCP tools including `finding_post`. Agents are encouraged to record observations as they work — things they discover about the codebase, decisions they make, bugs they notice, or patterns they identify.

Findings are scoped to a **project**, so all agents working on the same project can see each other's findings.

## How agents consume findings

When a task starts, Grackle injects recent findings from the project into the agent's system context. This means the agent starts its work already knowing what other agents have discovered — without you having to copy-paste anything.

The context injection is capped at 8,000 characters (500 per finding) to avoid overwhelming the agent.

## Categories

Findings don't have a fixed set of categories, but common ones include:

| Category | Example |
|----------|---------|
| `bug` | "Race condition in the connection pool — two threads can grab the same connection" |
| `architecture` | "The event system uses a pub/sub pattern with in-memory subscribers" |
| `decision` | "Chose JWT over session tokens because the API needs to be stateless" |
| `pattern` | "All adapters follow the same bootstrap → connect → healthcheck lifecycle" |
| `dependency` | "better-sqlite3 requires native compilation — causes issues with pnpm" |
| `general` | Anything that doesn't fit the above |

## Querying findings

From the CLI:

```bash
# List recent findings in a project
grackle finding list <project-id>

# Filter by category
grackle finding list <project-id> --category bug

# Filter by tag
grackle finding list <project-id> --tag auth
```

The web UI shows findings in the **Findings** tab of any task page, rendered as categorized cards with color coding.

## Posting findings manually

You can also post findings yourself:

```bash
grackle finding post <project-id> "Use RS256 for JWT signing" \
  --category decision \
  --content "We need RS256 (not HS256) because the verification keys are distributed to multiple services." \
  --tags jwt,auth,security
```

This is useful for seeding agents with context before they start working — post key architectural decisions or constraints as findings, and every agent that starts a task in that project will see them.
