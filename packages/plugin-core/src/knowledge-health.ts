/**
 * Re-exports knowledge health utilities from `@grackle-ai/core`.
 *
 * The canonical implementation lives in core because the module-level health
 * state must be shared between `isNeo4jHealthy()` and `createKnowledgeHealthPhase()`.
 * This module provides a convenient import path for plugin-core consumers.
 */
export {
  createKnowledgeHealthPhase,
  isNeo4jHealthy,
  getKnowledgeReadinessCheck,
  resetKnowledgeHealthState,
} from "@grackle-ai/core";
export type { KnowledgeHealthPhaseDeps, KnowledgeReadinessCheck } from "@grackle-ai/core";
