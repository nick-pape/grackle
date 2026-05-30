---
id: plugins
title: Plugin System
sidebar_position: 7
---

# Plugin System

Grackle's server is built as a set of composable plugins. Each plugin contributes gRPC handlers, reconciliation phases, MCP tools, event subscribers, and system-prompt sections through a unified contract. You can run a full-featured server or strip it down to just sessions and environments by enabling and disabling plugins. Enablement is stored in the database — the `grackle plugin` CLI and the `plugin_set_enabled` MCP tool are the runtime controls.

## Architecture

Every plugin implements the `GracklePlugin` interface from `@grackle-ai/plugin-sdk`:

```typescript
interface GracklePlugin {
  name: string;
  dependencies?: string[];

  // Contribution methods
  grpcHandlers?: (ctx: PluginContext) => ServiceRegistration[];
  reconciliationPhases?: (ctx: PluginContext) => ReconciliationPhase[];
  mcpTools?: (ctx: PluginContext) => PluginToolDefinition[];
  eventSubscribers?: (ctx: PluginContext) => Disposable[];
  systemPromptContributors?: (ctx: PluginContext) => SystemPromptContributor[];

  // Lifecycle
  initialize?: (ctx: PluginContext) => Promise<void>;
  shutdown?: () => Promise<void>;
}
```

### Extension points

| Extension Point                | What it does                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **gRPC handlers**              | Registers proto service handlers for the ConnectRPC server                                             |
| **Reconciliation phases**      | Named async functions that run on every reconciliation tick                                            |
| **MCP tools**                  | Declares tools that agents can call through the MCP server                                             |
| **Event subscribers**          | Reacts to system events (task created, session completed, etc.)                                        |
| **System-prompt contributors** | Injects a markdown section into a session's system prompt at spawn time (best-effort, under a timeout) |
| **Lifecycle hooks**            | `initialize()` for setup, `shutdown()` for cleanup                                                     |

### Plugin loader lifecycle

```mermaid
graph LR
    V["Validate"] --> S["Topological Sort"]
    S --> I["Initialize"]
    I --> C["Collect"]
    C --> R["Return LoadedPlugins"]
```

1. **Validate** — Check for duplicate names and missing dependencies
2. **Topological sort** — Order plugins so dependencies load first (detects cycles)
3. **Initialize** — Call each plugin's `initialize()` in order. If one fails, roll back all previously initialized plugins
4. **Collect** — Gather gRPC handlers, phases, tools, and subscribers from each plugin
5. **Return** — Aggregated contributions plus a `shutdown()` function

On shutdown, subscribers are disposed first, then each plugin's `shutdown()` is called in **reverse** initialization order.

## Built-in plugins

Grackle ships with four plugins. All four are enabled by default; core is always loaded and cannot be disabled.

### Core

**Always loaded.** Provides the foundational services that everything else depends on.

| Contribution              | Details                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **gRPC handlers**         | Environments, sessions, workspaces, tokens, codespaces, settings                                                                                             |
| **Reconciliation phases** | `dispatch` (assign queued tasks to environments), `lifecycle-cleanup` (clean up stale streams), `environment-status` (monitor environment connection status) |
| **Event subscribers**     | Session and environment lifecycle management, optional root task auto-start                                                                                  |

### Orchestration

**Enabled by default.** Adds the task DAG, personas, and escalation system. Without this plugin, Grackle runs as a pure session + environment manager — no tasks, no orchestration.

| Contribution              | Details                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------- |
| **gRPC handlers**         | Tasks (create, start, complete, resume, stop, delete), personas, findings, escalations |
| **Reconciliation phases** | `orphan-reparent` (re-parent tasks whose parent session has ended)                     |
| **Event subscribers**     | SIGCHLD (child completion notification), escalation auto-routing, orphan re-parenting  |

### Scheduling

**Enabled by default.** Adds cron-style scheduled task creation.

| Contribution              | Details                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| **gRPC handlers**         | Schedule CRUD (create, list, get, update, delete)                  |
| **Reconciliation phases** | `cron` (fires due schedules, creates tasks, enqueues for dispatch) |

Supports both standard cron syntax (`0 0 * * *`) and interval shorthand (`30s`, `5m`, `1h`, `1d`).

### Knowledge

**Enabled by default** (set `GRACKLE_KNOWLEDGE_ENABLED=false` on first run to seed it disabled). Connects to a Neo4j instance and adds the semantic knowledge graph. The graph is populated by a derived-mirror projection, not by agent writes.

| Contribution                   | Details                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **gRPC handlers**              | `searchKnowledge`, `getKnowledgeNode`, `expandKnowledgeNode`, `listRecentKnowledgeNodes`                         |
| **Reconciliation phases**      | `knowledge-health` (monitors Neo4j connectivity), `knowledge-projection` (keeps the derived KG mirror converged) |
| **Event subscribers**          | `entity-sync` (low-latency projection of changed task/workspace/persona/environment rows into the graph)         |
| **MCP tools**                  | `knowledge_search`, `knowledge_get_node`                                                                         |
| **System-prompt contributors** | "Related prior work" — injects a section into a spawning task's prompt from the graph                            |

If Neo4j is unreachable at startup, the plugin logs an error (`Knowledge plugin initialization failed — running degraded`) and enters degraded mode — the rest of the server continues normally.

## Toggling plugins

Plugin enablement is **database-authoritative**. Each optional plugin (`orchestration`, `scheduling`, `knowledge`) has a row in the `plugins` table, and the server loads a plugin if and only if that row is enabled. Core is always loaded.

### Runtime control (CLI / MCP)

To change which plugins load, update the database via the CLI or MCP — then **restart the server** for the change to take effect:

```bash
grackle plugin list                  # show every plugin and its enabled/loaded state
grackle plugin disable orchestration # persist disabled; takes effect on next restart
grackle plugin enable knowledge      # persist enabled; takes effect on next restart
```

Agents can do the same through the MCP tools `plugin_list` and `plugin_set_enabled`. Both the CLI and the tool persist the change but require a restart — the response reports whether a restart is pending.

### First-run seeding (environment variables)

The `GRACKLE_*` environment variables only set the **initial** enabled state when the plugin rows are first seeded on a fresh database. The seed uses `INSERT OR IGNORE`, so once a row exists these variables are ignored — they do **not** toggle plugins on an existing database.

| Variable                     | Default                    | Effect on a fresh database                    |
| ---------------------------- | -------------------------- | --------------------------------------------- |
| `GRACKLE_SKIP_ORCHESTRATION` | unset (`1` seeds disabled) | Set to `1` to seed orchestration disabled     |
| `GRACKLE_SKIP_SCHEDULING`    | unset (`1` seeds disabled) | Set to `1` to seed scheduling disabled        |
| `GRACKLE_KNOWLEDGE_ENABLED`  | unset (seeds enabled)      | Set to `false`/`0` to seed knowledge disabled |

To run a lightweight session manager (core only), seed the optional plugins off on a fresh database, or disable them via the CLI and restart:

```bash
# First run on a fresh database — seeds orchestration + scheduling disabled:
GRACKLE_SKIP_ORCHESTRATION=1 GRACKLE_SKIP_SCHEDULING=1 GRACKLE_KNOWLEDGE_ENABLED=false grackle serve

# On an existing database, use the CLI instead (env vars have no effect here):
grackle plugin disable orchestration
grackle plugin disable scheduling
grackle plugin disable knowledge
# then restart grackle serve
```

## Event types

Plugins can subscribe to these system events:

| Event                                                                                               | When it fires                |
| --------------------------------------------------------------------------------------------------- | ---------------------------- |
| `task.created`, `task.updated`, `task.started`, `task.completed`, `task.deleted`, `task.reparented` | Task lifecycle changes       |
| `workspace.created`, `workspace.archived`, `workspace.updated`                                      | Workspace changes            |
| `persona.created`, `persona.updated`, `persona.deleted`                                             | Persona changes              |
| `environment.added`, `environment.removed`, `environment.changed`, `environment.provision_progress` | Environment lifecycle        |
| `token.changed`, `credential.providers_changed`                                                     | Credential changes           |
| `schedule.created`, `schedule.updated`, `schedule.deleted`, `schedule.fired`                        | Schedule lifecycle           |
| `notification.escalated`                                                                            | Escalation notification sent |
