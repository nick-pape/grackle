/**
 * Lifecycle cleanup reconciliation phase — removes orphaned lifecycle streams
 * whose sessions have been deleted from the database.
 *
 * Prevents unbounded memory growth from accumulating in-memory streams for
 * sessions that no longer exist.
 *
 * @module
 */

import { sessionStore } from "@grackle-ai/database";
import type { ReconciliationPhase } from "@grackle-ai/core";
import { streamRegistry } from "@grackle-ai/core";
import { logger } from "@grackle-ai/core";

/** Prefix for lifecycle stream names. */
const LIFECYCLE_PREFIX: string = "lifecycle:";

/** Reconciliation phase that cleans up lifecycle streams for deleted sessions. */
export const lifecycleCleanupPhase: ReconciliationPhase = {
  name: "lifecycle-cleanup",
  execute: async (): Promise<void> => {
    let cleaned: number = 0;
    for (const stream of streamRegistry.listStreams()) {
      if (!stream.name.startsWith(LIFECYCLE_PREFIX)) {
        continue;
      }
      const sessionId: string = stream.name.slice(LIFECYCLE_PREFIX.length);
      if (!sessionStore.getSession(sessionId)) {
        streamRegistry.deleteStream(stream.id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.info({ cleaned }, "Lifecycle cleanup: removed %d orphaned stream(s)", cleaned);
    }
  },
};
