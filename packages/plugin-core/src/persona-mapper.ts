/**
 * Re-exports persona mapper utilities from `@grackle-ai/core`.
 *
 * The canonical implementation lives in core since it is shared infrastructure
 * used by core's task-session. This module provides a convenient import
 * path for plugin-core consumers.
 */
export { toPersonaResolveInput, buildOrchestratorContextInput } from "@grackle-ai/core";
