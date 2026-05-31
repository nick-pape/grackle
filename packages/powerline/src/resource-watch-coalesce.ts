/**
 * Pure coalescing precedence for resource-watch change events.
 *
 * Within a single coalesce window, multiple raw filesystem events for the same
 * URI collapse to one change. This resolves the precedence so the batched event
 * reflects the file's net state as the client will first observe it.
 *
 * @module resource-watch-coalesce
 */

import { ResourceChangeType } from "@grackle-ai/ahp";

/** Sentinel: remove the URI from the pending batch entirely (net no-op). */
export const COALESCE_DROP: "drop" = "drop";

/** Result of {@link coalesceChangeType}: the type to store, or drop the entry. */
export type CoalesceResult = ResourceChangeType | typeof COALESCE_DROP;

/**
 * Resolve the coalesced change type for a URI that already has `prior` pending
 * (`undefined` = nothing pending) when `incoming` arrives in the same window.
 *
 * Rules (chokidar emits add→change on a create+write burst, and add→delete on a
 * transient temp file):
 * - `Added` then `Deleted` → {@link COALESCE_DROP}: the client was never told the
 *   file exists, so a delete is a net no-op rather than a phantom deletion.
 * - `Added` then `Updated` → `Added`: the client must first learn the file
 *   exists, not that it changed (content is read fresh on delivery), so `Added`
 *   sticks until the batch flushes.
 * - otherwise → `incoming` (latest wins: change→change, change→delete, add→add,
 *   delete→add, …).
 */
export function coalesceChangeType(
  prior: ResourceChangeType | undefined,
  incoming: ResourceChangeType,
): CoalesceResult {
  if (prior === ResourceChangeType.Added) {
    if (incoming === ResourceChangeType.Deleted) {
      return COALESCE_DROP;
    }
    if (incoming === ResourceChangeType.Updated) {
      return ResourceChangeType.Added;
    }
  }
  return incoming;
}
