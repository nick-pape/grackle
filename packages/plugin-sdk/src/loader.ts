/**
 * Plugin loader — topological sort, initialization, and contribution collection.
 *
 * @module
 */

import type {
  GracklePlugin,
  ReconciliationPhase,
  ServiceRegistration,
  PluginToolDefinition,
} from "./plugin.js";
import type { PluginContext, Disposable } from "./context.js";

/** Aggregated contributions from all loaded plugins. */
export interface LoadedPlugins {
  /** All gRPC service registrations, in plugin load order. */
  serviceRegistrations: ServiceRegistration[];
  /** All reconciliation phases, in plugin load order. */
  reconciliationPhases: ReconciliationPhase[];
  /** All MCP tool definitions, in plugin load order. */
  mcpTools: PluginToolDefinition[];
  /** All subscriber disposables (for shutdown). */
  subscriberDisposables: Disposable[];
  /** Dispose all subscribers, then shutdown plugins in reverse initialization order. */
  shutdown: () => Promise<void>;
}

/**
 * Load, sort, initialize, and collect contributions from plugins.
 *
 * 1. Validate: no duplicate names, no missing dependencies
 * 2. Topological sort on declared dependencies (error on cycles)
 * 3. Call `initialize()` in dependency order
 * 4. Collect grpcHandlers, reconciliationPhases, mcpTools, eventSubscribers
 * 5. Return aggregated contributions + a shutdown function
 *
 * @param plugins - Unordered array of plugins to load.
 * @param ctx - Runtime context provided to each plugin.
 * @returns Aggregated contributions and a shutdown function.
 */
export async function loadPlugins(
  plugins: GracklePlugin[],
  ctx: PluginContext,
): Promise<LoadedPlugins> {
  // 1. Validate
  const byName = new Map<string, GracklePlugin>();
  for (const plugin of plugins) {
    if (byName.has(plugin.name)) {
      throw new Error(`Duplicate plugin name: "${plugin.name}"`);
    }
    byName.set(plugin.name, plugin);
  }

  for (const plugin of plugins) {
    for (const dep of plugin.dependencies ?? []) {
      if (!byName.has(dep)) {
        throw new Error(
          `Plugin "${plugin.name}" depends on "${dep}" which was not provided`,
        );
      }
    }
  }

  // 2. Topological sort (Kahn's algorithm)
  const sorted = topologicalSort(plugins);

  // 3. Initialize in dependency order
  const initialized: GracklePlugin[] = [];
  for (const plugin of sorted) {
    if (plugin.initialize) {
      await plugin.initialize(ctx);
    }
    initialized.push(plugin);
  }

  // 4. Collect contributions
  const serviceRegistrations: ServiceRegistration[] = [];
  const reconciliationPhases: ReconciliationPhase[] = [];
  const mcpTools: PluginToolDefinition[] = [];
  const subscriberDisposables: Disposable[] = [];

  for (const plugin of sorted) {
    if (plugin.grpcHandlers) {
      serviceRegistrations.push(...plugin.grpcHandlers(ctx));
    }
    if (plugin.reconciliationPhases) {
      reconciliationPhases.push(...plugin.reconciliationPhases(ctx));
    }
    if (plugin.mcpTools) {
      mcpTools.push(...plugin.mcpTools(ctx));
    }
    if (plugin.eventSubscribers) {
      subscriberDisposables.push(...plugin.eventSubscribers(ctx));
    }
  }

  // 5. Build shutdown function (reverse order, catch errors)
  const shutdown = async (): Promise<void> => {
    // Dispose subscribers first
    for (const disposable of subscriberDisposables) {
      try {
        disposable.dispose();
      } catch (err) {
        ctx.logger.warn({ err }, "Subscriber dispose failed during shutdown");
      }
    }

    // Shutdown plugins in reverse initialization order
    for (let i = initialized.length - 1; i >= 0; i--) {
      const plugin = initialized[i];
      if (plugin.shutdown) {
        try {
          await plugin.shutdown();
        } catch (err) {
          ctx.logger.error({ err, plugin: plugin.name }, "Plugin '%s' shutdown failed", plugin.name);
        }
      }
    }
  };

  return {
    serviceRegistrations,
    reconciliationPhases,
    mcpTools,
    subscriberDisposables,
    shutdown,
  };
}

/**
 * Topological sort using Kahn's algorithm.
 *
 * @param plugins - Plugins with optional `dependencies` arrays.
 * @returns Plugins in dependency-first order.
 * @throws If a cycle is detected.
 */
function topologicalSort(plugins: GracklePlugin[]): GracklePlugin[] {
  const byName = new Map<string, GracklePlugin>();
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  // Initialize
  for (const plugin of plugins) {
    byName.set(plugin.name, plugin);
    inDegree.set(plugin.name, 0);
    dependents.set(plugin.name, []);
  }

  // Build edges: dependency → dependent
  for (const plugin of plugins) {
    for (const dep of plugin.dependencies ?? []) {
      dependents.get(dep)!.push(plugin.name);
      inDegree.set(plugin.name, inDegree.get(plugin.name)! + 1);
    }
  }

  // Seed queue with zero in-degree nodes
  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) {
      queue.push(name);
    }
  }

  // Process
  const sorted: GracklePlugin[] = [];
  while (queue.length > 0) {
    const name = queue.shift()!;
    sorted.push(byName.get(name)!);

    for (const dependent of dependents.get(name)!) {
      const newDegree = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  if (sorted.length !== plugins.length) {
    // Find the cycle for a descriptive error message
    const remaining = plugins
      .filter((p) => !sorted.some((s) => s.name === p.name))
      .map((p) => p.name);
    throw new Error(
      `Dependency cycle detected among plugins: ${remaining.join(", ")}`,
    );
  }

  return sorted;
}
