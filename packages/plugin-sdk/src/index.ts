// ─── Context Types ────────────────────────────────────────────
export type {
  Disposable,
  ServerConfig,
  GrackleEventType,
  GrackleEvent,
  PluginContext,
  SubscriberFactory,
} from "./context.js";

// ─── Plugin Contract ──────────────────────────────────────────
export type {
  GracklePlugin,
  ServiceRegistration,
  ReconciliationPhase,
  PluginToolDefinition,
  SpawnContextInput,
  SystemPromptContributor,
} from "./plugin.js";

// ─── Loader ───────────────────────────────────────────────────
export type { LoadedPlugins } from "./loader.js";
export { loadPlugins } from "./loader.js";

// ─── Registry ────────────────────────────────────────────────
export type { PluginRegistration, PluginEnvOverride } from "./registry.js";
export {
  registerPlugin,
  getRegisteredPlugins,
  getRegistration,
  resolveEnabledPlugins,
  clearRegistry,
} from "./registry.js";
