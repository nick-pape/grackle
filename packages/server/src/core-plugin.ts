/**
 * Core plugin — wraps all built-in Grackle handler groups, reconciliation
 * phases, and event subscribers into a single GracklePlugin.
 *
 * Handler files remain in `@grackle-ai/core`. This plugin groups their
 * contributions for the `loadPlugins()` loader.
 *
 * @module
 */

import type { GracklePlugin } from "@grackle-ai/plugin-sdk";
import { grackle } from "@grackle-ai/common";
import { createDefaultCollector } from "@grackle-ai/core";
import { createReconciliationPhases } from "./reconciliation-setup.js";
import { createEventSubscribers } from "./event-subscribers.js";

/**
 * Create the core plugin that contributes all built-in server capabilities.
 *
 * - **gRPC handlers**: All 12 handler groups (environments, sessions, tasks, etc.)
 * - **Reconciliation phases**: dispatch, cron, lifecycle-cleanup, orphan-reparent,
 *   environment-reconciliation, and optionally knowledge-health
 * - **Event subscribers**: SIGCHLD, escalation auto-detect, orphan reparent,
 *   lifecycle manager, and optionally root task boot
 *
 * @returns A GracklePlugin ready to pass to `loadPlugins()`.
 */
export function createCorePlugin(): GracklePlugin {
  return {
    name: "core",

    grpcHandlers: () => [{
      service: grackle.Grackle,
      handlers: createDefaultCollector().getHandlers(grackle.Grackle),
    }],

    reconciliationPhases: () => createReconciliationPhases(),

    eventSubscribers: (ctx) => createEventSubscribers(ctx),
  };
}
