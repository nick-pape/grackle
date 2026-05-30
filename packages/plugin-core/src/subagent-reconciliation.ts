/**
 * Subagent reconciliation phase (#1386) — reaps stranded RUNNING subagent
 * children left behind by #1075.
 *
 * A materialized subagent child (`runtime="subagent"`) is only ever closed
 * through its parent session's event stream. A background/polled child (Copilot
 * `task` + `read_agent`) whose parent stream ends before a terminal poll lands is
 * deliberately NOT interrupted by the stream's `finally` block — so it can be
 * left `RUNNING` forever.
 *
 * Once the parent session reaches a terminal state, its stream has ended and the
 * child can never be updated again (the parent stream is the child's only
 * mutator), so the child is definitively stranded. This phase interrupts those
 * children. A merely idle/running parent (still alive) or a SUSPENDED parent
 * (recoverable — its resumed stream may still legitimately close the child) is
 * left untouched.
 *
 * @module
 */

import { TERMINAL_SESSION_STATUSES } from "@grackle-ai/common";
import type { SessionStatus } from "@grackle-ai/common";
import type { SessionRow } from "@grackle-ai/database";
import { logger } from "@grackle-ai/core";
import type { ReconciliationPhase } from "@grackle-ai/core";

/** Dependencies injected into the subagent reconciliation phase for testability. */
export interface SubagentReconciliationDeps {
  /** List all materialized subagent child sessions currently in RUNNING. */
  listRunningSubagentChildren: () => SessionRow[];
  /** Resolve a session by id (used to look up each child's parent). */
  getSession: (id: string) => SessionRow | undefined;
  /** Mark a stranded child interrupted (terminal). Idempotent. */
  interruptChildSession: (childSessionId: string) => void;
}

/**
 * Create the subagent reconciliation phase.
 *
 * @param deps - Injected dependencies for testability.
 * @returns A ReconciliationPhase that can be registered with the ReconciliationManager.
 */
export function createSubagentReconciliationPhase(
  deps: SubagentReconciliationDeps,
): ReconciliationPhase {
  return {
    name: "subagent-reconciliation",
    execute: async () => {
      let interrupted = 0;

      for (const child of deps.listRunningSubagentChildren()) {
        const parent = child.parentSessionId ? deps.getSession(child.parentSessionId) : undefined;
        const parentGone = parent === undefined;
        const parentTerminal =
          parent !== undefined && TERMINAL_SESSION_STATUSES.has(parent.status as SessionStatus);

        // Leave the child be while the parent is alive (running/idle) or merely
        // SUSPENDED (recoverable — a resumed stream may still close the child).
        if (!parentGone && !parentTerminal) {
          continue;
        }

        try {
          deps.interruptChildSession(child.id);
          interrupted++;
        } catch (err) {
          logger.error(
            { err, childId: child.id, parentSessionId: child.parentSessionId },
            "Subagent reconciliation: failed to interrupt stranded child",
          );
        }
      }

      if (interrupted > 0) {
        logger.info(
          { interrupted },
          "Subagent reconciliation: interrupted %d stranded child session(s)",
          interrupted,
        );
      }
    },
  };
}
