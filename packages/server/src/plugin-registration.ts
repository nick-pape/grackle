/**
 * Plugin registration — imports all plugin packages (triggering their
 * `registerPlugin()` calls) and validates the registry is complete.
 *
 * @module
 */

// Side-effect imports: each plugin calls registerPlugin() at module scope.
import "./core-plugin.js";
import "@grackle-ai/plugin-orchestration";
import "@grackle-ai/plugin-scheduling";
import "@grackle-ai/plugin-knowledge";

import { getRegisteredPlugins } from "@grackle-ai/plugin-sdk";

/** All plugins the server expects to be registered before startup. */
const EXPECTED_PLUGINS = ["core", "orchestration", "scheduling", "knowledge"] as const;

/**
 * Verify that all expected plugins have been registered.
 *
 * Call at the top of `main()` before `resolveEnabledPlugins()`. Fails fast
 * with a descriptive error if a plugin import was accidentally removed or
 * made lazy (dynamic `import()`).
 *
 * @throws If any expected plugin is missing from the registry.
 */
export function validatePluginRegistrations(): void {
  const registered = new Set(getRegisteredPlugins().map((p) => p.name));
  const missing = EXPECTED_PLUGINS.filter((name) => !registered.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Plugin registration incomplete: [${missing.join(", ")}] not registered. ` +
        `Ensure all plugin packages are imported before server startup.`,
    );
  }
}
