/**
 * Core plugin — wraps the core (non-orchestration) Grackle handler groups,
 * reconciliation phases, and event subscribers into a single GracklePlugin.
 *
 * Orchestration concerns (tasks, personas, findings, escalations, orphan-reparent,
 * and their event subscribers) live in `@grackle-ai/plugin-orchestration`.
 *
 * @module
 */

import type { GracklePlugin } from "@grackle-ai/plugin-sdk";
import { grackle } from "@grackle-ai/common";
import { createCoreCollector } from "@grackle-ai/plugin-core";
import { createCoreReconciliationPhases } from "./reconciliation-setup.js";
import { createEventSubscribers } from "./event-subscribers.js";

/**
 * Create the core plugin that contributes non-orchestration server capabilities.
 *
 * - **gRPC handlers**: 7 handler groups (environments, sessions, workspaces,
 *   tokens, codespaces, knowledge, settings)
 * - **Reconciliation phases**: dispatch, lifecycle-cleanup,
 *   environment-reconciliation, and optionally knowledge-health
 * - **Event subscribers**: lifecycle manager and optionally root task boot
 *
 * @returns A GracklePlugin ready to pass to `loadPlugins()`.
 */
export function createCorePlugin(): GracklePlugin {
  return {
    name: "core",

    grpcHandlers: () => [{
      service: grackle.GrackleCore,
      handlers: createCoreCollector().getHandlers(grackle.GrackleCore),
    }],

    reconciliationPhases: () => createCoreReconciliationPhases(),

    eventSubscribers: (ctx) => createEventSubscribers(ctx),
  };
}
