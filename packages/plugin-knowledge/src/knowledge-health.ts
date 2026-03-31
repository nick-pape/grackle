/**
 * Knowledge graph health monitoring.
 *
 * Provides a {@link ReconciliationPhase} that periodically checks Neo4j
 * connectivity and tracks state transitions. Exposes the current health
 * state for use by gRPC handlers, the event sync circuit breaker, and
 * the `/readyz` endpoint.
 *
 * @module
 */

import { logger } from "./logger.js";
import type { ReconciliationPhase } from "@grackle-ai/plugin-sdk";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/**
 * Whether Neo4j was healthy on the last check.
 *
 * Defaults to `true` (optimistic) because `initKnowledge()` verifies
 * connectivity via `openNeo4j()` before subscribing to events. This
 * avoids a startup gap where events would be dropped before the first
 * reconciliation tick (~10s).
 */
let healthy: boolean = true;

/** Whether at least one health check has completed. */
let initialized: boolean = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Dependencies injected into the knowledge health phase for testability. */
export interface KnowledgeHealthPhaseDeps {
  /** Check Neo4j connectivity. Returns `true` if reachable. */
  healthCheck: () => Promise<boolean>;
}

/** Readiness check result compatible with the web-server ReadinessCheck type. */
export interface KnowledgeReadinessCheck {
  /** Whether Neo4j is reachable. */
  ok: boolean;
  /** Human-readable detail when unhealthy. */
  message?: string;
}

/**
 * Create a reconciliation phase that monitors Neo4j health.
 *
 * Calls `healthCheck()` on every tick and updates the module-level state.
 * Logs only on state transitions (healthy to unhealthy or vice versa) to
 * avoid log flooding during sustained outages.
 */
export function createKnowledgeHealthPhase(
  deps: KnowledgeHealthPhaseDeps,
): ReconciliationPhase {
  return {
    name: "knowledge-health",
    execute: async (): Promise<void> => {
      let result: boolean;
      try {
        result = await deps.healthCheck();
      } catch {
        result = false;
      }

      const previous: boolean = healthy;
      const wasInitialized: boolean = initialized;
      healthy = result;
      initialized = true;

      // Log on state transitions and on first-check failures
      if (previous && !result) {
        logger.warn("Neo4j became unreachable — knowledge graph operations will be skipped");
      } else if (wasInitialized && !previous && result) {
        logger.info("Neo4j recovered — knowledge graph operations resumed");
      }
    },
  };
}

/**
 * Whether Neo4j is currently considered healthy.
 *
 * Returns `true` before the first health check has completed (optimistic
 * default — `initKnowledge()` verifies connectivity at startup).
 */
export function isNeo4jHealthy(): boolean {
  return healthy;
}

/**
 * Get a readiness check result for the `/readyz` endpoint.
 *
 * Returns `{ ok: true }` when Neo4j is reachable (or before the first check
 * completes, using the optimistic default), or `{ ok: false, message }` when
 * Neo4j has been observed unreachable.
 */
export function getKnowledgeReadinessCheck(): KnowledgeReadinessCheck {
  if (!initialized) {
    return { ok: true, message: "Neo4j health check has not run yet" };
  }
  if (!healthy) {
    return { ok: false, message: "Neo4j is unreachable" };
  }
  return { ok: true };
}

/**
 * Reset health state for testing.
 *
 * @internal
 */
export function resetKnowledgeHealthState(): void {
  healthy = true;
  initialized = false;
}
