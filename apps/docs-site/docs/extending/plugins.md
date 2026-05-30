---
id: plugins
title: Building a Plugin
sidebar_position: 1
---

# Building a Plugin

The server is a set of plugins. Each one contributes capability through a single contract — `GracklePlugin` from `@grackle-ai/plugin-sdk` — and the loader assembles them in dependency order. Write your own to add gRPC handlers, MCP tools, reconciliation work, event reactions, or context the agent reads before it runs.

This page is for authors — how to write, register, and enable your own plugin.

## What a plugin is

A plain object. It declares a `name`, optionally the plugins it `dependencies` on, and any of six contributions. Nothing more is required — every contribution and both lifecycle hooks are optional. A plugin with only a `name` is legal; it just does nothing.

Contributions are **factories**, not values. The loader calls them with a `PluginContext` and collects what they return. That context carries the event bus (`subscribe`, `emit`), a pino `logger`, and resolved `config` — ports, paths, the API key. Stores (`taskStore`, `sessionStore`, …) are not in the context. Import them directly from `@grackle-ai/database`.

## The contract

```typescript
import type { GracklePlugin } from "@grackle-ai/plugin-sdk";
import { taskStore } from "@grackle-ai/database";

export function createMyPlugin(): GracklePlugin {
  return {
    name: "my-plugin",
    dependencies: ["core"],

    // Six extension points — each a factory taking PluginContext.
    grpcHandlers: (ctx) => [
      /* ServiceRegistration[] */
    ],
    reconciliationPhases: (ctx) => [
      /* ReconciliationPhase[] */
    ],
    mcpTools: (ctx) => [
      /* PluginToolDefinition[] */
    ],
    eventSubscribers: (ctx) => [
      /* Disposable[] */
    ],
    systemPromptContributors: (ctx) => [
      /* SystemPromptContributor[] */
    ],

    // Lifecycle.
    async initialize(ctx) {
      ctx.logger.info("my-plugin up");
    },
    async shutdown() {
      /* release resources */
    },
  };
}
```

Export a factory, not a singleton. The loader takes an array of plugins; the server builds that array and hands it to `loadPlugins()`. Your factory runs once, when the server assembles the set.

## Extension points

Six. Each is a factory `(ctx: PluginContext) => T[]`. Return an empty array — or omit the field — to contribute nothing.

| Point                      | Return type                 | What it does                                                                                       |
| -------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `grpcHandlers`             | `ServiceRegistration[]`     | Binds proto handler methods onto a ConnectRPC `service` (e.g. `grackle.GrackleOrchestration`).     |
| `reconciliationPhases`     | `ReconciliationPhase[]`     | Named async `execute()` run on every reconciliation tick. Errors are caught by the manager.        |
| `mcpTools`                 | `PluginToolDefinition[]`    | Tools the agent can call over MCP — name, group, Zod `inputSchema`, `rpcMethod`, `handler`.        |
| `eventSubscribers`         | `Disposable[]`              | Reactions to domain events via `ctx.subscribe`. Return a `Disposable` so shutdown can unwire it.   |
| `systemPromptContributors` | `SystemPromptContributor[]` | A `contribute()` that returns markdown injected into a session's prompt at spawn — or `undefined`. |
| `initialize` / `shutdown`  | `Promise<void>`             | Setup after dependencies are up; teardown on graceful stop.                                        |

A `ReconciliationPhase` is `{ name, execute }`. A `SystemPromptContributor`'s `contribute(input)` runs best-effort under a timeout and **must not block spawn** — it receives a `SpawnContextInput` (task id, title, description, workspace, orchestrator flag, `injectKnowledge`) and returns the section's markdown or `undefined` for none.

## Registering and enabling

The server holds the array. A plugin only loads if both are true:

1. It is in the array the server passes to `loadPlugins()`.
2. Its row in the `plugins` table is enabled.

Enablement is **database-authoritative**. `core` is always loaded and cannot be disabled. The optional ones — `orchestration`, `scheduling`, `knowledge` — each carry a row. The server loads a plugin if and only if its row says so.

Three ways the row changes:

- **First-run seeding.** On a fresh database, `GRACKLE_*` env vars set the initial state — once. The seed uses `INSERT OR IGNORE`; once a row exists the vars are inert.
- **CLI.** `grackle plugin enable <name>` / `grackle plugin disable <name>`. Persists. Takes effect on the next **restart**.
- **MCP.** The `plugin_set_enabled` tool does the same for an agent. Also persists, also needs a restart — the response reports the pending restart.

```bash
grackle plugin list                  # every plugin, enabled + loaded state
grackle plugin disable scheduling    # persisted; restart to apply
```

The env var seeds the database. It does not toggle a running server, and after first run it does nothing at all.

## Lifecycle

The loader runs a fixed sequence, and it unwinds cleanly when anything fails.

1. **Validate** — reject duplicate names and dependencies that were not provided.
2. **Topological sort** — order so dependencies init first. A cycle throws, named.
3. **Initialize** — call each `initialize()` in dependency order. If one throws, every already-initialized plugin is `shutdown()` in reverse, then the error re-throws. Nothing half-loaded survives.
4. **Collect** — gather the six contributions from each plugin, in load order. A throw here disposes any subscribers already collected, shuts down the initialized plugins in reverse, and re-throws.
5. **Return** — aggregated contributions plus a `shutdown()`.

On graceful stop, `shutdown()` disposes every subscriber first, then calls each plugin's `shutdown()` in **reverse** initialization order. A plugin that came up last goes down first.

Write `initialize` to assume your dependencies are already up. Write `shutdown` to release exactly what `initialize` and your factories took — connections, timers, watchers — and to tolerate being called during a rollback, before the server ever finished starting.

## The built-ins as examples

Read these. They are real plugins, authored against this contract.

| Plugin          | Shows you                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orchestration` | gRPC handlers, a reconciliation phase, and event subscribers — the task DAG. See [Orchestration](../features/orchestration).                       |
| `scheduling`    | A reconciliation phase that fires due schedules. See [Scheduled Tasks](../advanced/scheduled-tasks).                                               |
| `knowledge`     | All six points at once, including a `systemPromptContributor` that injects related prior work. See [Knowledge Graph](../features/knowledge-graph). |

`orchestration` is the cleanest skeleton: it depends on `core`, returns its handlers from `grpcHandlers`, one phase from `reconciliationPhases`, and three subscribers from `eventSubscribers`. Copy its shape.

For where plugins sit relative to the rest of the server, see [Kernel](../architecture/kernel).
