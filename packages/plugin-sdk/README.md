# @grackle-ai/plugin-sdk

Plugin contract and loader for Grackle. Defines the `GracklePlugin` interface that all plugins implement, the `PluginContext` they receive, and the `loadPlugins()` function that topologically sorts, initializes, and collects contributions from plugins.

## GracklePlugin

A plugin contributes server capabilities through five extension points:

```typescript
import type { GracklePlugin } from "@grackle-ai/plugin-sdk";

const myPlugin: GracklePlugin = {
  name: "my-plugin",
  dependencies: ["core"], // loaded after "core"

  grpcHandlers: (ctx) => [
    { service: MyProtoService, handlers: { listItems, createItem } },
  ],

  reconciliationPhases: (ctx) => [
    { name: "my-phase", execute: async () => { /* runs every tick */ } },
  ],

  mcpTools: (ctx) => [
    { name: "my_tool", group: "my", description: "...", /* ... */ },
  ],

  eventSubscribers: (ctx) => {
    const unsub = ctx.subscribe((event) => {
      if (event.type === "task.created") { /* react */ }
    });
    return [{ dispose: unsub }];
  },

  initialize: async (ctx) => {
    ctx.logger.info("my-plugin initialized");
  },

  shutdown: async () => {
    // clean up external connections
  },
};
```

## PluginContext

Plugins receive a thin runtime context. Database stores are accessed via direct package imports (e.g., `import { taskStore } from "@grackle-ai/database"`), not through the context.

```typescript
interface PluginContext {
  subscribe: (cb: (event: GrackleEvent) => void) => () => void;
  emit: (type: GrackleEventType, payload: Record<string, unknown>) => GrackleEvent;
  logger: Logger;        // pino structured logger
  config: ServerConfig;  // ports, host, grackleHome, apiKey, etc.
}
```

## loadPlugins()

Loads an array of plugins in dependency order:

1. Validates no duplicate names or missing dependencies
2. Topological sort (Kahn's algorithm) on declared `dependencies`
3. Calls `initialize()` in dependency-first order
4. Collects all contributions (gRPC handlers, phases, tools, subscribers)
5. Returns a `LoadedPlugins` object with aggregated contributions and a `shutdown()` function

```typescript
import { loadPlugins } from "@grackle-ai/plugin-sdk";

const result = await loadPlugins([corePlugin, orchestrationPlugin], ctx);

// Use contributions
for (const reg of result.serviceRegistrations) {
  collector.addHandlers(reg.service, reg.handlers);
}
const manager = new ReconciliationManager(result.reconciliationPhases);

// On server shutdown
await result.shutdown(); // disposes subscribers, then calls plugin.shutdown() in reverse order
```

## Extension Points

| Method | What it contributes | Consumed by |
|---|---|---|
| `grpcHandlers` | `ServiceRegistration[]` — proto service + handler pairs | `ServiceCollector` |
| `reconciliationPhases` | `ReconciliationPhase[]` — named async phases | `ReconciliationManager` |
| `mcpTools` | `PluginToolDefinition[]` — MCP tool definitions | `ToolRegistry` |
| `eventSubscribers` | `Disposable[]` — event bus subscriptions | Server shutdown |
| `initialize` | Async startup hook (e.g., connect to Neo4j) | Plugin loader |
| `shutdown` | Async teardown hook | Plugin loader (reverse order) |
