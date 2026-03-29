/**
 * Environment status reconciliation phase — periodic safety net for
 * in-memory connection state vs database environment status drift.
 *
 * At several call sites, `removeConnection()` succeeds but the subsequent
 * `updateEnvironmentStatus()` can fail (e.g., DB lock). This leaves the
 * database showing "connected" while no in-memory connection exists. The
 * heartbeat only probes entries in the connections Map, so the drift
 * persists indefinitely. This phase detects and fixes such mismatches.
 */

import type { EnvironmentStatus } from "@grackle-ai/common";
import type { EnvironmentRow } from "@grackle-ai/database";
import { logger } from "./logger.js";
import type { GrackleEventType } from "./event-bus.js";
import type { ReconciliationPhase } from "./reconciliation-manager.js";

/** Statuses that indicate the environment should have an active connection. */
const ACTIVE_STATUSES: ReadonlySet<EnvironmentStatus> = new Set([
  "connected",
  "connecting",
]);

/** Statuses that indicate the environment should NOT have an in-memory connection. */
const INACTIVE_STATUSES: ReadonlySet<EnvironmentStatus> = new Set([
  "disconnected",
  "sleeping",
]);

/** Dependencies injected into the environment reconciliation phase for testability. */
export interface EnvironmentReconciliationDeps {
  /** List all registered environments from the database. */
  listEnvironments: () => EnvironmentRow[];
  /** Get the set of environment IDs that currently have in-memory connections. */
  listConnectionIds: () => Set<string>;
  /** Update an environment's status in the database. */
  updateEnvironmentStatus: (id: string, status: EnvironmentStatus) => void;
  /** Remove an in-memory connection entry. */
  removeConnection: (environmentId: string) => void;
  /** Emit a domain event. */
  emit: (type: GrackleEventType, payload: Record<string, unknown>) => void;
}

/**
 * Create the environment status reconciliation phase.
 *
 * @param deps - Injected dependencies for testability.
 * @returns A ReconciliationPhase that can be registered with the ReconciliationManager.
 */
export function createEnvironmentReconciliationPhase(
  deps: EnvironmentReconciliationDeps,
): ReconciliationPhase {
  return {
    name: "environment-status",
    execute: async (): Promise<void> => {
      const environments = deps.listEnvironments();
      const connectionIds = deps.listConnectionIds();
      let fixedCount = 0;

      // ── Forward drift: DB says active, but no in-memory connection ──
      for (const env of environments) {
        if (ACTIVE_STATUSES.has(env.status as EnvironmentStatus) && !connectionIds.has(env.id)) {
          try {
            deps.updateEnvironmentStatus(env.id, "disconnected");
            deps.emit("environment.changed", {});
            fixedCount++;
          } catch (err) {
            logger.error(
              { err, environmentId: env.id },
              "Environment reconciliation: failed to fix forward drift",
            );
          }
        }
      }

      // ── Reverse drift: in-memory connection exists, but DB says inactive ──
      const envById = new Map<string, EnvironmentRow>(environments.map((e) => [e.id, e]));
      for (const connectionId of connectionIds) {
        const env = envById.get(connectionId);
        if (env && INACTIVE_STATUSES.has(env.status as EnvironmentStatus)) {
          try {
            deps.removeConnection(connectionId);
            fixedCount++;
          } catch (err) {
            logger.error(
              { err, environmentId: connectionId },
              "Environment reconciliation: failed to fix reverse drift",
            );
          }
        }
      }

      if (fixedCount > 0) {
        logger.warn(
          { fixedCount },
          "Environment reconciliation: fixed %d drift(s) — these should have been caught by the primary disconnect flow",
          fixedCount,
        );
      }
    },
  };
}
