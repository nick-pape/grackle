/**
 * Re-exports notification router utilities from `@grackle-ai/core`.
 *
 * The canonical implementation lives in core since it is shared infrastructure
 * used by core's event-processor. This module provides a convenient import
 * path for plugin-core consumers.
 */
export { routeEscalation, deliverPendingEscalations } from "@grackle-ai/core";
