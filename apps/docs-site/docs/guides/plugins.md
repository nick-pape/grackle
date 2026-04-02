---
id: plugins
title: Plugin System
sidebar_position: 7
---

# Plugin System

Grackle's server is built as a set of composable plugins. Each plugin contributes gRPC handlers, reconciliation phases, MCP tools, and event subscribers through a unified contract. You can run a full-featured server or strip it down to just sessions and environments by toggling plugins on and off.

## Architecture

Every plugin implements the `GracklePlugin` interface from `@grackle-ai/plugin-sdk`:

```typescript
interface GracklePlugin {
  name: string;
  dependencies?: string[];

  // Five extension points
  grpcHandlers?: (ctx: PluginContext) => ServiceRegistration[];
  reconciliationPhases?: (ctx: PluginContext) => ReconciliationPhase[];
  mcpTools?: (ctx: PluginContext) => PluginToolDefinition[];
  eventSubscribers?: (ctx: PluginContext) => Disposable[];

  // Lifecycle hooks
  initialize?: (ctx: PluginContext) => Promise<void>;
  shutdown?: () => Promise<void>;
}
```

### Extension points

| Extension Point | What it does |
|-----------------|-------------|
| **gRPC handlers** | Registers proto service handlers for the ConnectRPC server |
| **Reconciliation phases** | Named async functions that run on every reconciliation tick |
| **MCP tools** | Declares tools that agents can call through the MCP server |
| **Event subscribers** | Reacts to system events (task created, session completed, etc.) |
| **Lifecycle hooks** | `initialize()` for setup, `shutdown()` for cleanup |

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

Grackle ships with four plugins. All are enabled by default except knowledge (opt-in).

### Core

**Always loaded.** Provides the foundational services that everything else depends on.

| Contribution | Details |
|-------------|---------|
| **gRPC handlers** | Environments, sessions, workspaces, tokens, codespaces, settings |
| **Reconciliation phases** | `dispatch` (assign queued tasks to environments), `lifecycle-cleanup` (clean up stale streams), `environment-status` (monitor environment status) |
| **Event subscribers** | Session and environment lifecycle management, optional root task auto-start |

### Orchestration

**Enabled by default.** Adds the task DAG, personas, findings, and escalation system. Without this plugin, Grackle runs as a pure session + environment manager — no tasks, no orchestration.

| Contribution | Details |
|-------------|---------|
| **gRPC handlers** | Tasks (create, start, complete, resume, stop, delete), personas, findings, escalations |
| **Reconciliation phases** | `orphan-reparent` (re-parent tasks whose parent session has ended) |
| **Event subscribers** | SIGCHLD (child completion notification), escalation auto-routing, orphan reparenting |

### Scheduling

**Enabled by default.** Adds cron-style scheduled task creation.

| Contribution | Details |
|-------------|---------|
| **gRPC handlers** | Schedule CRUD (create, list, get, update, delete) |
| **Reconciliation phases** | `cron` (fires due schedules, creates tasks, enqueues for dispatch) |

Supports both standard cron syntax (`0 0 * * *`) and interval shorthand (`30s`, `5m`, `1h`, `1d`).

### Knowledge

**Opt-in** (requires `GRACKLE_KNOWLEDGE_ENABLED=true` and a running Neo4j instance). Adds the semantic knowledge graph.

| Contribution | Details |
|-------------|---------|
| **gRPC handlers** | `searchKnowledge`, `getKnowledgeNode`, `expandKnowledgeNode`, `listRecentKnowledgeNodes`, `createKnowledgeNode` |
| **Reconciliation phases** | `knowledge-health` (monitors Neo4j connectivity) |
| **Event subscribers** | `entity-sync` (syncs task and finding entities to the knowledge graph) |
| **MCP tools** | `knowledge_search`, `knowledge_get_node`, `knowledge_create_node` |

If Neo4j is unreachable at startup, the plugin logs a warning and enters degraded mode — the rest of the server continues normally.

## Toggling plugins

Control which plugins load via environment variables:

| Variable | Default | Effect |
|----------|---------|--------|
| `GRACKLE_SKIP_ORCHESTRATION` | unset | Set to `1` to disable orchestration (no tasks, personas, findings) |
| `GRACKLE_SKIP_SCHEDULING` | unset | Set to `1` to disable scheduled triggers |
| `GRACKLE_KNOWLEDGE_ENABLED` | unset | Set to `true` to enable the knowledge graph plugin |

**Minimal mode** — run with only the core plugin for a lightweight session manager:

```bash
GRACKLE_SKIP_ORCHESTRATION=1 GRACKLE_SKIP_SCHEDULING=1 grackle serve
```

## Event types

Plugins can subscribe to these system events:

| Event | When it fires |
|-------|--------------|
| `task.created`, `task.updated`, `task.started`, `task.completed`, `task.deleted`, `task.reparented` | Task lifecycle changes |
| `workspace.created`, `workspace.archived`, `workspace.updated` | Workspace changes |
| `persona.created`, `persona.updated`, `persona.deleted` | Persona changes |
| `finding.posted` | New finding posted |
| `environment.added`, `environment.removed`, `environment.changed`, `environment.provision_progress` | Environment lifecycle |
| `token.changed`, `credential.providers_changed` | Credential changes |
| `schedule.created`, `schedule.updated`, `schedule.deleted`, `schedule.fired` | Schedule lifecycle |
| `notification.escalated` | Escalation notification sent |
