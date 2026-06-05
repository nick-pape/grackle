/**
 * Catalog-driven runtime instantiation.
 *
 * Iterates {@link RUNTIME_CATALOG}, interprets each entry's factory
 * descriptor, and registers the resulting {@link AgentRuntime}. This is
 * the mechanism layer; the catalog is the policy layer.
 */
import { RUNTIME_CATALOG } from "@grackle-ai/common";
import type { RuntimeFactoryDescriptor } from "@grackle-ai/common";
import type { AgentRuntime } from "@grackle-ai/runtime-sdk";
import { registerRuntime, listRuntimes } from "./runtime-registry.js";
import { logger } from "./logger.js";

/**
 * Load and register all runtimes whose catalog entry has a `factory`
 * descriptor.
 *
 * @param filter - When provided, only runtimes whose name passes the
 *   predicate are loaded. Enables Code/Claw runtime-set composition.
 */
export async function loadRuntimesFromCatalog(filter?: (name: string) => boolean): Promise<void> {
  for (const [name, entry] of Object.entries(RUNTIME_CATALOG)) {
    if (entry.factory === undefined) {
      continue;
    }
    if (filter !== undefined && !filter(name)) {
      logger.debug({ runtime: name }, "Skipping runtime excluded by filter");
      continue;
    }

    try {
      const runtime = await instantiateRuntime(name, entry.factory);
      registerRuntime(runtime);
      logger.debug({ runtime: name }, "Registered runtime from catalog");
    } catch (err: unknown) {
      logger.error({ err, runtime: name }, "Failed to load runtime %s — skipping", name);
    }
  }

  const loaded = listRuntimes();
  logger.info({ count: loaded.length, runtimes: loaded }, "Loaded %d runtimes", loaded.length);
}

async function instantiateRuntime(
  name: string,
  factory: RuntimeFactoryDescriptor,
): Promise<AgentRuntime> {
  switch (factory.type) {
    case "sdk": {
      const mod = (await import(factory.package)) as Record<string, unknown>;
      const Constructor = mod[factory.exportName] as new () => AgentRuntime;
      if (typeof Constructor !== "function") {
        throw new Error(
          `Export "${factory.exportName}" from "${factory.package}" is not a constructor`,
        );
      }
      return new Constructor();
    }

    case "acp": {
      const { AcpRuntime } = (await import("@grackle-ai/runtime-acp")) as {
        AcpRuntime: new (config: {
          name: string;
          command: string;
          args: string[];
          isolateClaudeConfig?: boolean;
        }) => AgentRuntime;
      };
      return new AcpRuntime({
        name,
        command: factory.config.command,
        args: factory.config.args,
        isolateClaudeConfig: factory.config.isolateClaudeConfig,
      });
    }

    default: {
      const _exhaustive: never = factory;
      throw new Error(`Unknown factory type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
