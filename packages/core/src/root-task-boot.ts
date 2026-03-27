/**
 * Root task boot with reanimate-first strategy and exponential backoff.
 *
 * Extracted from the inline closure in `server/src/index.ts` so it can be
 * unit tested. Follows the dependency-injection pattern established by
 * `cron-phase.ts`.
 *
 * On each invocation (triggered by `environment.changed` events):
 * 1. Checks if the root task is already running — if so, tracks stability.
 * 2. If not running, attempts to reanimate the most recent session (preserving
 *    conversation history) before falling back to a fresh spawn.
 * 3. Applies exponential backoff after consecutive failures to prevent
 *    crash-loop resource waste.
 *
 * @module
 */

import { ROOT_TASK_ID, ROOT_TASK_INITIAL_PROMPT, TASK_STATUS } from "@grackle-ai/common";
import type { TaskRow, SessionRow, EnvironmentRow } from "@grackle-ai/database";
import type { TaskStatusResult } from "./compute-task-status.js";
import { logger } from "./logger.js";

// ─── Constants ──────────────────────────────────────────────

/** Initial delay before the first retry after a failed boot (milliseconds). */
const BOOT_INITIAL_DELAY_MS: number = 1_000;

/** Multiplier for exponential backoff between boot retries. */
const BOOT_BACKOFF_MULTIPLIER: number = 2;

/** Maximum delay between boot retries (milliseconds). */
const BOOT_MAX_DELAY_MS: number = 60_000;

/** Maximum consecutive boot failures before giving up until server restart. */
const BOOT_MAX_FAILURES: number = 5;

/** Minimum time a session must survive (ms) to be considered stable and reset backoff. */
const BOOT_STABLE_THRESHOLD_MS: number = 30_000;

// ─── Types ──────────────────────────────────────────────────

/** Dependencies injected into the root task boot module for testability. */
export interface RootTaskBootDeps {
  /** Look up a task by ID. */
  getTask: (id: string) => TaskRow | undefined;
  /** List all sessions for a task. */
  listSessionsForTask: (taskId: string) => Pick<SessionRow, "id" | "status" | "startedAt">[];
  /** Get the most recent session for a task (by startedAt DESC). */
  getLatestSessionForTask: (taskId: string) => SessionRow | undefined;
  /** Compute effective task status from stored status + session history. */
  computeTaskStatus: (storedStatus: string, sessions: Pick<SessionRow, "id" | "status" | "startedAt">[]) => TaskStatusResult;
  /** Find the first connected environment, preferring local. */
  findFirstConnectedEnvironment: () => EnvironmentRow | undefined;
  /** Start a new agent session for a task. Returns error string on failure, undefined on success. */
  startTaskSession: (task: TaskRow, options?: { environmentId?: string; notes?: string }) => Promise<string | undefined>;
  /** Reanimate a terminal session by resuming it on PowerLine. Throws on failure. */
  reanimateAgent: (sessionId: string) => SessionRow;
  /** Whether onboarding is complete. Boot is deferred until the user has chosen a runtime (#1031). */
  isOnboarded?: () => boolean;
}

/** In-memory backoff state for the root task boot flow. */
interface BootState {
  /** Number of consecutive failed boot attempts. */
  failures: number;
  /** Timestamp (Date.now()) of the last failure. */
  lastFailureAt: number;
  /** Whether a boot attempt is currently in progress. */
  inProgress: boolean;
  /** Timestamp (Date.now()) when the latest successful boot started (for stability tracking). */
  lastSessionStartedAt: number;
}

// ─── State ──────────────────────────────────────────────────

let state: BootState = createInitialState();

function createInitialState(): BootState {
  return {
    failures: 0,
    lastFailureAt: 0,
    inProgress: false,
    lastSessionStartedAt: 0,
  };
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Create the root task boot handler.
 *
 * Returns a callable async function that can be wired to `environment.changed`
 * event subscriptions. Each call checks whether the root task needs starting
 * and applies reanimate-first + exponential backoff logic.
 *
 * @param deps - Injected dependencies for testability.
 * @returns An async function to call on each `environment.changed` event.
 */
export function createRootTaskBoot(deps: RootTaskBootDeps): () => Promise<void> {
  return async (): Promise<void> => {
    // Guard: prevent concurrent boot attempts
    if (state.inProgress) {
      return;
    }

    state.inProgress = true;
    try {
      await attemptBoot(deps);
    } catch (err) {
      recordFailure();
      logger.warn({ err }, "Root task boot failed with unexpected exception");
    } finally {
      state.inProgress = false; // eslint-disable-line require-atomic-updates -- single-threaded, flag guards re-entry
    }
  };
}

/**
 * Reset in-memory backoff state. For use in tests only.
 *
 * @internal
 */
export function _resetForTesting(): void {
  state = createInitialState();
}

// ─── Internal ───────────────────────────────────────────────

/** Core boot logic — separated from the guard/error wrapper for clarity. */
async function attemptBoot(deps: RootTaskBootDeps): Promise<void> {
  // 0. Don't auto-start before onboarding — the user hasn't chosen their
  // runtime yet, so the root task would launch with the default "claude-code".
  if (deps.isOnboarded && !deps.isOnboarded()) {
    return;
  }

  // 1. Look up root task
  const rootTask = deps.getTask(ROOT_TASK_ID);
  if (!rootTask) {
    return;
  }

  // 2. Check if already working
  const sessions = deps.listSessionsForTask(ROOT_TASK_ID);
  const { status } = deps.computeTaskStatus(rootTask.status, sessions);
  if (status === TASK_STATUS.WORKING) {
    checkStabilityReset();
    return;
  }

  // 2b. Crash-loop detection: if we recently started a session but the task
  // is no longer working before the stability threshold, count it as a failure.
  // This catches the case where startTaskSession succeeded but the session
  // crashed shortly after (the main crash-loop scenario from issue #959).
  if (state.lastSessionStartedAt > 0) {
    const sinceLastStart = Date.now() - state.lastSessionStartedAt;
    if (sinceLastStart < BOOT_STABLE_THRESHOLD_MS) {
      // Session crashed before reaching stability — record as failure
      if (state.lastFailureAt < state.lastSessionStartedAt) {
        // Only record once per start (guard against multiple environment.changed events)
        recordFailure();
        logger.info(
          { survivedMs: sinceLastStart, failures: state.failures },
          "Root task session crashed before stability threshold — recording failure",
        );
      }
    } else {
      // Session survived past stability threshold but is now stopped — reset backoff
      resetBackoff(sinceLastStart);
    }
    state.lastSessionStartedAt = 0;
  }

  // 3. Find connected environment
  const connectedEnv = deps.findFirstConnectedEnvironment();
  if (!connectedEnv) {
    return;
  }

  // 4. Check backoff
  if (state.failures >= BOOT_MAX_FAILURES) {
    logger.error(
      { failures: state.failures },
      "Root task boot exhausted all retries (%d failures) — giving up until server restart",
      state.failures,
    );
    return;
  }

  if (state.failures > 0) {
    const delay = Math.min(
      BOOT_INITIAL_DELAY_MS * Math.pow(BOOT_BACKOFF_MULTIPLIER, state.failures - 1),
      BOOT_MAX_DELAY_MS,
    );
    const elapsed = Date.now() - state.lastFailureAt;
    if (elapsed < delay) {
      return; // backoff not elapsed yet
    }
  }

  // 5. Reanimate-first: try to resume the latest session
  let booted = false;
  const latestSession = deps.getLatestSessionForTask(ROOT_TASK_ID);

  if (latestSession?.runtimeSessionId) {
    try {
      deps.reanimateAgent(latestSession.id);
      booted = true;
      logger.info(
        { sessionId: latestSession.id, environmentId: latestSession.environmentId },
        "Root task reanimated existing session",
      );
    } catch (reanimateErr) {
      logger.info(
        { sessionId: latestSession.id, err: reanimateErr },
        "Root task reanimate failed — falling back to fresh spawn",
      );
    }
  }

  // 6. Fresh spawn (fallback)
  if (!booted) {
    const err = await deps.startTaskSession(rootTask, {
      environmentId: connectedEnv.id,
      notes: ROOT_TASK_INITIAL_PROMPT,
    });
    if (err) {
      recordFailure();
      logger.warn({ err }, "Root task auto-start failed");
      return;
    }
    logger.info({ environmentId: connectedEnv.id }, "Root task auto-started (fresh spawn)");
  }

  // 7. Track session start time for stability detection
  state.lastSessionStartedAt = Date.now(); // eslint-disable-line require-atomic-updates -- single-threaded
}

/** Record a boot failure: increment counter and timestamp. */
function recordFailure(): void {
  state.failures++;
  state.lastFailureAt = Date.now();
}

/**
 * If the root task has been WORKING long enough (past the stability threshold),
 * reset the backoff counter. Called when we detect the task is already running.
 */
function checkStabilityReset(): void {
  if (state.failures === 0) {
    return;
  }
  if (state.lastSessionStartedAt > 0) {
    const elapsed = Date.now() - state.lastSessionStartedAt;
    if (elapsed >= BOOT_STABLE_THRESHOLD_MS) {
      resetBackoff(elapsed);
    }
  } else {
    // Task is WORKING but we didn't start it (e.g., session recovery
    // reanimated it externally). Begin tracking stability from now so
    // backoff can eventually reset — otherwise MAX_FAILURES is permanent.
    state.lastSessionStartedAt = Date.now();
  }
}

/** Zero out the backoff state after a session has proven stable. */
function resetBackoff(survivedMs: number): void {
  logger.info(
    { survivedMs, previousFailures: state.failures },
    "Root task session stable — resetting backoff",
  );
  state.failures = 0;
  state.lastFailureAt = 0;
}
