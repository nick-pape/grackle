# @grackle-ai/plugin-core

Built-in Grackle plugin — gRPC handlers, reconciliation phases, and event subscribers for the core server capabilities (environments, sessions, workspaces, schedules, tokens, codespaces, knowledge, settings).

Handler files live in this package. Orchestration concerns (tasks, personas, findings, escalations) are in `@grackle-ai/plugin-orchestration`.

## Handler Collectors

### `createCoreCollector()`

Returns a `ServiceCollector` with the 8 core handler groups (environments, sessions, workspaces, schedules, tokens, codespaces, knowledge, settings). Used by `@grackle-ai/server`'s core plugin.

### `createOrchestrationCollector()`

Returns a `ServiceCollector` with the 4 orchestration handler groups (tasks, personas, findings, escalations). Used by `@grackle-ai/plugin-orchestration`.

### `createDefaultCollector()`

Returns a `ServiceCollector` with all 12 handler groups combined. Use this when you need all handlers without the plugin split.

## Subscriber Factories

| Export | Description |
|---|---|
| `createLifecycleSubscriber` | Manages session lifecycle state transitions |
| `createRootTaskBootSubscriber` | Auto-starts the root task on server boot |
| `createSigchldSubscriber` | Handles agent process exit events |
| `createEscalationAutoSubscriber` | Auto-detects and routes escalations |
| `createOrphanReparentSubscriber` | Re-parents orphaned tasks after agent reconnect |

## Reconciliation Phases

| Export | Description |
|---|---|
| `createDispatchPhase` | Dispatches queued tasks to available environments |
| `createCronPhase` | Fires scheduled tasks when due |
| `lifecycleCleanupPhase` | Cleans up stale session lifecycle streams |
| `createOrphanPhase` | Re-parents orphaned tasks (used by orchestration plugin) |
| `createEnvironmentReconciliationPhase` | Reconciles environment connection status |
