/**
 * Re-exports plugin contract types from `@grackle-ai/plugin-sdk`.
 *
 * plugin-sdk is the single source of truth for these interfaces (#1463).
 * This module re-exports them so existing `import { PluginContext } from "@grackle-ai/core"`
 * statements continue to work.
 *
 * @module
 */

export type { Disposable, PluginContext, SubscriberFactory } from "@grackle-ai/plugin-sdk";
